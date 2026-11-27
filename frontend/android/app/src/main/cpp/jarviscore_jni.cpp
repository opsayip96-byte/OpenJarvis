#include <jni.h>
#include "cactus.h"
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

namespace {
std::mutex model_mutex;
cactus_model_t model_handle = nullptr;

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
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeInitialize(
    JNIEnv* env, jclass, jstring modelPath, jint contextSize) {
    std::lock_guard<std::mutex> guard(model_mutex);
    const std::string path = fromJava(env, modelPath);
    if (path.empty()) {
        throwJava(env, "JARVIS Core model path is empty.");
        return JNI_FALSE;
    }
    if (model_handle) {
        cactus_destroy(model_handle);
        model_handle = nullptr;
    }
    const size_t safe_context = static_cast<size_t>(
        contextSize < 1024 ? 1024 : (contextSize > 8192 ? 8192 : contextSize)
    );
    model_handle = cactus_init(path.c_str(), nullptr, false);
    if (!model_handle) {
        throwJava(env, "Cactus could not initialize JARVIS Core. Check that the model download is complete and compatible.");
        return JNI_FALSE;
    }
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeComplete(
    JNIEnv* env, jclass, jstring messagesJson, jstring optionsJson, jint maxTokens) {
    std::lock_guard<std::mutex> guard(model_mutex);
    if (!model_handle) {
        throwJava(env, "JARVIS Core is not loaded. Install and initialize the local model first.");
        return nullptr;
    }
    const std::string messages = fromJava(env, messagesJson);
    const std::string options = fromJava(env, optionsJson);
    if (messages.empty()) {
        throwJava(env, "No conversation messages were supplied.");
        return nullptr;
    }
    const size_t capacity = static_cast<size_t>(
        (maxTokens < 64 ? 64 : (maxTokens > 2048 ? 2048 : maxTokens)) * 64 + 65536
    );
    std::vector<char> output(capacity, '\0');
    const int32_t result = cactus_complete(
        model_handle,
        messages.c_str(),
        output.data(),
        output.size(),
        options.empty() ? nullptr : options.c_str(),
        nullptr,
        nullptr,
        nullptr,
        nullptr,
        0
    );
    if (result <= 0) {
        throwJava(env, "JARVIS Core inference failed. Native error code: " + std::to_string(result));
        return nullptr;
    }
    const size_t written = static_cast<size_t>(result) < output.size()
        ? static_cast<size_t>(result) : output.size() - 1;
    output[written] = '\0';
    return env->NewStringUTF(output.data());
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeReset(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> guard(model_mutex);
    if (model_handle) cactus_reset(model_handle);
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_JarvisCoreNativePlugin_nativeUnload(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> guard(model_mutex);
    if (model_handle) {
        cactus_destroy(model_handle);
        model_handle = nullptr;
    }
}
