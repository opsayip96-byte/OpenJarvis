package com.openjarvis.jarvis;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;

/**
 * Private GGUF model-file manager. Models are copied into app-private storage,
 * checked for the GGUF magic header, and fingerprinted before being accepted.
 * This class deliberately does not claim to run inference.
 */
@CapacitorPlugin(name = "JarvisLocalModel")
public class JarvisLocalModelPlugin extends Plugin {
    private static final int PICK_MODEL = 7314;
    private PluginCall pendingPicker;

    @PluginMethod
    public void chooseModel(PluginCall call) {
        if (pendingPicker != null) {
            call.reject("A model selection is already open.", "PICKER_BUSY");
            return;
        }
        pendingPicker = call;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "modelPicked");
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void modelPicked(PluginCall call, androidx.activity.result.ActivityResult result) {
        pendingPicker = null;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("Model selection cancelled.", "PICKER_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("No model file was selected.", "MODEL_URI_MISSING");
            return;
        }
        try {
            String name = displayName(uri);
            if (!name.toLowerCase(java.util.Locale.ROOT).endsWith(".gguf")) {
                call.reject("Choose a GGUF model file (.gguf).", "INVALID_MODEL_EXTENSION");
                return;
            }
            File dir = new File(getContext().getFilesDir(), "models");
            if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("Could not create private model directory.");
            File target = new File(dir, "active-model.gguf");
            File temp = new File(dir, "active-model.gguf.part");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long copied = 0;
            byte[] first = new byte[4];
            int firstCount = 0;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                 FileOutputStream out = new FileOutputStream(temp)) {
                if (in == null) throw new java.io.IOException("Could not open selected model.");
                byte[] buffer = new byte[1024 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (copied < 4) {
                        int take = (int)Math.min(4 - copied, n);
                        System.arraycopy(buffer, 0, first, (int)copied, take);
                        firstCount += take;
                    }
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    copied += n;
                }
                out.getFD().sync();
            }
            if (firstCount != 4 || first[0] != 'G' || first[1] != 'G' || first[2] != 'U' || first[3] != 'F') {
                temp.delete();
                call.reject("The selected file does not have a valid GGUF header.", "INVALID_GGUF");
                return;
            }
            if (!temp.renameTo(target)) {
                temp.delete();
                throw new java.io.IOException("Could not finalize model file.");
            }
            JSObject response = new JSObject();
            response.put("ready", true);
            response.put("name", name);
            response.put("sizeBytes", copied);
            response.put("sha256", toHex(digest.digest()));
            response.put("path", target.getAbsolutePath());
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Could not import GGUF model: " + e.getMessage(), "MODEL_IMPORT_FAILED", e);
        }
    }

    @PluginMethod
    public void getModelStatus(PluginCall call) {
        File model = new File(new File(getContext().getFilesDir(), "models"), "active-model.gguf");
        JSObject response = new JSObject();
        response.put("ready", model.isFile() && model.length() > 4);
        response.put("sizeBytes", model.isFile() ? model.length() : 0);
        response.put("path", model.isFile() ? model.getAbsolutePath() : "");
        call.resolve(response);
    }

    @PluginMethod
    public void removeModel(PluginCall call) {
        File model = new File(new File(getContext().getFilesDir(), "models"), "active-model.gguf");
        if (model.exists() && !model.delete()) {
            call.reject("Could not remove the local model.", "MODEL_DELETE_FAILED");
            return;
        }
        call.resolve(new JSObject().put("ready", false));
    }

    private String displayName(Uri uri) {
        String name = "model.gguf";
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {}
        return name == null ? "model.gguf" : name;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b));
        return out.toString();
    }
}
