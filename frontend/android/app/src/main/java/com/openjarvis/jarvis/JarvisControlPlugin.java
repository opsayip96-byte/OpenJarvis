package com.openjarvis.jarvis;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "JarvisControl")
public class JarvisControlPlugin extends Plugin {
    private static final Map<String, String> ALLOWED_APPS;
    static {
        Map<String, String> apps = new HashMap<>();
        apps.put("youtube", "com.google.android.youtube");
        apps.put("chrome", "com.android.chrome");
        apps.put("maps", "com.google.android.apps.maps");
        apps.put("whatsapp", "com.whatsapp");
        apps.put("instagram", "com.instagram.android");
        apps.put("gmail", "com.google.android.gm");
        ALLOWED_APPS = Collections.unmodifiableMap(apps);
    }

    @PluginMethod
    public void launchKnownApp(PluginCall call) {
        String requested = call.getString("app", "").trim().toLowerCase(java.util.Locale.ROOT);
        String packageName = ALLOWED_APPS.get(requested);
        if (packageName == null) {
            call.reject("This app is not in JARVIS's approved launch list.", "APP_NOT_ALLOWED");
            return;
        }
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(packageName);
            if (launch == null) {
                call.reject("The requested app is not installed or cannot be launched.", "APP_NOT_INSTALLED");
                return;
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            JSObject result = new JSObject();
            result.put("launched", true);
            result.put("packageName", packageName);
            call.resolve(result);
        } catch (Exception error) {
            Log.w("JarvisControl", "Could not launch allowlisted app", error);
            call.reject("Android could not launch the requested app.", "APP_LAUNCH_FAILED");
        }
    }
}
