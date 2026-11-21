import { Capacitor, registerPlugin } from '@capacitor/core';

export interface OfflineModelInfo { name: string; sizeBytes: number }
export interface OfflineStatus {
  runtimeAvailable: boolean;
  modelLoaded: boolean;
  models: OfflineModelInfo[];
}
interface JarvisOfflinePlugin {
  status(): Promise<OfflineStatus>;
  importModel(): Promise<OfflineModelInfo>;
  loadModel(options: { name: string }): Promise<{ loaded: boolean; name: string }>;
  generate(options: { prompt: string; maxTokens?: number; temperature?: number }): Promise<{ text: string; engine: string }>;
  unloadModel(): Promise<void>;
}
export const JarvisOffline = registerPlugin<JarvisOfflinePlugin>('JarvisOffline');
export const isJarvisOfflineAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const isJarvisOfflineMode = () => {
  try { return localStorage.getItem('jarvis-ai-mode') === 'offline'; } catch { return false; }
};
