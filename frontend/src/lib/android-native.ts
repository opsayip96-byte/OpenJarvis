import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AndroidVoice {
  name: string;
  language: string;
  quality: number;
}

interface JarvisNativePlugin {
  checkMicrophonePermission(): Promise<{ state: string; available: boolean }>;
  startRecognition(options: { language: string }): Promise<{ started: boolean }>;
  stopRecognition(): Promise<{ text: string }>;
  cancelRecognition(): Promise<void>;
  openAppSettings(): Promise<void>;
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
