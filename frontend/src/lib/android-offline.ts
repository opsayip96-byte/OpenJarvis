import { Capacitor, registerPlugin } from '@capacitor/core';

export interface OfflineModel {
  name: string;
  sizeBytes: number;
}
export interface OfflineStatus {
  runtimeAvailable: boolean;
  modelLoaded: boolean;
  models: OfflineModel[];
}
interface JarvisOfflinePlugin {
  status(): Promise<OfflineStatus>;
  importModel(): Promise<OfflineModel>;
  loadModel(options?: { name?: string }): Promise<{ loaded: boolean; name: string }>;
  generate(options: { prompt: string; maxTokens?: number; temperature?: number }): Promise<{ text: string; engine: string }>;
  unloadModel(): Promise<void>;
}
const NativeOffline = registerPlugin<JarvisOfflinePlugin>('JarvisOffline');

export const isJarvisOfflineAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const isJarvisOfflineMode = () => {
  if (!isJarvisOfflineAvailable()) return false;
  try { return localStorage.getItem('jarvis-ai-mode') === 'offline'; }
  catch { return false; }
};

export const JarvisOffline = {
  status: () => NativeOffline.status(),
  importModel: () => NativeOffline.importModel(),
  loadModel: (options: { name?: string } = {}) => NativeOffline.loadModel(options),
  generate: (options: { prompt: string; maxTokens?: number; temperature?: number }) =>
    NativeOffline.generate(options),
  unloadModel: () => NativeOffline.unloadModel(),
};
