import { registerPlugin } from '@capacitor/core';

export interface JarvisControlNativePlugin {
  launchKnownApp(options: { app: string }): Promise<{ launched: boolean; packageName: string }>;
}

export const JarvisControlNative = registerPlugin<JarvisControlNativePlugin>('JarvisControl');
