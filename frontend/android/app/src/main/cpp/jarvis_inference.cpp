#include <jni.h>
#include <android/log.h>
#include <algorithm>
#include <mutex>
#include <string>
#include <vector>
#include <unistd.h>
#include "llama.h"

#define TAG "JarvisInference"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static std::mutex g_mutex;
static llama_model *g_model = nullptr;
static llama_context *g_context = nullptr;
static llama_sampler *g_sampler = nullptr;
static const llama_vocab *g_vocab = nullptr;

static void release_model() {
    if (g_sampler) { llama_sampler_free(g_sampler); g_sampler = nullptr; }
    if (g_context) { llama_free(g_context); g_context = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    g_vocab = nullptr;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_openjarvis_jarvis_JarvisInferencePlugin_nativeLoad(JNIEnv *env, jobject, jstring path) {
    std::lock_guard<std::mutex> lock(g_mutex);
    release_model();
    const char *model_path = env->GetStringUTFChars(path, nullptr);
    llama_backend_init();
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0; // CPU fallback is deterministic and supported on all arm64 devices.
    g_model = llama_model_load_from_file(model_path, mp);
    env->ReleaseStringUTFChars(path, model_path);
    if (!g_model) { LOGE("Model load failed"); return JNI_FALSE; }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = 2048;
    cp.n_batch = 256;
    cp.n_ubatch = 128;
    int threads = (int)sysconf(_SC_NPROCESSORS_ONLN);
    cp.n_threads = std::max(2, std::min(4, threads > 2 ? threads - 2 : 2));
    cp.n_threads_batch = cp.n_threads;
    g_context = llama_init_from_model(g_model, cp);
    if (!g_context) { release_model(); return JNI_FALSE; }
    g_vocab = llama_model_get_vocab(g_model);
    g_sampler = llama_sampler_init_greedy();
    return g_sampler ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_openjarvis_jarvis_JarvisInferencePlugin_nativeGenerate(JNIEnv *env, jobject, jstring prompt, jint max_tokens) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_model || !g_context || !g_vocab || !g_sampler) return env->NewStringUTF("JARVIS local model is not loaded.");
    const char *input = env->GetStringUTFChars(prompt, nullptr);
    std::string text(input ? input : "");
    env->ReleaseStringUTFChars(prompt, input);
    if (text.empty()) return env->NewStringUTF("");

    // Prefer the GGUF model's own chat template. Fall back to ChatML only
    // when the model does not declare one.
    const char *system_text = "You are JARVIS, a capable, calm, precise personal AI assistant. Think carefully, verify claims, explain uncertainty, and never pretend to have performed an action you did not perform.";
    llama_chat_message messages[2] = {
        {"system", system_text},
        {"user", text.c_str()}
    };
    std::string formatted;
    const char *chat_template = llama_model_chat_template(g_model, nullptr);
    if (chat_template) {
        std::vector<char> rendered(std::max<size_t>(4096, (text.size() + strlen(system_text)) * 4));
        int32_t rendered_size = llama_chat_apply_template(chat_template, messages, 2, true,
                                                          rendered.data(), (int32_t)rendered.size());
        if (rendered_size > 0 && rendered_size <= (int32_t)rendered.size()) {
            formatted.assign(rendered.data(), (size_t)rendered_size);
        }
    }
    if (formatted.empty()) {
        formatted = "<|im_start|>system\\n" + std::string(system_text) +
                    "<|im_end|>\\n<|im_start|>user\\n" + text +
                    "<|im_end|>\\n<|im_start|>assistant\\n";
    }
    std::vector<llama_token> tokens(std::max<int>(256, (int)formatted.size() * 2));
    int32_t count = llama_tokenize(g_vocab, formatted.c_str(), (int32_t)formatted.size(),
                                   tokens.data(), (int32_t)tokens.size(), true, true);
    if (count < 0) {
        tokens.resize((size_t)(-count));
        count = llama_tokenize(g_vocab, formatted.c_str(), (int32_t)formatted.size(),
                               tokens.data(), (int32_t)tokens.size(), true, true);
    }
    if (count <= 0 || count >= (int)llama_n_ctx(g_context)) return env->NewStringUTF("Prompt is too long for the local context.");
    tokens.resize((size_t)count);
    llama_memory_clear(llama_get_memory(g_context), true);
    llama_sampler_reset(g_sampler);

    llama_batch batch = llama_batch_init((int)tokens.size(), 0, 1);
    for (int i = 0; i < (int)tokens.size(); ++i) {
        batch.token[i] = tokens[(size_t)i];
        batch.pos[i] = i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = (i == (int)tokens.size() - 1);
    }
    batch.n_tokens = (int)tokens.size();
    if (llama_decode(g_context, batch) != 0) {
        llama_batch_free(batch);
        return env->NewStringUTF("Local model prompt evaluation failed.");
    }

    std::string output;
    const int limit = std::max(1, std::min(512, (int)max_tokens));
    for (int i = 0; i < limit; ++i) {
        llama_token token = llama_sampler_sample(g_sampler, g_context, -1);
        if (llama_vocab_is_eog(g_vocab, token)) break;
        llama_sampler_accept(g_sampler, token);
        char piece[256];
        int n = llama_token_to_piece(g_vocab, token, piece, sizeof(piece), 0, true);
        if (n > 0) output.append(piece, (size_t)n);
        batch.n_tokens = 1;
        batch.token[0] = token;
        batch.pos[0] = (llama_pos)(tokens.size() + (size_t)i);
        batch.n_seq_id[0] = 1;
        batch.seq_id[0][0] = 0;
        batch.logits[0] = true;
        if (llama_decode(g_context, batch) != 0) break;
    }
    llama_batch_free(batch);
    return env->NewStringUTF(output.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_JarvisInferencePlugin_nativeUnload(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    release_model();
}
