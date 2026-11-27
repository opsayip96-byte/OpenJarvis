#include <jni.h>
#include "cactus.h"
#include <android/log.h>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <mutex>
#include <string>
#include <vector>

namespace {
std::mutex model_mutex;
bool model_initialized = false;

void throwJava(JNIEnv* env, const std::string& message) {
    jclass type = env->FindClass("java/lang/IllegalStateException");
    if (type) env->ThrowNew(type, message.c_str());
}

std::string fromJava(JNIEnv* env, jstring value) {
    if (!value) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (!chars) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

std::string cactusError(const std::string& fallback) {
    const char* detail = cactus_last_error();
    return detail && detail[0] ? std::string(detail) : fallback;
}
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeInitialize(
    JNIEnv* env, jclass, jstring modelPath, jint contextSize) {
    std::lock_guard<std::mutex> guard(model_mutex);
    const std::string path = fromJava(env, modelPath);
    if (path.empty()) {
        throwJava(env, "JARVIS Core model file path is empty.");
        return JNI_FALSE;
    }

    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throwJava(env, "Cannot open the downloaded .cact model file.");
        return JNI_FALSE;
    }
    std::vector<unsigned char> weights(
        (std::istreambuf_iterator<char>(input)),
        std::istreambuf_iterator<char>()
    );
    if (weights.size() < 1024 * 1024) {
        throwJava(env, "The .cact model file is incomplete or too small.");
        return JNI_FALSE;
    }
    if (weights.size() < 4 || weights[0] != 'C' || weights[1] != 'A' ||
        weights[2] != 'C' || weights[3] != 'T') {
        throwJava(env, "The downloaded model does not have the expected CACT file signature. Delete it and download again.");
        return JNI_FALSE;
    }

    if (model_initialized) {
        cactus_reset();
        model_initialized = false;
    }

    if (cactus_load(weights.data(), static_cast<unsigned long long>(weights.size())) != 0) {
        throwJava(env, "Cactus could not load the .cact weights: " +
            cactusError("unknown model archive error"));
        return JNI_FALSE;
    }

    const int initResult = cactus_init(
        "You are JARVIS, a precise, helpful and discreet personal AI assistant. Be truthful, warm and concise.",
        nullptr,
        nullptr
    );
    if (initResult != 0) {
        throwJava(env, "Cactus engine initialization failed: " +
            cactusError("engine initialization returned " + std::to_string(initResult)));
        return JNI_FALSE;
    }

    cactus_set_threads(4);
    model_initialized = true;
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeComplete(
    JNIEnv* env, jclass, jstring messagesJson, jstring optionsJson, jint maxTokens) {
    std::lock_guard<std::mutex> guard(model_mutex);
    if (!model_initialized) {
        throwJava(env, "JARVIS Core is not loaded. Install and initialize the local model first.");
        return nullptr;
    }
    const std::string messages = fromJava(env, messagesJson);
    if (messages.empty()) {
        throwJava(env, "No conversation messages were supplied.");
        return nullptr;
    }

    const int tokenLimit = maxTokens < 64 ? 64 : (maxTokens > 1024 ? 1024 : maxTokens);
    const size_t capacity = static_cast<size_t>(tokenLimit) * 256 + 65536;
    std::vector<char> output(capacity, '\\0');
    const int result = cactus_complete(
        messages.c_str(), nullptr, 0, tokenLimit, output.data(),
        static_cast<int>(output.size())
    );
    if (result <= 0) {
        throwJava(env, "JARVIS Core inference failed: " +
            cactusError("native completion returned " + std::to_string(result)));
        return nullptr;
    }
    const size_t written = static_cast<size_t>(result) < output.size()
        ? static_cast<size_t>(result) : output.size() - 1;
    output[written] = '\\0';
    return env->NewStringUTF(output.data());
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeReset(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> guard(model_mutex);
    if (model_initialized) cactus_reset();
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeUnload(JNIEnv*, jclass) {
    std::lock_guard<std::mutex> guard(model_mutex);
    if (model_initialized) {
        cactus_reset();
        model_initialized = false;
    }
}
