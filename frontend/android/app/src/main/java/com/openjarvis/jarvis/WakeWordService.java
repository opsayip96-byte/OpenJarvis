package com.openjarvis.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.Locale;

public class WakeWordService extends Service implements RecognitionListener {
    public static final String ACTION_WAKE_DETECTED = "com.openjarvis.jarvis.WAKE_DETECTED";
    public static final String ACTION_PAUSE = "com.openjarvis.jarvis.WAKE_PAUSE";
    public static final String ACTION_RESUME = "com.openjarvis.jarvis.WAKE_RESUME";
    private static final String CHANNEL = "jarvis_wake_listener";
    private static final int NOTIFICATION_ID = 734;
    private SpeechRecognizer recognizer;
    private boolean paused = false;
    private boolean screenOn = true;
    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                screenOn = false;
                releaseRecognizer();
            } else if (Intent.ACTION_SCREEN_ON.equals(action)) {
                screenOn = true;
                startRecognition();
            }
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(screenReceiver, filter);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        screenOn = pm == null || pm.isInteractive();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if (ACTION_PAUSE.equals(action)) {
            paused = true;
            releaseRecognizer();
            return START_STICKY;
        }
        if (ACTION_RESUME.equals(action)) {
            paused = false;
            startRecognition();
            return START_STICKY;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, buildNotification());
        }
        paused = false;
        startRecognition();
        return START_STICKY;
    }

    private Notification buildNotification() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 734, open,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle("JARVIS wake word is enabled")
            .setContentText("Listening for “Hello JARVIS” while your screen is on.")
            .setContentIntent(pi).setOngoing(true).setPriority(NotificationCompat.PRIORITY_LOW).build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "JARVIS wake word", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Visible notification while the user-enabled wake word listener is active.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void startRecognition() {
        if (paused || !screenOn || recognizer != null) return;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
        try {
            if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
                recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            } else {
                recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            }
            recognizer.setRecognitionListener(this);
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.UK.toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            recognizer.startListening(intent);
        } catch (Exception error) {
            releaseRecognizer();
        }
    }

    private void restartRecognition() {
        releaseRecognizer();
        if (!paused && screenOn) getMainExecutor().execute(this::startRecognition);
    }

    @Override public void onResults(Bundle results) {
        ArrayList<String> values = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        String phrase = values == null || values.isEmpty() ? "" : values.get(0);
        if (phrase != null && phrase.toLowerCase(Locale.ROOT).matches("(?s).*\\b(hello|hey)\\s+jarvis\\b.*")) {
            paused = true;
            releaseRecognizer();
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                launch.putExtra("jarvis_wake_detected", true);
                startActivity(launch);
            }
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                Intent event = new Intent(ACTION_WAKE_DETECTED);
                event.setPackage(getPackageName());
                sendBroadcast(event);
            }, 2200);
        } else restartRecognition();
    }
    @Override public void onError(int error) { restartRecognition(); }
    @Override public void onPartialResults(Bundle partial) {
        ArrayList<String> values = partial == null ? null : partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        String phrase = values == null || values.isEmpty() ? "" : values.get(0);
        if (phrase != null && phrase.toLowerCase(Locale.ROOT).matches("(?s).*\\b(hello|hey)\\s+jarvis\\b.*")) onResults(partial);
    }
    @Override public void onReadyForSpeech(Bundle params) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rmsdB) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onEvent(int eventType, Bundle params) {}

    private void releaseRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    @Override public void onDestroy() {
        releaseRecognizer();
        try { unregisterReceiver(screenReceiver); } catch (Exception ignored) {}
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}