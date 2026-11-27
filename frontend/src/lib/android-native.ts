import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AndroidVoice {
  name: string;
  language: string;
  quality: number;
}

interface JarvisNativePlugin {
  checkOverlayPermission(): Promise<{ granted: boolean }>;
  requestOverlayPermission(): Promise<{ granted: boolean }>;
  isFloatingAssistantRunning(): Promise<{ running: boolean }>;
  startFloatingAssistant(): Promise<{ started: boolean }>;
  stopFloatingAssistant(): Promise<void>;
  checkMicrophonePermission(): Promise<{ state: string; available: boolean }>;
  isWakeWordEnabled(): Promise<{ enabled: boolean }>;
  enableWakeWord(): Promise<{ enabled: boolean }>;
  disableWakeWord(): Promise<{ enabled: boolean }>;
  pauseWakeWord(): Promise<void>;
  resumeWakeWord(): Promise<void>;
  addListener(eventName: 'wakeDetected', listener: (event: { detected: boolean }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: 'speechResult', listener: (event: { text: string }) => void): Promise<{ remove: () => Promise<void> }>;
  startRecognition(options: { language: string }): Promise<{ started: boolean }>;
  stopRecognition(): Promise<{ text: string }>;
  cancelRecognition(): Promise<void>;
  openAppSettings(): Promise<void>;
  openSystemPanel(options: { panel: string }): Promise<void>;
  launchApp(options: { packageName: string }): Promise<void>;
  setMediaVolume(options: { percent: number }): Promise<{ percent: number }>;
  getBatteryStatus(): Promise<{ percent: number; charging: boolean }>;
  saveSecureValue(options: { name: string; value: string }): Promise<void>;
  getSecureValue(options: { name: string }): Promise<{ value: string }>;
  getSecureStatus(): Promise<Record<string, boolean>>;
  getSpeechVoices(): Promise<{ voices: AndroidVoice[] }>;
  speak(options: {
    text: string;
    language: string;
    voiceName?: string;
    rate: number;
    pitch: number;
    volume: number;
  }): Promise<void>;
  stopSpeaking(): Promise<void>;
}

export const JarvisNative = registerPlugin<JarvisNativePlugin>('JarvisNative');

export const isAndroidNative = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export interface JarvisCoreStatus {
  nativeAvailable: boolean;
  modelDownloaded: boolean;
  modelBytes: number;
  modelLoaded: boolean;
  modelSlug: string;
}

interface JarvisCoreNativePlugin {
  getStatus(options?: { modelSlug?: string }): Promise<JarvisCoreStatus>;
  downloadModel(options?: { modelSlug?: string }): Promise<{ downloaded: boolean; bytes: number; modelSlug: string }>;
  initializeModel(options?: { modelSlug?: string; contextSize?: number }): Promise<{ loaded: boolean; model: string }>;
  complete(options: { modelSlug?: string; messages: string; maxTokens?: number; temperature?: number }): Promise<{
    response: string;
    tokensPerSecond: number;
    totalTimeMs: number;
    timeToFirstTokenMs: number;
    model: string;
  }>;
  reset(): Promise<void>;
  unload(): Promise<void>;
  addListener(eventName: 'coreDownloadProgress', listener: (event: {
    progress: number;
    receivedBytes: number;
    totalBytes: number;
    stage: string;
    modelSlug?: string;
  }) => void): Promise<{ remove: () => Promise<void> }>;
}

export const JarvisCoreNative = registerPlugin<JarvisCoreNativePlugin>('JarvisCoreNative');
export const JARVIS_CORE_MODEL_ID = 'jarvis-core-local';
export const JARVIS_CORE_MODEL_SLUG = 'qwen3-1.7b';
export const JARVIS_VISION_MODEL_ID = 'jarvis-vision-local';
export const JARVIS_VISION_MODEL_SLUG = 'lfm2.5-vl-1.6b';
