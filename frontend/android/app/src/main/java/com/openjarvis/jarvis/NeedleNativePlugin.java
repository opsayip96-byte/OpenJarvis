package com.openjarvis.jarvis;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NeedleNative")
public class NeedleNativePlugin extends Plugin {
    private static final String MODEL_URL =
        "https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact";
    private static final String DEFAULT_PROMPT =
        "You are Needle 3, JARVIS's private on-device tool-routing brain. " +
        "Choose only from the supplied tools. Never invent tools or arguments. " +
        "Return structured tool calls when a supplied tool matches the request.";
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static volatile boolean nativeAvailable;
    private static volatile boolean modelLoaded;

    private static native void nativeLoadModel(byte[] model, String systemPrompt, String toolsJson);
    private static native String nativeComplete(String input, int maxTokens);
    private static native void nativeReset();

    @Override
    public void load() {
        super.load();
        try {
            System.loadLibrary("needlebridge");
            nativeAvailable = true;
        } catch (UnsatisfiedLinkError error) {
            nativeAvailable = false;
        }
    }

    private File modelFile() {
        return new File(getContext().getFilesDir(), "needle3.cact");
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        File model = modelFile();
        JSObject result = new JSObject();
        result.put("nativeAvailable", nativeAvailable);
        result.put("modelDownloaded", model.isFile() && model.length() > 0);
        result.put("modelBytes", model.isFile() ? model.length() : 0);
        result.put("modelLoaded", modelLoaded);
        call.resolve(result);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        WORKER.execute(() -> {
            File target = modelFile();
            File partial = new File(target.getParentFile(), "needle3.cact.part");
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(MODEL_URL).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(120000);
                connection.setRequestProperty("User-Agent", "OpenJarvis-Android/Needle3");
                connection.connect();
                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("Model download failed (HTTP " + status + ").");
                }
                long expected = connection.getContentLength();
                if (expected > 100L * 1024L * 1024L) {
                    throw new IllegalStateException("Unexpected model size. Download cancelled.");
                }
                try (InputStream input = connection.getInputStream();
                     FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.getFD().sync();
                }
                if (!partial.isFile() || partial.length() < 1024 * 1024) {
                    throw new IllegalStateException("Downloaded model is incomplete.");
                }
                if (target.exists() && !target.delete()) {
                    throw new IllegalStateException("Could not replace the previous model file.");
                }
                if (!partial.renameTo(target)) {
                    throw new IllegalStateException("Could not save the downloaded model.");
                }
                call.resolve(new JSObject().put("downloaded", true).put("bytes", target.length()));
            } catch (Exception error) {
                partial.delete();
                call.reject("Needle download failed: " + error.getMessage(), "NEEDLE_DOWNLOAD_FAILED", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        WORKER.execute(() -> {
            try {
                if (!nativeAvailable) throw new IllegalStateException("The Needle native engine is not included in this APK.");
                File model = modelFile();
                if (!model.isFile() || model.length() == 0) {
                    throw new IllegalStateException("Download Needle 3 before loading it.");
                }
                byte[] bytes;\n                try (FileInputStream input = new FileInputStream(model);\n                     ByteArrayOutputStream output = new ByteArrayOutputStream((int) model.length())) {\n                    byte[] buffer = new byte[64 * 1024];\n                    int count;\n                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);\n                    bytes = output.toByteArray();\n                }
                nativeLoadModel(bytes, call.getString("systemPrompt", DEFAULT_PROMPT),
                    call.getString("toolsJson", "[]"));
                modelLoaded = true;
                call.resolve(new JSObject().put("loaded", true).put("bytes", bytes.length));
            } catch (Exception error) {
                modelLoaded = false;
                call.reject("Needle load failed: " + error.getMessage(), "NEEDLE_LOAD_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void complete(PluginCall call) {
        WORKER.execute(() -> {
            try {
                if (!modelLoaded) throw new IllegalStateException("Load Needle 3 first.");
                String input = call.getString("input", "").trim();
                if (input.isEmpty()) throw new IllegalArgumentException("Enter a prompt.");
                int maxTokens = call.getInt("maxTokens", 256);
                String response = nativeComplete(input, Math.max(16, Math.min(maxTokens, 1024)));
                call.resolve(new JSObject().put("response", response));
            } catch (Exception error) {
                call.reject("Needle inference failed: " + error.getMessage(), "NEEDLE_INFERENCE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void reset(PluginCall call) {
        WORKER.execute(() -> {
            try {
                if (modelLoaded) nativeReset();
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not reset Needle.", "NEEDLE_RESET_FAILED", error);
            }
        });
    }
}
