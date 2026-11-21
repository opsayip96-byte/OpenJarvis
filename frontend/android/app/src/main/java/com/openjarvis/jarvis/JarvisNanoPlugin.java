package com.openjarvis.jarvis;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.ActivityCallback;
import com.getcapacitor.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "JarvisNano")
public class JarvisNanoPlugin extends Plugin {
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();
    private static boolean libraryReady = false;
    private static native boolean nativeLoadModel(String path);
    private static native String nativeGenerate(String prompt, int maxTokens);
    private static native void nativeUnload();
    private String activeModelPath = "";

    static {
        try { System.loadLibrary("jarvis_nano"); libraryReady = true; }
        catch (UnsatisfiedLinkError ignored) { libraryReady = false; }
    }

    @Override public void load() {
        super.load();
        File saved = new File(getContext().getFilesDir(), "models/jarvis-nano-v3.gguf");
        if (libraryReady && saved.exists()) {
            executor.execute(() -> {
                if (nativeLoadModel(saved.getAbsolutePath())) activeModelPath = saved.getAbsolutePath();
            });
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("runtimeAvailable", libraryReady);
        out.put("loaded", !activeModelPath.isEmpty());
        out.put("modelPath", activeModelPath);
        call.resolve(out);
    }

    @PluginMethod
    public void importModel(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream", "application/x-gguf"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "modelFilePicked");
    }

    @ActivityCallback
    private void modelFilePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("Model import was cancelled.", "IMPORT_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        executor.execute(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "models");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Could not create model storage.");
                File target = new File(dir, "jarvis-nano-v3.gguf");
                try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                     FileOutputStream out = new FileOutputStream(target)) {
                    if (in == null) throw new IllegalStateException("Could not read selected file.");
                    byte[] buffer = new byte[1024 * 1024];
                    int read; long total = 0;
                    while ((read = in.read(buffer)) != -1) {
                        total += read;
                        if (total > 2L * 1024 * 1024 * 1024) throw new IllegalStateException("Model file exceeds the 2 GB safety limit.");
                        out.write(buffer, 0, read);
                    }
                }
                if (!libraryReady) throw new IllegalStateException("The on-device inference runtime is not available in this APK.");
                if (!nativeLoadModel(target.getAbsolutePath())) throw new IllegalStateException("JARVIS-Nano could not load this GGUF model. Check that it was exported from the v3 checkpoint.");
                activeModelPath = target.getAbsolutePath();
                call.resolve(new JSObject().put("loaded", true).put("model", "jarvis-nano-v3"));
            } catch (Exception e) {
                call.reject("Model import failed: " + e.getMessage(), "MODEL_IMPORT_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void generate(PluginCall call) {
        if (!libraryReady || activeModelPath.isEmpty()) {
            call.reject("Import the JARVIS-Nano v3 GGUF model first.", "MODEL_NOT_LOADED");
            return;
        }
        String prompt = call.getString("prompt", "");
        int maxTokens = Math.max(16, Math.min(call.getInt("maxTokens", 192), 512));
        if (prompt.trim().isEmpty()) { call.reject("Prompt is empty.", "EMPTY_PROMPT"); return; }
        executor.execute(() -> {
            try {
                String answer = nativeGenerate(prompt, maxTokens);
                if (answer == null || answer.trim().isEmpty()) throw new IllegalStateException("The model returned an empty response.");
                call.resolve(new JSObject().put("text", answer));
            } catch (Exception e) {
                call.reject("JARVIS-Nano generation failed: " + e.getMessage(), "GENERATION_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void unload(PluginCall call) {
        executor.execute(() -> {
            if (libraryReady) nativeUnload();
            activeModelPath = "";
            call.resolve();
        });
    }
}
