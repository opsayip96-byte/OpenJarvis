import { registerPlugin } from '@capacitor/core';

export interface JarvisNanoStatus {
  runtimeAvailable: boolean;
  loaded: boolean;
  modelPath: string;
}

export interface JarvisNanoPlugin {
  getStatus(): Promise<JarvisNanoStatus>;
  importModel(): Promise<{ loaded: boolean; model: string }>;
  generate(options: { prompt: string; maxTokens: number }): Promise<{ text: string }>;
  unload(): Promise<void>;
}

export const JarvisNanoNative = registerPlugin<JarvisNanoPlugin>('JarvisNano');
