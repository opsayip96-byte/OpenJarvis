#include <jni.h>
#include <mutex>
#include <string>
#include <vector>
#include <cstring>
#include "cactus.h"

namespace {
std::mutex engineMutex;
bool modelLoaded = false;

void throwJava(JNIEnv* env, const std::string& message) {
    jclass type = env->FindClass("java/lang/IllegalStateException");
    if (type) env->ThrowNew(type, message.c_str());
}

std::string lastError(const char* fallback) {
    const char* detail = cactus_last_error();
    return detail && detail[0] ? std::string(detail) : std::string(fallback);
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

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_NeedleNativePlugin_nativeLoadModel(
    JNIEnv* env, jclass, jbyteArray model, jstring systemPrompt, jstring toolsJson) {
    std::lock_guard<std::mutex> guard(engineMutex);
    if (!model) {
        throwJava(env, "Needle model bytes are missing.");
        return;
    }
    const jsize length = env->GetArrayLength(model);
    if (length <= 0) {
        throwJava(env, "Needle model file is empty.");
        return;
    }
    jbyte* bytes = env->GetByteArrayElements(model, nullptr);
    if (!bytes) {
        throwJava(env, "Could not access Needle model memory.");
        return;
    }
    cactus_set_threads(4);
    const int loaded = cactus_load(
        reinterpret_cast<const unsigned char*>(bytes),
        static_cast<unsigned long long>(length));
    env->ReleaseByteArrayElements(model, bytes, JNI_ABORT);
    if (loaded < 0) {
        throwJava(env, lastError("Cactus could not load the Needle model."));
        modelLoaded = false;
        return;
    }

    const std::string prompt = fromJava(env, systemPrompt);
    const std::string tools = fromJava(env, toolsJson);
    const int initialized = cactus_init(
        prompt.empty() ? "You are Needle 3, JARVIS's local tool-routing model." : prompt.c_str(),
        tools.empty() ? "[]" : tools.c_str(),
        nullptr);
    if (initialized < 0) {
        throwJava(env, lastError("Cactus could not initialize Needle."));
        modelLoaded = false;
        return;
    }
    modelLoaded = true;
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_NeedleNativePlugin_nativeInit(
    JNIEnv* env, jclass, jstring systemPrompt, jstring toolsJson) {
    std::lock_guard<std::mutex> guard(engineMutex);
    if (!modelLoaded) {
        throwJava(env, "Load the Needle model before initializing tools.");
        return;
    }
    cactus_reset();
    const std::string prompt = fromJava(env, systemPrompt);
    const std::string tools = fromJava(env, toolsJson);
    const int initialized = cactus_init(
        prompt.empty() ? "You are Needle 3, JARVIS's local tool-routing model." : prompt.c_str(),
        tools.empty() ? "[]" : tools.c_str(),
        nullptr);
    if (initialized < 0) {
        throwJava(env, lastError("Cactus could not initialize Needle tools."));
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_openjarvis_jarvis_NeedleNativePlugin_nativeComplete(
    JNIEnv* env, jclass, jstring input, jint maxTokens) {
    std::lock_guard<std::mutex> guard(engineMutex);
    if (!modelLoaded) {
        throwJava(env, "Load the Needle model before running inference.");
        return nullptr;
    }
    const std::string prompt = fromJava(env, input);
    if (prompt.empty()) {
        throwJava(env, "Enter a prompt for Needle.");
        return nullptr;
    }
    std::vector<char> output(65536, '\0');
    const int result = cactus_complete(
        prompt.c_str(), nullptr, 0,
        maxTokens > 0 ? maxTokens : 256,
        output.data(), static_cast<int>(output.size()));
    if (result < 0) {
        throwJava(env, lastError("Needle inference failed."));
        return nullptr;
    }
    output.back() = '\0';
    return env->NewStringUTF(output.data());
}

extern "C" JNIEXPORT void JNICALL
Java_com_openjarvis_jarvis_NeedleNativePlugin_nativeReset(JNIEnv* env, jclass) {
    std::lock_guard<std::mutex> guard(engineMutex);
    if (modelLoaded) cactus_reset();
}
