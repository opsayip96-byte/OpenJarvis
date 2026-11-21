#include <jni.h>
#include <string>
#include <vector>
#include <mutex>
#include <algorithm>
#include <android/log.h>
#include "llama.h"

#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "JARVIS-NANO", __VA_ARGS__)

static std::mutex g_mutex;
static llama_model *g_model = nullptr;
static llama_context *g_ctx = nullptr;
static const llama_vocab *g_vocab = nullptr;

static void unload_locked() {
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    g_vocab = nullptr;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_openjarvis_jarvis_JarvisNanoPlugin_nativeLoadModel(JNIEnv *env, jclass, jstring pathValue) {
    const char *path = env->GetStringUTFChars(pathValue, nullptr);
    std::lock_guard<std::mutex> lock(g_mutex);
    unload_locked();
    auto model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    g_model = llama_model_load_from_file(path, model_params);
    env->ReleaseStringUTFChars(pathValue, path);
    if (!g_model) { LOGE("Model load failed"); return JNI_FALSE; }
    auto ctx_params = llama_context_default_params();
    ctx_params.n_ctx = 1024;
    ctx_params.n_batch = 512;
    ctx_params.n_threads = 4;
    ctx_params.n_threads_batch = 4;
    g_ctx = llama_init_from_model(g_model, ctx_params);
    if (!g_ctx) { unload_locked(); LOGE("Context init failed"); return JNI_FALSE; }
    g_vocab = llama_model_get_vocab(g_model);
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_openjarvis_jarvis_JarvisNanoPlugin_nativeGenerate(JNIEnv *env, jclass, jstring promptValue, jint maxTokens) {
    const char *prompt = env->GetStringUTFChars(promptValue, nullptr);
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_model || !g_ctx || !g_vocab) {
        env->ReleaseStringUTFChars(promptValue, prompt);
        return env->NewStringUTF("");
    }
    std::vector<llama_token> tokens(std::max<size_t>(2048, strlen(prompt) + 16));
    int n = llama_tokenize(g_vocab, prompt, (int)strlen(prompt), tokens.data(), (int)tokens.size(), true, true);
    if (n < 0) {
        tokens.resize((size_t)(-n));
        n = llama_tokenize(g_vocab, prompt, (int)strlen(prompt), tokens.data(), (int)tokens.size(), true, true);
    }
    env->ReleaseStringUTFChars(promptValue, prompt);
    if (n <= 0 || n > 1024) return env->NewStringUTF("Prompt is too long for JARVIS-Nano's 1024-token context.");
    tokens.resize((size_t)n);
    llama_memory_clear(llama_get_memory(g_ctx), true);
    auto batch = llama_batch_get_one(tokens.data(), (int)tokens.size());
    if (llama_decode(g_ctx, batch) != 0) return env->NewStringUTF("JARVIS-Nano could not process this prompt.");
    std::string output;
    std::vector<char> piece(256);
    const int limit = std::max(1, std::min((int)maxTokens, 512));
    for (int i = 0; i < limit; ++i) {
        const float *logits = llama_get_logits_ith(g_ctx, -1);
        if (!logits) break;
        llama_token next = 0;
        float best = logits[0];
        for (llama_token t = 1; t < llama_vocab_n_tokens(g_vocab); ++t) {
            if (logits[t] > best) { best = logits[t]; next = t; }
        }
        if (llama_vocab_is_eog(g_vocab, next)) break;
        int n_piece = llama_token_to_piece(g_vocab, next, piece.data(), (int)piece.size(), 0, true);
        if (n_piece > 0) {
            std::string part(piece.data(), (size_t)n_piece);
            if (part.find("[EOS]") != std::string::npos) break;
            output += part;
            if (output.size() >= 16000) break;
        }
        auto next_batch = llama_batch_get_one(&next, 1);
        if (llama_decode(g_ctx, next_batch) != 0) break;
    }
    return env->NewStringUTF(output.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_JarvisNanoPlugin_nativeUnload(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(g_mutex);
    unload_locked();
}
