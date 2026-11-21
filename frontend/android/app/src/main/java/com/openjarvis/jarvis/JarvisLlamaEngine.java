package com.openjarvis.jarvis;

public final class JarvisLlamaEngine {
    private static boolean available;

    static {
        try {
            System.loadLibrary("jarvis_llama");
            available = true;
        } catch (UnsatisfiedLinkError error) {
            available = false;
        }
    }

    private JarvisLlamaEngine() {}

    public static boolean isAvailable() { return available; }
    public static native boolean nativeLoad(String absolutePath);
    public static native String nativeGenerate(String prompt, int maxTokens, float temperature);
    public static native void nativeUnload();
}
