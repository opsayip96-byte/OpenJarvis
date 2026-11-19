import { registerPlugin } from '@capacitor/core';

export interface JarvisInferenceStatus { loaded: boolean; engine: string; }
export interface JarvisInferenceResult { loaded: boolean; engine: string; device?: string; }
export interface JarvisGenerationResult { text: string; engine: string; local: boolean; }

interface JarvisInferencePlugin {
  loadModel(options: { path: string }): Promise<JarvisInferenceResult>;
  generate(options: { prompt: string; maxTokens?: number }): Promise<JarvisGenerationResult>;
  unloadModel(): Promise<{ loaded: boolean }>;
  getStatus(): Promise<JarvisInferenceStatus>;
}

export const JarvisInference = registerPlugin<JarvisInferencePlugin>('JarvisInference');
