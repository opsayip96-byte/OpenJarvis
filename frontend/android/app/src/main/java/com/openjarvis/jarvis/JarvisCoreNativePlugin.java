package com.openjarvis.jarvis;

import android.os.StatFs;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "JarvisCoreNative")
public class JarvisCoreNativePlugin extends Plugin {
    private static final String DEFAULT_MODEL_SLUG = "qwen3-1.7b";
    private static final String VISION_MODEL_SLUG = "lfm2.5-vl-1.6b";
    private static final String MODEL_API_BASE = "https://vlqqczxwyaodtcdmdmlw.supabase.co/functions/v1/get-models";
    private static final String SUPABASE_ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZscXFjenh3eWFvZHRjZG1kbWx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE1MTg2MzIsImV4cCI6MjA2NzA5NDYzMn0.nBzqGuK9j6RZ6mOPWU2boAC_5H9XDs-fPpo5P3WZYbI";
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static volatile boolean nativeAvailable = false;
    private static volatile boolean modelLoaded = false;
    private static volatile String modelLoadedSlug = null;

    private static native boolean nativeInitialize(String modelPath, int contextSize);
    private static native String nativeComplete(String messagesJson, String optionsJson, int maxTokens);
    private static native void nativeReset();
    private static native void nativeUnload();

    @Override
    public void load() {
        super.load();
        try {
            System.loadLibrary("jarviscore");
            nativeAvailable = true;
        } catch (UnsatisfiedLinkError error) {
            nativeAvailable = false;
        }
    }

    private String checkedModelSlug(String requested) {
        String slug = requested == null || requested.trim().isEmpty() ? DEFAULT_MODEL_SLUG : requested.trim();
        if (!DEFAULT_MODEL_SLUG.equals(slug) && !VISION_MODEL_SLUG.equals(slug)) {
            throw new IllegalArgumentException("Unsupported local model: " + slug);
        }
        return slug;
    }

    private File modelsDirectory() {
        return new File(getContext().getFilesDir(), "models");
    }

    private File modelDirectory(String slug) {
        return new File(modelsDirectory(), slug);
    }

    private String modelApi(String slug) {
        return MODEL_API_BASE + "?slug=" + slug + "&sdk_name=flutter&sdk_version=1.3.0";
    }

    private long directoryBytes(File directory) {
        if (!directory.exists()) return 0;
        if (directory.isFile()) return directory.length();
        File[] children = directory.listFiles();
        if (children == null) return 0;
        long total = 0;
        for (File child : children) total += directoryBytes(child);
        return total;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        final String slug;
        try { slug = checkedModelSlug(call.getString("modelSlug")); }
        catch (Exception error) { call.reject(error.getMessage()); return; }
        File model = modelDirectory(slug);
        long bytes = directoryBytes(model);
        JSObject result = new JSObject();
        result.put("nativeAvailable", nativeAvailable);
        result.put("modelDownloaded", model.isDirectory() && bytes > 50L * 1024L * 1024L);
        result.put("modelBytes", bytes);
        result.put("modelLoaded", modelLoaded && slug.equals(modelLoadedSlug));
        result.put("modelSlug", slug);
        call.resolve(result);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        final String slug;
        try { slug = checkedModelSlug(call.getString("modelSlug")); }
        catch (Exception error) { call.reject(error.getMessage()); return; }

        WORKER.execute(() -> {
            File models = modelsDirectory();
            File target = modelDirectory(slug);
            File zip = new File(models, slug + ".zip.part");
            File staging = new File(models, slug + ".installing");
            HttpURLConnection metadataConnection = null;
            HttpURLConnection downloadConnection = null;
            try {
                if (!nativeAvailable) throw new IllegalStateException("The on-device Cactus runtime is missing from this APK.");
                if (target.isDirectory() && directoryBytes(target) > 50L * 1024L * 1024L) {
                    call.resolve(new JSObject().put("downloaded", true).put("bytes", directoryBytes(target)).put("modelSlug", slug));
                    return;
                }
                if (!models.exists() && !models.mkdirs()) throw new IllegalStateException("Cannot create the model storage directory.");

                String downloadUrl;
                long expectedModelMb;
                if (DEFAULT_MODEL_SLUG.equals(slug)) {
                    // The Cactus catalogue currently returns HTTP 404 for this slug.
                    // Use the verified official Cactus-Compute Hugging Face int4 archive
                    // directly instead of making installation depend on that catalogue.
                    downloadUrl = "https://huggingface.co/Cactus-Compute/Qwen3-1.7B/resolve/main/weights/qwen3-1.7b-int4.zip";
                    expectedModelMb = 960;
                } else {
                    metadataConnection = (HttpURLConnection) new URL(modelApi(slug)).openConnection();
                    metadataConnection.setConnectTimeout(20000);
                    metadataConnection.setReadTimeout(30000);
                    metadataConnection.setRequestProperty("apikey", SUPABASE_ANON_KEY);
                    metadataConnection.setRequestProperty("Authorization", "Bearer " + SUPABASE_ANON_KEY);
                    int metadataStatus = metadataConnection.getResponseCode();
                    if (metadataStatus != HttpURLConnection.HTTP_OK) {
                        String detail = "";
                        try { detail = readAll(metadataConnection.getErrorStream()); } catch (Exception ignored) {}
                        throw new IllegalStateException("Model catalogue request failed (HTTP " + metadataStatus + ")" +
                            (detail.isEmpty() ? "." : ": " + detail));
                    }
                    JSONObject metadata = new JSONObject(readAll(metadataConnection.getInputStream()));
                    downloadUrl = metadata.optString("download_url", "");
                    expectedModelMb = metadata.optLong("size_mb", 1200);
                    if (downloadUrl.isEmpty()) throw new IllegalStateException("The Cactus catalogue did not return a model download URL.");
                }
                long requiredBytes = Math.max(900L * 1024L * 1024L, expectedModelMb * 1024L * 1024L);
                StatFs stat = new StatFs(models.getAbsolutePath());
                if (stat.getAvailableBytes() < requiredBytes + 300L * 1024L * 1024L) {
                    throw new IllegalStateException("Not enough free storage. " + slug + " needs about " + expectedModelMb + " MB plus temporary extraction space.");
                }

                downloadConnection = (HttpURLConnection) new URL(downloadUrl).openConnection();
                downloadConnection.setInstanceFollowRedirects(true);
                downloadConnection.setConnectTimeout(30000);
                downloadConnection.setReadTimeout(180000);
                downloadConnection.setRequestProperty("User-Agent", "OpenJarvis-Android/1.0");
                int downloadStatus = downloadConnection.getResponseCode();
                if (downloadStatus != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("Model download failed (HTTP " + downloadStatus + ").");
                }
                long total = downloadConnection.getContentLengthLong();
                try (InputStream input = new BufferedInputStream(downloadConnection.getInputStream());
                     FileOutputStream fileOutput = new FileOutputStream(zip);
                     BufferedOutputStream output = new BufferedOutputStream(fileOutput)) {
                    byte[] buffer = new byte[1024 * 256];
                    long received = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                        received += count;
                        if (total > 0) {
                            notifyListeners("coreDownloadProgress", new JSObject()
                                .put("progress", Math.min(1.0, (double) received / total))
                                .put("receivedBytes", received)
                                .put("totalBytes", total)
                                .put("stage", "Downloading " + slug)
                                .put("modelSlug", slug), true);
                        }
                    }
                    output.flush();
                    fileOutput.getFD().sync();
                }

                notifyListeners("coreDownloadProgress", new JSObject()
                    .put("progress", 1.0).put("receivedBytes", zip.length())
                    .put("totalBytes", zip.length()).put("stage", "Extracting " + slug)
                    .put("modelSlug", slug), true);

                if (staging.exists()) deleteRecursively(staging);
                if (!staging.mkdirs()) throw new IllegalStateException("Could not prepare the model extraction directory.");
                extractModelZip(zip, staging);
                long extractedBytes = directoryBytes(staging);
                if (extractedBytes < 50L * 1024L * 1024L) {
                    throw new IllegalStateException("The downloaded model archive is incomplete or empty.");
                }
                if (target.exists()) deleteRecursively(target);
                if (!staging.renameTo(target)) throw new IllegalStateException("Could not move the verified model into its final location.");
                zip.delete();
                notifyListeners("coreDownloadProgress", new JSObject()
                    .put("progress", 1.0).put("receivedBytes", extractedBytes)
                    .put("totalBytes", extractedBytes).put("stage", "Model ready")
                    .put("modelSlug", slug), true);
                call.resolve(new JSObject().put("downloaded", true).put("bytes", extractedBytes).put("modelSlug", slug));
            } catch (Exception error) {
                zip.delete();
                if (staging.exists()) deleteRecursively(staging);
                call.reject("JARVIS model download failed: " + error.getMessage(), "JARVIS_CORE_DOWNLOAD_FAILED", error);
            } finally {
                if (metadataConnection != null) metadataConnection.disconnect();
                if (downloadConnection != null) downloadConnection.disconnect();
            }
        });
    }

    private void extractModelZip(File zipFile, File destination) throws Exception {
        String rootFolder = null;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buffer = new byte[1024 * 128];
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (name.startsWith("/") || name.contains("../") || name.equals("..")) {
                    throw new IllegalStateException("Unsafe path in model archive.");
                }
                if (rootFolder == null) {
                    int slash = name.indexOf('/');
                    if (slash > 0 && (entry.isDirectory() || slash < name.length() - 1)) {
                        rootFolder = name.substring(0, slash);
                    }
                }
                String relative = name;
                if (rootFolder != null && (relative.equals(rootFolder) || relative.startsWith(rootFolder + "/"))) {
                    relative = relative.equals(rootFolder) ? "" : relative.substring(rootFolder.length() + 1);
                }
                if (relative.isEmpty()) {
                    zip.closeEntry();
                    continue;
                }
                File output = new File(destination, relative);
                String base = destination.getCanonicalPath() + File.separator;
                if (!output.getCanonicalPath().startsWith(base)) throw new IllegalStateException("Unsafe model archive path.");
                if (entry.isDirectory()) {
                    if (!output.exists() && !output.mkdirs()) throw new IllegalStateException("Could not create model directory.");
                } else {
                    File parent = output.getParentFile();
                    if (!parent.exists() && !parent.mkdirs()) throw new IllegalStateException("Could not create model folder.");
                    try (FileOutputStream stream = new FileOutputStream(output)) {
                        int count;
                        while ((count = zip.read(buffer)) != -1) stream.write(buffer, 0, count);
                        stream.getFD().sync();
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private String materializeImageInputs(String messagesJson, List<File> temporaryImages) throws Exception {
        JSONArray messages = new JSONArray(messagesJson);
        for (int i = 0; i < messages.length(); i++) {
            JSONObject message = messages.optJSONObject(i);
            if (message == null) continue;
            JSONArray images = message.optJSONArray("images");
            if (images == null) continue;
            JSONArray paths = new JSONArray();
            for (int j = 0; j < images.length(); j++) {
                String encoded = images.optString(j, "");
                if (encoded.isEmpty()) continue;
                File existing = new File(encoded);
                if (existing.isFile()) {
                    paths.put(existing.getAbsolutePath());
                    continue;
                }
                int comma = encoded.indexOf(',');
                if (encoded.startsWith("data:") && comma >= 0) encoded = encoded.substring(comma + 1);
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                File imageDir = new File(getContext().getCacheDir(), "jarvis_vision_inputs");
                if (!imageDir.exists() && !imageDir.mkdirs()) throw new IllegalStateException("Could not prepare local vision image storage.");
                File image = new File(imageDir, "vision_" + System.nanoTime() + "_" + j + ".jpg");
                try (FileOutputStream output = new FileOutputStream(image)) {
                    output.write(bytes);
                    output.getFD().sync();
                }
                temporaryImages.add(image);
                paths.put(image.getAbsolutePath());
            }
            message.put("images", paths);
        }
        return messages.toString();
    }

    private String readAll(InputStream input) throws Exception {
        try (InputStream stream = input; java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString("UTF-8");
        }
    }

    private void deleteRecursively(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }

    @PluginMethod
    public void initializeModel(PluginCall call) {
        final String slug;
        try { slug = checkedModelSlug(call.getString("modelSlug")); }
        catch (Exception error) { call.reject(error.getMessage()); return; }
        WORKER.execute(() -> {
            try {
                if (!nativeAvailable) throw new IllegalStateException("Cactus native runtime is unavailable.");
                if (!modelDirectory(slug).isDirectory() || directoryBytes(modelDirectory(slug)) < 50L * 1024L * 1024L) {
                    throw new IllegalStateException("Download " + slug + " before loading it.");
                }
                boolean loaded = nativeInitialize(modelDirectory(slug).getAbsolutePath(), call.getInt("contextSize", 4096));
                modelLoaded = loaded;
                modelLoadedSlug = loaded ? slug : null;
                call.resolve(new JSObject().put("loaded", loaded).put("model", slug));
            } catch (Exception error) {
                modelLoaded = false;
                modelLoadedSlug = null;
                call.reject("JARVIS model initialization failed: " + error.getMessage(), "JARVIS_CORE_INIT_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void complete(PluginCall call) {
        final String slug;
        try { slug = checkedModelSlug(call.getString("modelSlug")); }
        catch (Exception error) { call.reject(error.getMessage()); return; }
        WORKER.execute(() -> {
            List<File> temporaryImages = new ArrayList<>();
            try {
                if (!modelLoaded || !slug.equals(modelLoadedSlug)) {
                    if (!modelDirectory(slug).isDirectory()) throw new IllegalStateException("Download " + slug + " before chatting with it.");
                    boolean loaded = nativeInitialize(modelDirectory(slug).getAbsolutePath(), 4096);
                    modelLoaded = loaded;
                    modelLoadedSlug = loaded ? slug : null;
                }
                String messages = materializeImageInputs(call.getString("messages", "[]"), temporaryImages);
                int maxTokens = Math.max(64, Math.min(1024, call.getInt("maxTokens", 384)));
                double temperature = Math.max(0.0, Math.min(1.5, call.getDouble("temperature", 0.7)));
                JSONObject options = new JSONObject();
                options.put("max_tokens", maxTokens);
                options.put("temperature", temperature);
                options.put("top_p", 0.8);
                options.put("top_k", 20);
                options.put("enable_thinking_if_supported", false);
                String raw = nativeComplete(messages, options.toString(), maxTokens);
                JSONObject response = new JSONObject(raw);
                boolean success = response.optBoolean("success", true);
                if (!success) throw new IllegalStateException(response.optString("response", "Local inference failed."));
                call.resolve(new JSObject()
                    .put("response", response.optString("response", raw))
                    .put("tokensPerSecond", response.optDouble("tokens_per_second", 0))
                    .put("totalTimeMs", response.optDouble("total_time_ms", 0))
                    .put("timeToFirstTokenMs", response.optDouble("time_to_first_token_ms", 0))
                    .put("model", slug));
            } catch (Exception error) {
                call.reject("JARVIS inference failed: " + error.getMessage(), "JARVIS_CORE_INFERENCE_FAILED", error);
            } finally {
                for (File image : temporaryImages) image.delete();
            }
        });
    }

    @PluginMethod
    public void reset(PluginCall call) {
        WORKER.execute(() -> {
            try { nativeReset(); call.resolve(); }
            catch (Exception error) { call.reject("Could not reset JARVIS Core.", "JARVIS_CORE_RESET_FAILED", error); }
        });
    }

    @PluginMethod
    public void unload(PluginCall call) {
        WORKER.execute(() -> {
            try { nativeUnload(); modelLoaded = false; modelLoadedSlug = null; call.resolve(); }
            catch (Exception error) { call.reject("Could not unload JARVIS Core.", "JARVIS_CORE_UNLOAD_FAILED", error); }
        });
    }
}
