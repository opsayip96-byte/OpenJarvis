package com.openjarvis.jarvis;

import android.Manifest;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(
    name = "JarvisNative",
    permissions = {@Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})}
)
public class JarvisNativePlugin extends Plugin implements RecognitionListener {
    private static final String KEY_ALIAS = "com.openjarvis.jarvis.credential-key.v1";
    private static final Set<String> ALLOWED_KEYS = new HashSet<>(Arrays.asList(
        "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENJARVIS_API_KEY"
    ));

    private SpeechRecognizer recognizer;
    private Intent recognitionIntent;
    private boolean listening;
    private boolean stopping;
    private String language = "en-GB";
    private final StringBuilder transcript = new StringBuilder();
    private PluginCall stopCall;
    private TextToSpeech tts;
    private boolean ttsReady;
    private PluginCall ttsCall;
    private String ttsUtteranceId;

    private final android.content.BroadcastReceiver wakeReceiver = new android.content.BroadcastReceiver() {
        @Override public void onReceive(android.content.Context context, Intent intent) {
            notifyListeners("wakeDetected", new JSObject().put("detected", true));
        }
    };

    @Override
    public void load() {
        super.load();
        android.content.IntentFilter wakeFilter = new android.content.IntentFilter(WakeWordService.ACTION_WAKE_DETECTED);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(wakeReceiver, wakeFilter, android.content.Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(wakeReceiver, wakeFilter);
        tts = new TextToSpeech(getContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) {
                        PluginCall call = ttsCall;
                        if (call != null && id.equals(ttsUtteranceId)) {
                            ttsCall = null;
                            ttsUtteranceId = null;
                            call.resolve();
                        }
                    }
                    @Override public void onError(String id) { finishTtsWithError(id, "Android speech engine failed."); }
                    @Override public void onError(String id, int errorCode) { finishTtsWithError(id, "Android speech engine failed (" + errorCode + ")."); }
                });
            }
        });
    }

    @PluginMethod
    public void isWakeWordEnabled(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("jarvis_wake_settings", 0);
        call.resolve(new JSObject().put("enabled", prefs.getBoolean("enabled", false)));
    }

    @PluginMethod
    public void enableWakeWord(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "wakeWordPermissionResult");
            return;
        }
        startWakeWordService(call);
    }

    @PermissionCallback
    private void wakeWordPermissionResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission is required for wake word listening.", "MICROPHONE_PERMISSION_DENIED");
            return;
        }
        startWakeWordService(call);
    }

    private void startWakeWordService(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), WakeWordService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
            else getContext().startService(intent);
            getContext().getSharedPreferences("jarvis_wake_settings", 0).edit().putBoolean("enabled", true).apply();
            call.resolve(new JSObject().put("enabled", true));
        } catch (Exception e) {
            call.reject("Could not enable the JARVIS wake word service. Check Android microphone permissions.", "WAKE_SERVICE_START_FAILED", e);
        }
    }

    @PluginMethod
    public void disableWakeWord(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), WakeWordService.class));
            getContext().getSharedPreferences("jarvis_wake_settings", 0).edit().putBoolean("enabled", false).apply();
            call.resolve(new JSObject().put("enabled", false));
        } catch (Exception e) {
            call.reject("Could not disable JARVIS wake word listening.", "WAKE_SERVICE_STOP_FAILED", e);
        }
    }

    @PluginMethod
    public void pauseWakeWord(PluginCall call) {
        Intent intent = new Intent(getContext(), WakeWordService.class).setAction(WakeWordService.ACTION_PAUSE);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void resumeWakeWord(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("jarvis_wake_settings", 0);
        if (!prefs.getBoolean("enabled", false)) { call.resolve(); return; }
        Intent intent = new Intent(getContext(), WakeWordService.class).setAction(WakeWordService.ACTION_RESUME);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void checkMicrophonePermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", getPermissionState("microphone").toString().toLowerCase(Locale.ROOT));
        result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void startRecognition(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionResult");
            return;
        }
        startRecognitionWithPermission(call);
    }

    @PermissionCallback
    private void microphonePermissionResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission was denied. Use Open app permissions to enable it.", "MICROPHONE_PERMISSION_DENIED");
            return;
        }
        startRecognitionWithPermission(call);
    }

    private void startRecognitionWithPermission(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("No Android speech recognition service is available on this device.", "RECOGNIZER_UNAVAILABLE");
            return;
        }
        // Android's SpeechRecognizer API must be created, started, stopped and
        // destroyed on the main looper. Capacitor bridge calls are not
        // guaranteed to arrive on that thread on every Android vendor ROM.
        android.app.Activity activity = getActivity();
        if (activity == null) {
            call.reject("JARVIS is not attached to an active Android screen.", "ACTIVITY_UNAVAILABLE");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                releaseRecognizer();
                transcript.setLength(0);
                stopping = false;
                language = call.getString("language", "en-GB");
                recognitionIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                recognitionIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                recognitionIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                recognitionIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(this);
                recognizer.startListening(recognitionIntent);
                listening = true;
                call.resolve(new JSObject().put("started", true));
            } catch (SecurityException e) {
                releaseRecognizer();
                call.reject("Android denied microphone access. Check JARVIS microphone permission.", "MICROPHONE_PERMISSION_DENIED", e);
            } catch (RuntimeException e) {
                releaseRecognizer();
                String detail = e.getMessage();
                call.reject("Android speech service could not start" +
                    (detail == null || detail.trim().isEmpty() ? "." : ": " + detail), "RECOGNITION_START_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void stopRecognition(PluginCall call) {
        android.app.Activity activity = getActivity();
        if (activity == null) {
            call.reject("JARVIS is not attached to an active Android screen.", "ACTIVITY_UNAVAILABLE");
            return;
        }
        // SpeechRecognizer is a main-looper API. Capacitor bridge calls may
        // arrive on a worker thread, so every lifecycle operation is posted
        // to the UI thread to avoid vendor-ROM threading failures.
        activity.runOnUiThread(() -> {
            if (recognizer == null || !listening) {
                call.reject("There is no active recording.", "NOT_RECORDING");
                return;
            }
            if (stopCall != null) {
                call.reject("A speech stop request is already in progress.", "STOP_ALREADY_PENDING");
                return;
            }
            stopCall = call;
            stopping = true;
            try {
                recognizer.stopListening();
            } catch (Exception e) {
                failStop("Could not stop Android speech recognition.", e);
            }
        });
    }

    @PluginMethod
    public void cancelRecognition(PluginCall call) {
        android.app.Activity activity = getActivity();
        if (activity == null) {
            call.reject("JARVIS is not attached to an active Android screen.", "ACTIVITY_UNAVAILABLE");
            return;
        }
        activity.runOnUiThread(() -> {
            stopping = true;
            releaseRecognizer();
            if (stopCall != null) {
                stopCall.reject("Recording cancelled.", "CANCELLED");
                stopCall = null;
            }
            transcript.setLength(0);
            call.resolve();
        });
    }

    @PluginMethod
    public void checkOverlayPermission(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || Settings.canDrawOverlays(getContext());
        call.resolve(new JSObject().put("granted", granted));
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || Settings.canDrawOverlays(getContext());
        if (granted) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("granted", false));
        } catch (Exception e) {
            call.reject("Could not open Android's display-over-other-apps permission screen.",
                "OVERLAY_SETTINGS_FAILED", e);
        }
    }

    @PluginMethod
    public void isFloatingAssistantRunning(PluginCall call) {
        call.resolve(new JSObject().put("running", FloatingAssistantService.isRunning()));
    }

    @PluginMethod
    public void startFloatingAssistant(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            && !Settings.canDrawOverlays(getContext())) {
            call.reject("Allow JARVIS to display over other apps first.",
                "OVERLAY_PERMISSION_REQUIRED");
            return;
        }
        try {
            Intent intent = new Intent(getContext(), FloatingAssistantService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve(new JSObject().put("started", true));
        } catch (Exception e) {
            call.reject("Android could not start the floating JARVIS assistant.",
                "FLOATING_ASSISTANT_START_FAILED", e);
        }
    }

    @PluginMethod
    public void stopFloatingAssistant(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), FloatingAssistantService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not stop the floating JARVIS assistant.",
                "FLOATING_ASSISTANT_STOP_FAILED", e);
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open Android app permissions.", "SETTINGS_OPEN_FAILED", e);
        }
    }

    @PluginMethod
    public void openSystemPanel(PluginCall call) {
        String panel = call.getString("panel", "");
        String action;
        switch (panel) {
            case "wifi": action = Settings.ACTION_WIFI_SETTINGS; break;
            case "bluetooth": action = Settings.ACTION_BLUETOOTH_SETTINGS; break;
            case "display": action = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "sound": action = Settings.ACTION_SOUND_SETTINGS; break;
            case "battery": action = Settings.ACTION_BATTERY_SAVER_SETTINGS; break;
            case "location": action = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
            case "app_settings":
                openAppSettings(call);
                return;
            default:
                call.reject("That Android settings panel is not supported.", "UNSUPPORTED_SETTINGS_PANEL");
                return;
        }
        try {
            Intent intent = new Intent(action);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the requested Android settings panel.", "SETTINGS_PANEL_FAILED", e);
        }
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String packageName = call.getString("packageName", "").trim();
        if (packageName.isEmpty() || packageName.length() > 200) {
            call.reject("A valid Android package name is required.", "INVALID_PACKAGE_NAME");
            return;
        }
        try {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(packageName);
            if (intent == null) {
                call.reject("That app is not installed or cannot be launched.", "APP_NOT_FOUND");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not launch that app.", "APP_LAUNCH_FAILED", e);
        }
    }

    @PluginMethod
    public void setMediaVolume(PluginCall call) {
        double requested = call.getDouble("percent", -1.0);
        if (requested < 0 || requested > 100) {
            call.reject("Volume must be between 0 and 100.", "INVALID_VOLUME");
            return;
        }
        try {
            AudioManager audio = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            int maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int value = (int) Math.round(maximum * requested / 100.0);
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, value, 0);
            int actual = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
            int percent = maximum == 0 ? 0 : Math.round(actual * 100f / maximum);
            call.resolve(new JSObject().put("percent", percent));
        } catch (Exception e) {
            call.reject("Could not change media volume.", "VOLUME_CHANGE_FAILED", e);
        }
    }

    @PluginMethod
    public void getBatteryStatus(PluginCall call) {
        try {
            Intent battery = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (battery == null) throw new IllegalStateException("Battery status is unavailable.");
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            if (level < 0 || scale <= 0) throw new IllegalStateException("Battery level is unavailable.");
            int percent = Math.round(level * 100f / scale);
            boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL;
            call.resolve(new JSObject().put("percent", percent).put("charging", charging));
        } catch (Exception e) {
            call.reject("Could not read battery status.", "BATTERY_STATUS_FAILED", e);
        }
    }

    @PluginMethod
    public void saveSecureValue(PluginCall call) {
        String name = call.getString("name", "");
        String value = call.getString("value", "");
        if (!ALLOWED_KEYS.contains(name)) {
            call.reject("This credential name is not allowed.", "INVALID_CREDENTIAL_NAME");
            return;
        }
        try {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences("jarvis_secure_vault", 0);
            if (value.isEmpty()) {
                prefs.edit().remove(name).apply();
            } else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
                byte[] encrypted = cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." +
                    Base64.encodeToString(encrypted, Base64.NO_WRAP);
                prefs.edit().putString(name, stored).apply();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save the credential to Android secure storage.", "SECURE_STORAGE_FAILED", e);
        }
    }

    @PluginMethod
    public void getSecureValue(PluginCall call) {
        String name = call.getString("name", "");
        if (!ALLOWED_KEYS.contains(name)) {
            call.reject("This credential name is not allowed.", "INVALID_CREDENTIAL_NAME");
            return;
        }
        String stored = getContext().getSharedPreferences("jarvis_secure_vault", 0).getString(name, null);
        JSObject result = new JSObject();
        result.put("value", stored == null ? "" : decryptValue(stored));
        call.resolve(result);
    }

    @PluginMethod
    public void getSecureStatus(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("jarvis_secure_vault", 0);
        JSObject result = new JSObject();
        for (String key : ALLOWED_KEYS) result.put(key, prefs.contains(key));
        call.resolve(result);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private String decryptValue(String stored) {
        try {
            String[] parts = stored.split("\\.", 2);
            if (parts.length != 2) throw new IllegalArgumentException("Invalid encrypted value");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("Could not decrypt the credential from Android secure storage.", e);
        }
    }

    @PluginMethod
    public void getSpeechVoices(PluginCall call) {
        if (!ttsReady || tts == null || tts.getVoices() == null) {
            call.reject("Android text-to-speech engine is not ready.", "TTS_UNAVAILABLE");
            return;
        }
        JSArray voices = new JSArray();
        for (Voice voice : tts.getVoices()) {
            if (voice == null || voice.getLocale() == null || voice.isNetworkConnectionRequired()) continue;
            JSObject row = new JSObject();
            row.put("name", voice.getName());
            row.put("language", voice.getLocale().toLanguageTag());
            row.put("quality", voice.getQuality());
            voices.put(row);
        }
        call.resolve(new JSObject().put("voices", voices));
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (!ttsReady || tts == null) {
            call.reject("Android text-to-speech engine is not ready. Try again shortly.", "TTS_UNAVAILABLE");
            return;
        }
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) { call.reject("There is no text to speak.", "EMPTY_TEXT"); return; }
        String tag = call.getString("language", "en-GB");
        String voiceName = call.getString("voiceName", "");
        float rate = clamp(call.getFloat("rate", 1.0f), 0.5f, 2.0f);
        float pitch = clamp(call.getFloat("pitch", 0.85f), 0.5f, 2.0f);
        float volume = clamp(call.getFloat("volume", 1.0f), 0.0f, 1.0f);
        try {
            Locale locale = Locale.forLanguageTag(tag);
            tts.setLanguage(locale);
            if (!voiceName.isEmpty() && tts.getVoices() != null) {
                for (Voice voice : tts.getVoices()) {
                    if (voiceName.equals(voice.getName())) { tts.setVoice(voice); break; }
                }
            }
            tts.setSpeechRate(rate);
            tts.setPitch(pitch);
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume);
            if (ttsCall != null) ttsCall.reject("Speech was interrupted.", "INTERRUPTED");
            ttsCall = call;
            ttsUtteranceId = "jarvis-" + System.nanoTime();
            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, ttsUtteranceId);
            if (result == TextToSpeech.ERROR) {
                ttsCall = null;
                call.reject("Android speech engine could not start playback.", "TTS_PLAYBACK_FAILED");
            }
        } catch (Exception e) {
            ttsCall = null;
            call.reject("Could not speak with the selected Android voice.", "TTS_PLAYBACK_FAILED", e);
        }
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        if (ttsCall != null) { ttsCall.resolve(); ttsCall = null; }
        ttsUtteranceId = null;
        call.resolve();
    }

    private void finishTtsWithError(String id, String message) {
        PluginCall call = ttsCall;
        if (call != null && id.equals(ttsUtteranceId)) {
            ttsCall = null;
            ttsUtteranceId = null;
            call.reject(message, "TTS_PLAYBACK_FAILED");
        }
    }

    private float clamp(float value, float min, float max) { return Math.max(min, Math.min(max, value)); }

    @Override public void onReadyForSpeech(Bundle params) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rmsdB) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onPartialResults(Bundle partialResults) {}
    @Override public void onEvent(int eventType, Bundle params) {}

    @Override
    public void onResults(Bundle results) {
        int previousLength = transcript.length();
        appendBestResult(results);
        String latestPhrase = transcript.substring(previousLength).trim();
        if (!latestPhrase.isEmpty()) {
            notifyListeners("speechResult", new JSObject().put("text", latestPhrase));
        }
        if (stopping) finishRecognition();
        else if (recognizer != null && listening) {
            getActivity().runOnUiThread(() -> {
                try { recognizer.startListening(recognitionIntent); }
                catch (Exception e) { failStop("Speech recognition stopped unexpectedly.", e); }
            });
        }
    }

    private void appendBestResult(Bundle results) {
        if (results == null) return;
        ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (values != null && !values.isEmpty() && values.get(0) != null) {
            String phrase = values.get(0).trim();
            if (!phrase.isEmpty()) {
                if (transcript.length() > 0) transcript.append(' ');
                transcript.append(phrase);
            }
        }
    }

    private void finishRecognition() {
        PluginCall call = stopCall;
        stopCall = null;
        releaseRecognizer();
        String result = transcript.toString().trim();
        transcript.setLength(0);
        if (call == null) return;
        if (result.isEmpty()) call.reject("No speech was detected. Check your connection and try again.", "NO_SPEECH");
        else call.resolve(new JSObject().put("text", result));
    }

    @Override
    public void onError(int error) {
        if (stopping) {
            if (transcript.length() > 0) finishRecognition();
            else failStop(recognitionError(error), null);
            return;
        }
        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
            android.app.Activity activity = getActivity();
            if (recognizer != null && listening && activity != null) {
                activity.runOnUiThread(() -> {
                    try {
                        if (recognizer != null && listening && !stopping) recognizer.startListening(recognitionIntent);
                    } catch (Exception e) {
                        failStop("Speech recognition stopped unexpectedly.", e);
                    }
                });
            } else if (activity == null) {
                failStop("JARVIS screen closed during speech recognition.", null);
            }
            return;
        }
        failStop(recognitionError(error), null);
    }

    private String recognitionError(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Speech recognition needs a network connection. Check that the phone is online.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission is required. Open app permissions to enable it.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Android speech recognition is busy. Wait a moment and try again.";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "No speech was detected. Try again.";
            default: return "Android speech recognition failed. Please try again.";
        }
    }

    private void failStop(String message, Exception error) {
        PluginCall call = stopCall;
        stopCall = null;
        releaseRecognizer();
        transcript.setLength(0);
        if (call != null) call.reject(message, "RECOGNITION_FAILED", error);
    }

    private void releaseRecognizer() {
        listening = false;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(wakeReceiver); } catch (Exception ignored) {}
        releaseRecognizer();
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        if (ttsCall != null) { ttsCall.reject("App closed.", "INTERRUPTED"); ttsCall = null; }
        super.handleOnDestroy();
    }
}
