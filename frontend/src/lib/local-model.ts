import { registerPlugin } from '@capacitor/core';

export interface LocalModelStatus {
  ready: boolean;
  sizeBytes: number;
  path: string;
  name?: string;
  sha256?: string;
}

interface JarvisLocalModelPlugin {
  chooseModel(): Promise<LocalModelStatus>;
  getModelStatus(): Promise<LocalModelStatus>;
  removeModel(): Promise<{ ready: boolean }>;
}

export const JarvisLocalModel = registerPlugin<JarvisLocalModelPlugin>('JarvisLocalModel');
