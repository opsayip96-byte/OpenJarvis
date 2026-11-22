import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth } from '../lib/api';
import { isAndroidNative, JarvisNative } from '../lib/android-native';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserRecognitionConstructor = new () => BrowserRecognition;

interface SpeechWindow extends Window {
  SpeechRecognition?: BrowserRecognitionConstructor;
  webkitSpeechRecognition?: BrowserRecognitionConstructor;
}

function browserRecognitionConstructor(): BrowserRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function useSpeech() {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const recognitionTranscriptRef = useRef('');
  const recognitionResolveRef = useRef<((text: string) => void) | null>(null);
  const recognitionRejectRef = useRef<((error: Error) => void) | null>(null);

  // Prefer the browser's native speech service on mobile. Fall back to the
  // existing server transcription path when Web Speech is unavailable.
  useEffect(() => {
    if (isAndroidNative()) {
      JarvisNative.checkMicrophonePermission()
        .then(async ({ available: canRecognize }) => {
          if (canRecognize) {
            setAvailable(true);
            return;
          }
          try {
            const health = await fetchSpeechHealth();
            setAvailable(health.available);
          } catch {
            setAvailable(false);
          }
        })
        .catch(() => setAvailable(false));
    } else if (browserRecognitionConstructor()) {
      setAvailable(true);
    } else {
      fetchSpeechHealth()
        .then((health) => setAvailable(health.available))
        .catch(() => setAvailable(false));
    }

    return () => {
      if (isAndroidNative()) void JarvisNative.cancelRecognition().catch(() => {});
      recognitionRef.current?.abort();
      recognitionResolveRef.current = null;
      recognitionRejectRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);
    setPermissionDenied(false);

    if (isAndroidNative()) {
      try {
        let configuredLanguage = '';
        try { configuredLanguage = localStorage.getItem('openjarvis-speech-language') || ''; } catch {}
        await JarvisNative.startRecognition({ language: configuredLanguage || 'en-GB' });
        setState('recording');
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not start Android speech recognition.';
        const code = String((err as { code?: string })?.code ?? '');
        if (code !== 'RECOGNIZER_UNAVAILABLE') {
          const denied = code.includes('MICROPHONE_PERMISSION_DENIED') || /microphone permission/i.test(message);
          setPermissionDenied(denied);
          setError(message);
          setState('idle');
          return;
        }
        // Some Android builds have no system speech service. Fall through to
        // browser recognition or recorded-audio transcription instead.
      }
    }

    const Recognition = browserRecognitionConstructor();
    if (Recognition) {
      try {
        const recognition = new Recognition();
        let configuredLanguage = '';
        try { configuredLanguage = localStorage.getItem('openjarvis-speech-language') || ''; } catch {}
        recognition.lang = configuredLanguage || navigator.language || 'en-US';
        // Keep the recognition session open until the user taps stop. A
        // one-shot session may emit `end` before stopRecording() can collect
        // its transcript, which silently discards speech on mobile browsers.
        recognition.continuous = true;
        recognition.interimResults = false;
        recognitionTranscriptRef.current = '';
        recognition.onresult = (event) => {
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            if (result?.isFinal) {
              recognitionTranscriptRef.current += result[0]?.transcript ?? '';
            }
          }
        };
        recognition.onerror = (event) => {
          const messages: Record<string, string> = {
            'not-allowed': 'Microphone permission was denied.',
            'service-not-allowed': 'Browser speech recognition is unavailable.',
            'no-speech': 'No speech was detected. Try again or type your message.',
            'audio-capture': 'No microphone is available.',
            network: 'Browser speech recognition needs a network connection.',
          };
          const error = new Error(messages[event.error ?? ''] ?? 'Speech recognition failed.');
          setError(error.message);
          setState('idle');
          recognitionRejectRef.current?.(error);
          recognitionResolveRef.current = null;
          recognitionRejectRef.current = null;
          recognitionRef.current = null;
        };
        recognition.onend = () => {
          const transcript = recognitionTranscriptRef.current.trim();
          recognitionResolveRef.current?.(transcript);
          recognitionResolveRef.current = null;
          recognitionRejectRef.current = null;
          recognitionRef.current = null;
          setState('idle');
        };
        recognition.start();
        recognitionRef.current = recognition;
        setState('recording');
        return;
      } catch {
        setError('Could not start browser speech recognition. Check microphone permission.');
        setState('idle');
        return;
      }
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState('recording');
    } catch (err) {
      setError('Microphone access denied');
      setState('idle');
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    if (isAndroidNative()) {
      setState('transcribing');
      try {
        const result = await JarvisNative.stopRecognition();
        setState('idle');
        if (!result.text.trim()) throw new Error('No speech was detected. Try again.');
        return result.text.trim();
      } catch (err) {
        setState('idle');
        const message = err instanceof Error ? err.message : 'Speech recognition failed.';
        const code = String((err as { code?: string })?.code ?? '');
        setPermissionDenied(code.includes('MICROPHONE_PERMISSION_DENIED') || /microphone permission/i.test(message));
        setError(message);
        throw err;
      }
    }
    const recognition = recognitionRef.current;
    if (recognition) {
      setState('transcribing');
      return new Promise((resolve, reject) => {
        recognitionResolveRef.current = resolve;
        recognitionRejectRef.current = reject;
        try {
          recognition.stop();
        } catch {
          recognitionResolveRef.current = null;
          recognitionRejectRef.current = null;
          setState('idle');
          reject(new Error('Could not stop speech recognition.'));
        }
      });
    }

    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') {
        reject(new Error('Not recording'));
        return;
      }

      recorder.onstop = async () => {
        setState('transcribing');

        // Stop all audio tracks
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];

        try {
          const result = await transcribeAudio(blob);
          setState('idle');
          resolve(result.text);
        } catch (err) {
          setState('idle');
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          setError(msg);
          reject(err);
        }
      };

      recorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(async (): Promise<void> => {
    if (isAndroidNative()) await JarvisNative.cancelRecognition().catch(() => {});
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setState('idle');
  }, []);

  const openPermissionSettings = useCallback(async (): Promise<void> => {
    if (isAndroidNative()) await JarvisNative.openAppSettings();
  }, []);

  return {
    state,
    error,
    available,
    permissionDenied,
    openPermissionSettings,
    cancelRecording,
    startRecording,
    stopRecording,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}
