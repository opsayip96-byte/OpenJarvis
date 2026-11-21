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
  searchRelevant: async (query: string, limit = 6) => {
    const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'about', 'there', 'their', 'your', 'you', 'are', 'was', 'were', 'will', 'been', 'being', 'into', 'then', 'than', 'them', 'they', 'and', 'the', 'for']);
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])]
      .filter((term) => !stopWords.has(term))
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);
    if (!terms.length) return [] as JarvisMemoryItem[];
    const batches = await Promise.all(terms.map((term) => NativeMemory.search({ query: term, limit: 8 })));
    const unique = new Map<number, JarvisMemoryItem>();
    for (const batch of batches) for (const item of batch.items) unique.set(item.id, item);
    return [...unique.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
  save: (content: string, category = 'general') =>
    NativeMemory.save({ content, category }),
  list: (limit = 50) => NativeMemory.list({ limit }),
  search: (query: string, limit = 20) => NativeMemory.search({ query, limit }),
  delete: (id: number) => NativeMemory.delete({ id }),
  count: () => NativeMemory.count(),
};
