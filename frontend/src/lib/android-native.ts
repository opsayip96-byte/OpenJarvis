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
  getStatus(): Promise<JarvisCoreStatus>;
  downloadModel(): Promise<{ downloaded: boolean; bytes: number }>;
  initializeModel(options?: { contextSize?: number }): Promise<{ loaded: boolean; model: string }>;
  complete(options: { messages: string; maxTokens?: number; temperature?: number }): Promise<{
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
  }) => void): Promise<{ remove: () => Promise<void> }>;
}

export const JarvisCoreNative = registerPlugin<JarvisCoreNativePlugin>('JarvisCoreNative');
export const JARVIS_CORE_MODEL_ID = 'jarvis-core-local';
