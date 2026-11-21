#include <jni.h>
#include <android/log.h>
#include <llama.h>
#include <algorithm>
#include <mutex>
#include <string>
#include <vector>

#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "JarvisLlama", __VA_ARGS__)

namespace {
std::mutex engineMutex;
bool backendInitialized = false;
llama_model * model = nullptr;
llama_context * context = nullptr;
const llama_vocab * vocab = nullptr;

void releaseLocked() {
    if (context) { llama_free(context); context = nullptr; }
    if (model) { llama_model_free(model); model = nullptr; }
    vocab = nullptr;
}

jstring toJavaString(JNIEnv * env, const std::string & text) {
    std::vector<jchar> utf16;
    for (size_t i = 0; i < text.size();) {
        const unsigned char first = static_cast<unsigned char>(text[i++]);
        uint32_t codepoint = 0xFFFD;
        size_t continuation = 0;
        if (first < 0x80) { codepoint = first; continuation = 0; }
        else if ((first & 0xE0) == 0xC0) { codepoint = first & 0x1F; continuation = 1; }
        else if ((first & 0xF0) == 0xE0) { codepoint = first & 0x0F; continuation = 2; }
        else if ((first & 0xF8) == 0xF0) { codepoint = first & 0x07; continuation = 3; }
        bool valid = i + continuation <= text.size();
        for (size_t j = 0; valid && j < continuation; ++j) {
            const unsigned char next = static_cast<unsigned char>(text[i++]);
            if ((next & 0xC0) != 0x80) { valid = false; break; }
            codepoint = (codepoint << 6) | (next & 0x3F);
        }
        if (!valid || codepoint > 0x10FFFF || (codepoint >= 0xD800 && codepoint <= 0xDFFF)) codepoint = 0xFFFD;
        if (codepoint <= 0xFFFF) utf16.push_back(static_cast<jchar>(codepoint));
        else {
            codepoint -= 0x10000;
            utf16.push_back(static_cast<jchar>(0xD800 + (codepoint >> 10)));
            utf16.push_back(static_cast<jchar>(0xDC00 + (codepoint & 0x3FF)));
        }
    }
    return env->NewString(utf16.empty() ? nullptr : utf16.data(), static_cast<jsize>(utf16.size()));
}

std::vector<llama_token> tokenize(const std::string & text, bool addBos) {
    int32_t capacity = std::max<int32_t>(256, static_cast<int32_t>(text.size() / 2 + 16));
    std::vector<llama_token> tokens(capacity);
    int32_t count = llama_tokenize(vocab, text.c_str(), static_cast<int32_t>(text.size()),
                                   tokens.data(), capacity, addBos, true);
    if (count < 0) {
        capacity = -count;
        tokens.resize(capacity);
        count = llama_tokenize(vocab, text.c_str(), static_cast<int32_t>(text.size()),
                               tokens.data(), capacity, addBos, true);
    }
    if (count < 0) return {};
    tokens.resize(count);
    return tokens;
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_openjarvis_jarvis_JarvisLlamaEngine_nativeLoad(JNIEnv * env, jclass, jstring path) {
    const char * raw = env->GetStringUTFChars(path, nullptr);
    if (!raw) return JNI_FALSE;
    std::lock_guard<std::mutex> lock(engineMutex);
    releaseLocked();
    if (!backendInitialized) { llama_backend_init(); backendInitialized = true; }
    auto params = llama_model_default_params();
    params.n_gpu_layers = 0;
    model = llama_model_load_from_file(raw, params);
    env->ReleaseStringUTFChars(path, raw);
    if (!model) { LOGE("Could not load GGUF model"); return JNI_FALSE; }
    auto ctxParams = llama_context_default_params();
    ctxParams.n_ctx = 2048;
    ctxParams.n_batch = 512;
    ctxParams.n_ubatch = 256;
    ctxParams.n_threads = 4;
    ctxParams.n_threads_batch = 4;
    context = llama_init_from_model(model, ctxParams);
    if (!context) { releaseLocked(); LOGE("Could not create inference context"); return JNI_FALSE; }
    vocab = llama_model_get_vocab(model);
    return vocab ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_openjarvis_jarvis_JarvisLlamaEngine_nativeGenerate(JNIEnv * env, jclass,
        jstring promptValue, jint maxTokens, jfloat temperature) {
    const char * rawPrompt = env->GetStringUTFChars(promptValue, nullptr);
    if (!rawPrompt) return env->NewStringUTF("");
    std::string prompt(rawPrompt);
    env->ReleaseStringUTFChars(promptValue, rawPrompt);

    std::lock_guard<std::mutex> lock(engineMutex);
    if (!model || !context || !vocab) return env->NewStringUTF("JARVIS offline model is not loaded.");
    llama_memory_clear(llama_get_memory(context), true);
    const char * chatTemplate = llama_model_chat_template(model, nullptr);
    if (chatTemplate) {
        llama_chat_message message = {"user", prompt.c_str()};
        std::vector<char> formatted(std::max<size_t>(4096, prompt.size() * 4 + 1024));
        int32_t formattedSize = llama_chat_apply_template(chatTemplate, &message, 1, true, formatted.data(), static_cast<int32_t>(formatted.size()));
        if (formattedSize > 0) {
            if (static_cast<size_t>(formattedSize) >= formatted.size()) {
                formatted.resize(static_cast<size_t>(formattedSize) + 1);
                formattedSize = llama_chat_apply_template(chatTemplate, &message, 1, true, formatted.data(), static_cast<int32_t>(formatted.size()));
            }
            if (formattedSize > 0 && static_cast<size_t>(formattedSize) <= formatted.size()) prompt.assign(formatted.data(), static_cast<size_t>(formattedSize));
        }
    }
    auto input = tokenize(prompt, true);
    if (input.empty() || input.size() >= llama_n_ctx(context)) return env->NewStringUTF("Prompt is empty or exceeds the offline context window.");

    llama_batch batch = llama_batch_get_one(input.data(), static_cast<int32_t>(input.size()));
    if (llama_decode(context, batch) != 0) return env->NewStringUTF("JARVIS could not process the prompt.");

    auto samplerParams = llama_sampler_chain_default_params();
    llama_sampler * sampler = llama_sampler_chain_init(samplerParams);
    llama_sampler_chain_add(sampler, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.92f, 1));
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(std::max(0.05f, std::min(temperature, 1.5f))));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    std::string output;
    const int limit = std::max(1, std::min(static_cast<int>(maxTokens), 1024));
    for (int i = 0; i < limit; ++i) {
        llama_token token = llama_sampler_sample(sampler, context, -1);
        if (llama_vocab_is_eog(vocab, token)) break;
        char piece[256];
        int32_t n = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
        if (n > 0) output.append(piece, n);
        batch = llama_batch_get_one(&token, 1);
        if (llama_decode(context, batch) != 0) break;
    }
    llama_sampler_free(sampler);
    return toJavaString(env, output);
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_JarvisLlamaEngine_nativeUnload(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(engineMutex);
    releaseLocked();
}
