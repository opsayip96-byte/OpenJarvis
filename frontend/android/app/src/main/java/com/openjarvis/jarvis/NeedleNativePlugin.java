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
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NeedleNative")
public class NeedleNativePlugin extends Plugin {
    private static final String MODEL_URL =
        "https://huggingface.co/Cactus-Compute/needle3/resolve/d6c7d6a2e9655505e0f8e23339356dd1705900eb/needle3.cact";
    private static final String MODEL_SHA256 = "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38";
    private static final String DEFAULT_PROMPT =
        "You are Needle 3, JARVIS's private on-device tool-routing brain. " +
        "You do not provide general conversation. Select only a supplied tool when the user's request clearly matches it. " +
        "Never invent tools or arguments. Return no function call for greetings, questions, or unsupported actions.";
    private static final String DEFAULT_TOOLS =
        "[{\"name\":\"speak_text\",\"description\":\"Speak the supplied short text aloud using JARVIS's Android voice. Use only when the user explicitly asks JARVIS to say or speak something.\",\"parameters\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\",\"description\":\"The exact text to speak\"}},\"required\":[\"text\"]}},{\"name\":\"open_app_settings\",\"description\":\"Open Android settings for the JARVIS app so the user can change app permissions.\",\"parameters\":{\"type\":\"object\",\"properties\":{},\"required\":[]}},{\"name\":\"stop_speaking\",\"description\":\"Stop JARVIS's current spoken audio immediately.\",\"parameters\":{\"type\":\"object\",\"properties\":{},\"required\":[]}}]";
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static volatile boolean nativeAvailable;
    private static volatile boolean modelLoaded;
    private static volatile String loadedSystemPrompt = "";
    private static volatile String loadedToolsJson = "";

    private static native void nativeLoadModel(byte[] model, String systemPrompt, String toolsJson);
    private static native void nativeInit(String systemPrompt, String toolsJson);\n    private static native String nativeComplete(String input, int maxTokens);
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

    /**
     * Load the downloaded model on demand. The native runtime is process-local,
     * so it must be reloaded after Android kills and recreates the app process.
     */
    private synchronized int ensureModelLoaded(String systemPrompt, String toolsJson) throws Exception {
        String prompt = systemPrompt == null || systemPrompt.isEmpty() ? DEFAULT_PROMPT : systemPrompt;
        String tools = toolsJson == null || toolsJson.isEmpty() ? DEFAULT_TOOLS : toolsJson;
        if (modelLoaded) {
            if (!prompt.equals(loadedSystemPrompt) || !tools.equals(loadedToolsJson)) {
                nativeInit(prompt, tools);
                loadedSystemPrompt = prompt;
                loadedToolsJson = tools;
            }
            return (int) modelFile().length();
        }
        if (!nativeAvailable) {
            throw new IllegalStateException("The Needle native engine is not included in this APK.");
        }
        File model = modelFile();
        if (!model.isFile() || model.length() == 0) {
            throw new IllegalStateException("Download Needle 3 in Settings before sending a local message.");
        }
        if (model.length() > 100L * 1024L * 1024L) {
            throw new IllegalStateException("Needle model file is unexpectedly large. Refusing to load it.");
        }
        byte[] bytes;
        try (FileInputStream input = new FileInputStream(model);
             ByteArrayOutputStream output = new ByteArrayOutputStream((int) model.length())) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            bytes = output.toByteArray();
        }
        nativeLoadModel(bytes, prompt, tools);
        loadedSystemPrompt = prompt;
        loadedToolsJson = tools;
        modelLoaded = true;
        return bytes.length;
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
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                        digest.update(buffer, 0, count);
                    }
                    output.getFD().sync();
                    StringBuilder actualHash = new StringBuilder();
                    for (byte value : digest.digest()) actualHash.append(String.format("%02x", value & 0xff));
                    if (!MODEL_SHA256.contentEquals(actualHash)) {
                        throw new IllegalStateException("Needle model checksum did not match the pinned release.");
                    }
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
                int bytes = ensureModelLoaded(
                    call.getString("systemPrompt", DEFAULT_PROMPT),
                    call.getString("toolsJson", "[]"));
                call.resolve(new JSObject().put("loaded", true).put("bytes", bytes));
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
                // Lazy-load the local model so chat still works after Android
                // process death or a normal app restart, without a manual RAM-load step.
                ensureModelLoaded(DEFAULT_PROMPT, DEFAULT_TOOLS);
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
