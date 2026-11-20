package com.openjarvis.jarvis;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.StatFs;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "JarvisModelLibrary")
public class JarvisModelLibraryPlugin extends Plugin {
    private static final String PREFS = "jarvis_model_library";
    private static final String MODELS = "models";
    private static final String ACTIVE = "active_model";
    private DownloadManager downloads;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        downloads = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        migrateLegacyModel();
    }

    @PluginMethod
    public void getDeviceStorageInfo(PluginCall call) {
        try {
            File dir = modelDirectory();
            StatFs stats = new StatFs(dir.getAbsolutePath());
            android.app.ActivityManager activity = (android.app.ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE);
            android.app.ActivityManager.MemoryInfo memory = new android.app.ActivityManager.MemoryInfo();
            activity.getMemoryInfo(memory);
            String abi = android.os.Build.SUPPORTED_ABIS.length > 0 ? android.os.Build.SUPPORTED_ABIS[0] : "unknown";
            JSObject result = new JSObject();
            result.put("availableStorageBytes", stats.getAvailableBytes());
            result.put("totalStorageBytes", stats.getTotalBytes());
            result.put("physicalRamBytes", memory.totalMem);
            result.put("architecture", abi);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read device capacity.", "DEVICE_CAPACITY_FAILED", error);
        }
    }

    @PluginMethod
    public void listModels(PluginCall call) {
        migrateLegacyModel();
        try {
            JSONArray stored = readModels();
            JSArray result = new JSArray();
            for (int i = 0; i < stored.length(); i++) {
                JSONObject item = stored.optJSONObject(i);
                if (item == null) continue;
                File file = new File(item.optString("path", ""));
                if (file.isFile() && file.length() > 4) {
                    JSObject row = new JSObject(item.toString());
                    row.put("ready", true);
                    result.put(row);
                }
            }
            call.resolve(new JSObject().put("models", result).put("activeModelId", activeId()));
        } catch (Exception error) {
            call.reject("Could not read the local model library.", "MODEL_LIBRARY_READ_FAILED", error);
        }
    }

    @PluginMethod
    public void getActiveModel(PluginCall call) {
        migrateLegacyModel();
        try {
            String id = activeId();
            JSONObject item = findModel(id);
            if (item == null) { call.resolve(new JSObject().put("ready", false).put("path", "")); return; }
            File file = new File(item.optString("path", ""));
            boolean ready = file.isFile() && file.length() > 4;
            JSObject result = new JSObject();
            result.put("ready", ready);
            result.put("path", ready ? file.getAbsolutePath() : "");
            result.put("name", item.optString("fileName", item.optString("name", "Qwen GGUF")));
            result.put("sizeBytes", ready ? file.length() : 0);
            result.put("sha256", item.optString("sha256", ""));
            result.put("modelId", id == null ? "" : id);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not resolve the active local model.", "ACTIVE_MODEL_READ_FAILED", error);
        }
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        try {
            String id = call.getString("id");
            String url = call.getString("url");
            String fileName = call.getString("fileName");
            String expectedSha = call.getString("expectedSha256", "");
            long expectedSize = call.getLong("expectedSizeBytes", 0L);
            if (id == null || id.trim().isEmpty() || fileName == null || !fileName.toLowerCase(Locale.ROOT).endsWith(".gguf")) {
                call.reject("A model ID and .gguf filename are required.", "INVALID_MODEL_METADATA"); return;
            }
            Uri uri = Uri.parse(url == null ? "" : url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"huggingface.co".equalsIgnoreCase(uri.getHost())) {
                call.reject("Only direct HTTPS downloads from huggingface.co are allowed.", "UNTRUSTED_MODEL_URL"); return;
            }
            if (!expectedSha.isEmpty() && !expectedSha.matches("(?i)[a-f0-9]{64}")) {
                call.reject("The expected SHA-256 is malformed.", "INVALID_CHECKSUM"); return;
            }
            if (expectedSize > 0) {
                File dir = modelDirectory();
                StatFs stats = new StatFs(dir.getAbsolutePath());
                long free = stats.getAvailableBytes();
                long required = (long)(expectedSize * 1.15d) + 536870912L;
                if (free < required) {
                    call.reject("Not enough free storage. Need about " + required + " bytes including reserve.", "INSUFFICIENT_STORAGE"); return;
                }
            }
            String safeName = safeModelFileName(id, fileName);
            File dir = modelDirectory();
            File partial = new File(dir, safeName + ".download");
            if (partial.exists()) partial.delete();
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("JARVIS model: " + safeName);
            request.setDescription("Downloading a Qwen GGUF model into private app storage");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS + "/models", safeName + ".download");
            long downloadId = downloads.enqueue(request);
            JSONObject record = new JSONObject();
            record.put("id", id);
            record.put("downloadId", downloadId);
            record.put("fileName", safeName);
            record.put("expectedSha256", expectedSha);
            record.put("expectedSizeBytes", expectedSize);
            record.put("status", "queued");
            record.put("url", url);
            upsertDownload(record);
            call.resolve(new JSObject().put("downloadId", downloadId).put("status", "queued"));
        } catch (Exception error) {
            call.reject("Could not start model download: " + error.getMessage(), "MODEL_DOWNLOAD_START_FAILED", error);
        }
    }

    @PluginMethod
    public void listDownloads(PluginCall call) {
        IO.execute(() -> {
            try {
                JSONArray saved = getDownloads();
                JSArray rows = new JSArray();
                for (int i = 0; i < saved.length(); i++) {
                    JSONObject record = saved.optJSONObject(i);
                    if (record == null) continue;
                    long id = record.optLong("downloadId", -1L);
                    if (id < 0) continue;
                    DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
                    try (Cursor cursor = downloads.query(query)) {
                        if (cursor == null || !cursor.moveToFirst()) continue;
                        int raw = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        long current = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        String state = "queued";
                        if (raw == DownloadManager.STATUS_RUNNING) state = "downloading";
                        else if (raw == DownloadManager.STATUS_PAUSED) state = "paused";
                        else if (raw == DownloadManager.STATUS_FAILED) state = "failed";
                        else if (raw == DownloadManager.STATUS_PENDING) state = "queued";
                        else if (raw == DownloadManager.STATUS_SUCCESSFUL) state = finalizeDownload(record);
                        JSObject row = new JSObject(record.toString());
                        row.put("status", state);
                        row.put("bytesDownloaded", current);
                        row.put("totalBytes", total);
                        row.put("progress", total > 0 ? Math.min(100, (int)(current * 100 / total)) : 0);
                        rows.put(row);
                    }
                }
                call.resolve(new JSObject().put("downloads", rows));
            } catch (Exception error) {
                call.reject("Could not restore download state.", "DOWNLOAD_RESTORE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        if (id < 0) { call.reject("Download ID is required.", "DOWNLOAD_ID_MISSING"); return; }
        IO.execute(() -> {
            try {
                JSONObject record = findDownload(id);
                if (record == null) { call.reject("Download was not found.", "DOWNLOAD_NOT_FOUND"); return; }
                DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
                try (Cursor cursor = downloads.query(query)) {
                    if (cursor == null || !cursor.moveToFirst()) {
                        call.resolve(new JSObject().put("status", "missing").put("downloadId", id)); return;
                    }
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    String state = "queued";
                    if (status == DownloadManager.STATUS_RUNNING) state = "downloading";
                    else if (status == DownloadManager.STATUS_PAUSED) state = "paused";
                    else if (status == DownloadManager.STATUS_FAILED) state = "failed";
                    else if (status == DownloadManager.STATUS_SUCCESSFUL) state = finalizeDownload(record);
                    else if (status == DownloadManager.STATUS_PENDING) state = "queued";
                    JSObject result = new JSObject();
                    result.put("downloadId", id);
                    result.put("status", state);
                    result.put("bytesDownloaded", downloaded);
                    result.put("totalBytes", total);
                    result.put("progress", total > 0 ? Math.min(100, (int)(downloaded * 100 / total)) : 0);
                    if ("failed".equals(state)) result.put("reason", "Transfer failed or GGUF/checksum verification failed.");
                    call.resolve(result);
                }
            } catch (Exception error) {
                call.reject("Could not read download status: " + error.getMessage(), "DOWNLOAD_STATUS_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        if (id < 0) { call.reject("Download ID is required.", "DOWNLOAD_ID_MISSING"); return; }
        downloads.remove(id);
        call.resolve(new JSObject().put("cancelled", true));
    }

    @PluginMethod
    public void activateModel(PluginCall call) {
        String id = call.getString("modelId");
        try {
            JSONObject item = findModel(id);
            if (item == null) { call.reject("Model is not installed.", "MODEL_NOT_INSTALLED"); return; }
            File file = new File(item.optString("path", ""));
            if (!file.isFile() || file.length() <= 4) { call.reject("Model file is missing.", "MODEL_FILE_MISSING"); return; }
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(ACTIVE, id).apply();
            call.resolve(new JSObject().put("activeModelId", id));
        } catch (Exception error) {
            call.reject("Could not activate model.", "MODEL_ACTIVATION_FAILED", error);
        }
    }

    @PluginMethod
    public void removeLibraryModel(PluginCall call) {
        String id = call.getString("modelId");
        try {
            JSONObject item = findModel(id);
            if (item == null) { call.resolve(new JSObject().put("removed", false)); return; }
            if (id != null && id.equals(activeId())) {
                getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(ACTIVE).apply();
            }
            File file = new File(item.optString("path", ""));
            if (file.exists() && !file.delete()) { call.reject("Could not delete model file.", "MODEL_DELETE_FAILED"); return; }
            removeModelRecord(id);
            call.resolve(new JSObject().put("removed", true));
        } catch (Exception error) {
            call.reject("Could not remove model.", "MODEL_DELETE_FAILED", error);
        }
    }

    private String finalizeDownload(JSONObject record) throws Exception {
        if (findModel(record.optString("id")) != null) return "complete";
        String name = record.optString("fileName");
        File dir = modelDirectory();
        File partial = new File(dir, name + ".download");
        File complete = new File(dir, name);
        if (!partial.isFile() || partial.length() <= 4) return "failed";
        try (FileInputStream in = new FileInputStream(partial)) {
            byte[] magic = new byte[4];
            if (in.read(magic) != 4 || magic[0] != 'G' || magic[1] != 'G' || magic[2] != 'U' || magic[3] != 'F') {
                partial.delete(); return "failed";
            }
        }
        long expectedSize = record.optLong("expectedSizeBytes", 0L);
        if (expectedSize > 0 && partial.length() != expectedSize) { partial.delete(); return "failed"; }
        String actual = sha256(partial);
        String expected = record.optString("expectedSha256", "");
        if (!expected.isEmpty() && !expected.equalsIgnoreCase(actual)) {
            partial.delete(); return "failed";
        }
        if (complete.exists() && !complete.delete()) return "failed";
        if (!partial.renameTo(complete)) return "failed";
        JSONObject model = new JSONObject();
        model.put("id", record.optString("id"));
        model.put("fileName", name);
        model.put("path", complete.getAbsolutePath());
        model.put("sizeBytes", complete.length());
        model.put("sha256", actual);
        model.put("source", "huggingface");
        model.put("verified", expected.isEmpty() ? "gguf-header-only" : "sha256");
        model.put("downloadUrl", record.optString("url"));
        upsertModel(model);
        if (activeId() == null) getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(ACTIVE, record.optString("id")).apply();
        return "complete";
    }

    private void migrateLegacyModel() {
        try {
            File legacy = new File(new File(getContext().getFilesDir(), "models"), "active-model.gguf");
            if (!legacy.isFile() || legacy.length() <= 4) return;
            String id = "jarvis-local-imported";
            if (findModel(id) != null) return;
            JSONObject model = new JSONObject();
            model.put("id", id); model.put("fileName", "Imported JARVIS model");
            model.put("path", legacy.getAbsolutePath()); model.put("sizeBytes", legacy.length());
            model.put("sha256", ""); model.put("source", "legacy-import");
            model.put("verified", "gguf-header-only");
            upsertModel(model);
            if (activeId() == null) getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(ACTIVE, id).apply();
        } catch (Exception ignored) { }
    }

    private File modelDirectory() throws Exception {
        File base = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File dir = new File(base == null ? getContext().getFilesDir() : base, "models");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create private model directory.");
        return dir;
    }
    private String activeId() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(ACTIVE, null); }
    private JSONArray readModels() throws Exception { return new JSONArray(getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(MODELS, "[]")); }
    private void saveModels(JSONArray items) { getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(MODELS, items.toString()).apply(); }
    private JSONObject findModel(String id) throws Exception {
        if (id == null) return null;
        JSONArray items = readModels();
        for (int i=0;i<items.length();i++) { JSONObject item=items.optJSONObject(i); if (item!=null && id.equals(item.optString("id"))) return item; }
        return null;
    }
    private void upsertModel(JSONObject value) throws Exception {
        JSONArray old=readModels(), next=new JSONArray(); String id=value.optString("id");
        for(int i=0;i<old.length();i++){JSONObject item=old.optJSONObject(i);if(item!=null&&!id.equals(item.optString("id")))next.put(item);}
        next.put(value);saveModels(next);
    }
    private void removeModelRecord(String id) throws Exception { JSONArray old=readModels(),next=new JSONArray();for(int i=0;i<old.length();i++){JSONObject item=old.optJSONObject(i);if(item!=null&&!id.equals(item.optString("id")))next.put(item);}saveModels(next); }
    private void upsertDownload(JSONObject value) throws Exception {
        JSONArray old=getDownloads(),next=new JSONArray();long id=value.optLong("downloadId");
        for(int i=0;i<old.length();i++){JSONObject item=old.optJSONObject(i);if(item!=null&&id!=item.optLong("downloadId"))next.put(item);}
        next.put(value);getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString("downloads",next.toString()).apply();
    }
    private JSONArray getDownloads() throws Exception {return new JSONArray(getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString("downloads","[]"));}
    private JSONObject findDownload(long id) throws Exception {JSONArray all=getDownloads();for(int i=0;i<all.length();i++){JSONObject item=all.optJSONObject(i);if(item!=null&&item.optLong("downloadId")==id)return item;}return null;}
    private String safeModelFileName(String id, String name) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(id.getBytes("UTF-8"));
        StringBuilder prefix = new StringBuilder();
        for (int i = 0; i < 6; i++) prefix.append(String.format(Locale.ROOT, "%02x", hash[i]));
        return prefix + "-" + safeFileName(name);
    }
    private String safeFileName(String name){String cleaned=name.replaceAll("[^a-zA-Z0-9._-]","_");return cleaned.length()>100?cleaned.substring(cleaned.length()-100):cleaned;}
    private String sha256(File file) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(FileInputStream in=new FileInputStream(file)){byte[] buffer=new byte[1024*1024];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}
        StringBuilder out=new StringBuilder();for(byte b:digest.digest())out.append(String.format(Locale.ROOT,"%02x",b));return out.toString();
    }
}
