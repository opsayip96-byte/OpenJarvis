package com.openjarvis.jarvis;

import android.content.Intent;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.Settings;
import android.util.Log;
import java.util.Locale;

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
    @PluginMethod
    public void getDeviceStatus(PluginCall call) {
        try {
            android.content.Intent battery = getContext().registerReceiver(
                null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = -1;
            int scale = 100;
            int status = -1;
            if (battery != null) {
                level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            }
            JSObject result = new JSObject();
            result.put("batteryPercent", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : -1);
            result.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
            result.put("manufacturer", Build.MANUFACTURER);
            result.put("model", Build.MODEL);
            result.put("androidVersion", Build.VERSION.RELEASE);
            result.put("sdk", Build.VERSION.SDK_INT);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read device status.", "DEVICE_STATUS_FAILED", error);
        }
    }

    @PluginMethod
    public void openSystemPanel(PluginCall call) {
        String panel = call.getString("panel", "").trim().toLowerCase(Locale.ROOT);
        Intent intent;
        switch (panel) {
            case "wifi":
                intent = new Intent(Settings.Panel.ACTION_WIFI);
                break;
            case "internet":
                intent = new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY);
                break;
            case "bluetooth":
                intent = new Intent(Settings.Panel.ACTION_BLUETOOTH);
                break;
            case "nfc":
                intent = new Intent(Settings.ACTION_NFC_SETTINGS);
                break;
            case "location":
                intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                break;
            case "display":
                intent = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
                break;
            case "sound":
                intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
                break;
            case "battery":
                intent = new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS);
                break;
            case "app":
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
                break;
            default:
                call.reject("Unsupported Android settings panel.", "PANEL_NOT_ALLOWED");
                return;
        }
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("panel", panel);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Android could not open this settings panel.", "PANEL_OPEN_FAILED", error);
        }
    }

    @PluginMethod
    public void openWebUrl(PluginCall call) {
        String url = call.getString("url", "").trim();
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) || uri.getHost() == null) {
            call.reject("Only valid HTTP or HTTPS web addresses are allowed.", "INVALID_URL");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("No browser could open this address.", "BROWSER_OPEN_FAILED", error);
        }
    }

    @PluginMethod
    public void createCalendarEvent(PluginCall call) {
        String title = call.getString("title", "").trim();
        long begin = call.getLong("beginAt", -1L);
        long end = call.getLong("endAt", -1L);
        if (title.isEmpty() || begin <= 0 || end <= begin) {
            call.reject("Provide an event title and valid start/end times.", "INVALID_EVENT");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the calendar event editor.", "CALENDAR_OPEN_FAILED", error);
        }
    }

    @PluginMethod
    public void setAlarm(PluginCall call) {
        int hour = call.getInt("hour", -1);
        int minute = call.getInt("minute", -1);
        String message = call.getString("message", "JARVIS alarm");
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            call.reject("Alarm time must use a valid 24-hour time.", "INVALID_ALARM_TIME");
            return;
        }
        try {
            Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_MESSAGE, message)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, false);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the alarm clock.", "ALARM_OPEN_FAILED", error);
        }
    }

    @PluginMethod
    public void setTimer(PluginCall call) {
        int seconds = call.getInt("seconds", 0);
        String message = call.getString("message", "JARVIS timer");
        if (seconds < 1 || seconds > 86400) {
            call.reject("Timer must be between 1 second and 24 hours.", "INVALID_TIMER");
            return;
        }
        try {
            Intent intent = new Intent(AlarmClock.ACTION_SET_TIMER)
                .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                .putExtra(AlarmClock.EXTRA_MESSAGE, message)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, false);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the timer.", "TIMER_OPEN_FAILED", error);
        }
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > 10000) {
            call.reject("Share text must contain 1 to 10000 characters.", "INVALID_SHARE_TEXT");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, text);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(Intent.createChooser(intent, "Share with"));
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open Android share sheet.", "SHARE_FAILED", error);
        }
    }

}
