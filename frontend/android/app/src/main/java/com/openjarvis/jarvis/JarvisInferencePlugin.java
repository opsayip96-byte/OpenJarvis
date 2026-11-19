package com.openjarvis.jarvis;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "JarvisInference")
public class JarvisInferencePlugin extends Plugin {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile boolean loaded = false;

    static {
        System.loadLibrary("jarvis_inference");
    }

    private native boolean nativeLoad(String path);
    private native String nativeGenerate(String prompt, int maxTokens);
    private native void nativeUnload();

    @PluginMethod
    public void loadModel(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("Model path is required.", "MODEL_PATH_MISSING");
            return;
        }
        File file = new File(path);
        if (!file.isFile() || !file.canRead()) {
            call.reject("Model file is missing or unreadable.", "MODEL_FILE_UNAVAILABLE");
            return;
        }
        EXECUTOR.execute(() -> {
            try {
                boolean ok = nativeLoad(file.getAbsolutePath());
                loaded = ok;
                if (!ok) { call.reject("JARVIS could not load this GGUF model.", "MODEL_LOAD_FAILED"); return; }
                JSObject result = new JSObject();
                result.put("loaded", true);
                result.put("engine", "llama.cpp");
                result.put("device", "CPU");
                call.resolve(result);
            } catch (Throwable error) {
                loaded = false;
                call.reject("Local inference failed: " + error.getMessage(), "INFERENCE_INIT_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt");
        int maxTokens = call.getInt("maxTokens", 256);
        if (!loaded) { call.reject("Load a local GGUF model first.", "MODEL_NOT_LOADED"); return; }
        if (prompt == null || prompt.trim().isEmpty()) { call.reject("Prompt is empty.", "PROMPT_EMPTY"); return; }
        EXECUTOR.execute(() -> {
            try {
                String answer = nativeGenerate(prompt, maxTokens);
                JSObject result = new JSObject();
                result.put("text", answer);
                result.put("engine", "llama.cpp");
                result.put("local", true);
                call.resolve(result);
            } catch (Throwable error) {
                call.reject("Local generation failed: " + error.getMessage(), "GENERATION_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        EXECUTOR.execute(() -> {
            try { nativeUnload(); loaded = false; call.resolve(new JSObject().put("loaded", false)); }
            catch (Throwable error) { call.reject("Could not unload local model.", "MODEL_UNLOAD_FAILED", error); }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(new JSObject().put("loaded", loaded).put("engine", "llama.cpp"));
    }
}
