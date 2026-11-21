import { registerPlugin } from '@capacitor/core';

export interface JarvisDeviceStatus {
  batteryPercent: number;
  charging: boolean;
  manufacturer: string;
  model: string;
  androidVersion: string;
  sdk: number;
}

export interface JarvisControlNativePlugin {
  launchKnownApp(options: { app: string }): Promise<{ launched: boolean; packageName: string }>;
  getDeviceStatus(): Promise<JarvisDeviceStatus>;
  openSystemPanel(options: { panel: string }): Promise<{ opened: boolean; panel: string }>;
  openWebUrl(options: { url: string }): Promise<void>;
  createCalendarEvent(options: { title: string; beginAt: number; endAt: number }): Promise<void>;
  setAlarm(options: { hour: number; minute: number; message: string }): Promise<void>;
  setTimer(options: { seconds: number; message: string }): Promise<void>;
  shareText(options: { text: string }): Promise<void>;
}

export const JarvisControlNative = registerPlugin<JarvisControlNativePlugin>('JarvisControl');
