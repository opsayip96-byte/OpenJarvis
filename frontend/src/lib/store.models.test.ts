import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelInfo } from '../types';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const model = (id: string): ModelInfo => ({
  id,
  object: 'model',
  created: 0,
  owned_by: 'openjarvis',
});

beforeEach(() => {
  vi.resetModules();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
});

afterEach(() => {
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage =
    undefined;
});

describe('setModels', () => {
  it('does not select an embedding-only model', async () => {
    const { useAppStore } = await import('./store');

    useAppStore.getState().setModels([model('nomic-embed-text')]);

    expect(useAppStore.getState().selectedModel).toBe('');
  });

  it('clears a missing selection when no chat fallback exists', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.getState().setSelectedModel('deleted-chat-model');

    useAppStore.getState().setModels([model('nomic-embed-text')]);

    expect(useAppStore.getState().selectedModel).toBe('');
  });

  it('replaces an embedding selection with an available chat model', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.getState().setSelectedModel('all-minilm:latest');

    useAppStore.getState().setModels([
      model('all-minilm:latest'),
      model('qwen3.5:4b'),
    ]);

    expect(useAppStore.getState().selectedModel).toBe('qwen3.5:4b');
  });

  it('prefers the server active model over the first model from a multi-engine list', async () => {
    const { useAppStore } = await import('./store');
    useAppStore.getState().setServerInfo({ model: 'openrouter/free', engine: 'multi', agent: null } as any);

    useAppStore.getState().setModels([
      model('bigcode/starcoder2-15b'),
      model('openrouter/free'),
    ]);

    expect(useAppStore.getState().selectedModel).toBe('openrouter/free');
  });

  it('repairs a stale persisted NIM preference and persists the active model', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage;
    storage.setItem('openjarvis-settings', JSON.stringify({ defaultModel: 'bigcode/starcoder2-15b' }));
    const { useAppStore } = await import('./store');
    useAppStore.getState().setServerInfo({ model: 'openrouter/free', engine: 'multi', agent: 'orchestrator' });

    // NIM is omitted by the server unless it has passed provider/model verification.
    useAppStore.getState().setModels([model('openrouter/free')]);

    expect(useAppStore.getState().selectedModel).toBe('openrouter/free');
    expect(useAppStore.getState().settings.defaultModel).toBe('openrouter/free');
    expect(JSON.parse(storage.getItem('openjarvis-settings') || '{}').defaultModel).toBe('openrouter/free');
  });

  it('persists an explicit user model selection', async () => {
    const storage = globalThis.localStorage as unknown as MemoryStorage;
    const { useAppStore } = await import('./store');

    useAppStore.getState().setSelectedModel('openrouter/free');

    expect(JSON.parse(storage.getItem('openjarvis-settings') || '{}').defaultModel).toBe('openrouter/free');
  });
});
