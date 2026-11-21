import { Capacitor, registerPlugin } from '@capacitor/core';

export interface JarvisMemoryItem {
  id: number;
  content: string;
  category: string;
  createdAt: number;
}

interface JarvisMemoryPlugin {
  save(options: { content: string; category?: string }): Promise<JarvisMemoryItem>;
  list(options?: { limit?: number }): Promise<{ items: JarvisMemoryItem[] }>;
  search(options: { query: string; limit?: number }): Promise<{ items: JarvisMemoryItem[] }>;
  delete(options: { id: number }): Promise<{ deleted: boolean }>;
  count(): Promise<{ count: number }>;
}

const NativeMemory = registerPlugin<JarvisMemoryPlugin>('JarvisMemory');

export const isNativeMemoryAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const JarvisMemory = {
  save: (content: string, category = 'general') =>
    NativeMemory.save({ content, category }),
  list: (limit = 50) => NativeMemory.list({ limit }),
  search: (query: string, limit = 20) => NativeMemory.search({ query, limit }),
  delete: (id: number) => NativeMemory.delete({ id }),
  count: () => NativeMemory.count(),
};
