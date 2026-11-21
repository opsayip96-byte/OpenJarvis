package com.openjarvis.jarvis;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "JarvisOffline")
public class JarvisOfflinePlugin extends Plugin {
    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private volatile boolean modelLoaded = false;
    private File modelDirectory;

    @Override public void load() {
        super.load();
        modelDirectory = new File(getContext().getFilesDir(), "jarvis/models");
        if (!modelDirectory.exists()) modelDirectory.mkdirs();
        String savedModel = getContext().getSharedPreferences("jarvis_offline_ai", 0).getString("model_name", "");
        if (!savedModel.isEmpty() && JarvisLlamaEngine.isAvailable()) {
            File savedFile = new File(modelDirectory, savedModel);
            if (savedFile.isFile() && savedFile.getParentFile().equals(modelDirectory)) {
                inferenceExecutor.execute(() -> modelLoaded = JarvisLlamaEngine.nativeLoad(savedFile.getAbsolutePath()));
            }
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        inferenceExecutor.execute(() -> {
            JSObject result = new JSObject();
            result.put("runtimeAvailable", JarvisLlamaEngine.isAvailable());
            result.put("modelLoaded", modelLoaded);
            result.put("models", listModelNames());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void importModel(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "modelPicked");
    }

    @ActivityCallback
    private void modelPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("Model selection cancelled.", "MODEL_IMPORT_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) { call.reject("No model file was selected.", "MODEL_IMPORT_FAILED"); return; }
        String name = "jarvis-model.gguf";
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("Cannot open selected file.");
            File target = new File(modelDirectory, name);
            try (FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            }
            if (target.length() < 1024 * 1024) {
                target.delete();
                throw new IllegalArgumentException("The selected file is too small to be a GGUF model.");
            }
            call.resolve(new JSObject().put("name", name).put("sizeBytes", target.length()));
        } catch (Exception error) {
            call.reject("Could not import GGUF model: " + error.getMessage(), "MODEL_IMPORT_FAILED", error);
        }
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String name = call.getString("name", "jarvis-model.gguf");
        File model = new File(modelDirectory, name);
        if (!model.getParentFile().equals(modelDirectory) || !model.isFile() || !model.getName().endsWith(".gguf")) {
            call.reject("Choose an imported GGUF model.", "MODEL_NOT_FOUND");
            return;
        }
        inferenceExecutor.execute(() -> {
            boolean loaded = JarvisLlamaEngine.isAvailable() && JarvisLlamaEngine.nativeLoad(model.getAbsolutePath());
            modelLoaded = loaded;
            if (loaded) {
                getContext().getSharedPreferences("jarvis_offline_ai", 0).edit().putString("model_name", name).apply();
                call.resolve(new JSObject().put("loaded", true).put("name", name));
            }
            else call.reject("Offline inference runtime could not load this model. Check the APK native runtime and model compatibility.", "MODEL_LOAD_FAILED");
        });
    }

    @PluginMethod
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt", "").trim();
        int maxTokens = Math.max(1, Math.min(call.getInt("maxTokens", 384), 1024));
        float temperature = Math.max(0.05f, Math.min(call.getFloat("temperature", 0.7f), 1.5f));
        if (!modelLoaded) { call.reject("Load a GGUF model before using offline chat.", "MODEL_NOT_LOADED"); return; }
        if (prompt.isEmpty()) { call.reject("Prompt cannot be empty.", "EMPTY_PROMPT"); return; }
        inferenceExecutor.execute(() -> {
            try {
                String text = JarvisLlamaEngine.nativeGenerate(prompt, maxTokens, temperature);
                call.resolve(new JSObject().put("text", text).put("engine", "JARVIS Local Engine (llama.cpp)"));
            } catch (Exception error) {
                call.reject("Offline generation failed: " + error.getMessage(), "OFFLINE_GENERATION_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        inferenceExecutor.execute(() -> {
            if (JarvisLlamaEngine.isAvailable()) JarvisLlamaEngine.nativeUnload();
            modelLoaded = false;
            getContext().getSharedPreferences("jarvis_offline_ai", 0).edit().remove("model_name").apply();
            call.resolve();
        });
    }

    private JSArray listModelNames() {
        JSArray names = new JSArray();
        File[] files = modelDirectory == null ? null : modelDirectory.listFiles((dir, name) -> name.endsWith(".gguf"));
        if (files != null) for (File file : files) names.put(new JSObject().put("name", file.getName()).put("sizeBytes", file.length()));
        return names;
    }

    @Override protected void handleOnDestroy() {
        if (JarvisLlamaEngine.isAvailable() && modelLoaded) JarvisLlamaEngine.nativeUnload();
        inferenceExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
