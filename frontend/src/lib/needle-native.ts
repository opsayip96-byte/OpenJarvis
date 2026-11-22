import { registerPlugin } from '@capacitor/core';

export interface NeedleStatus {
  nativeAvailable: boolean;
  modelDownloaded: boolean;
  modelBytes: number;
  modelLoaded: boolean;
}

interface NeedleNativePlugin {
  getStatus(): Promise<NeedleStatus>;
  downloadModel(): Promise<{ downloaded: boolean; bytes: number }>;
  loadModel(options: { systemPrompt?: string; toolsJson?: string }): Promise<{ loaded: boolean; bytes: number }>;
  complete(options: { input: string; maxTokens?: number }): Promise<{ response: string }>;
  reset(): Promise<void>;
}

export const NeedleNative = registerPlugin<NeedleNativePlugin>('NeedleNative');
