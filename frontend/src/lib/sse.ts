import type { ResearchEvent, SSEEvent } from '../types';
import { getBase, authHeaders, isAndroidNative } from './api';
import { timeZoneHeaders } from './timezone';
import { JarvisLocalModel } from './local-model';
import { JarvisInference } from './jarvis-inference';

export interface ChatRequest {
  model: string;
  conversation_id?: string;
  messages: Array<{ role: string; content: string; images?: string[] }>;
  stream: true;
  temperature?: number;
  max_tokens?: number;
  memory_context?: boolean;
}

function toLocalPrompt(messages: ChatRequest['messages']): string {
  return messages.slice(-16).map((message) => {
    const role = message.role === 'assistant' ? 'JARVIS' : message.role === 'system' ? 'SYSTEM' : 'USER';
    return `${role}: ${message.content}`;
  }).join('\n\n') + '\n\nJARVIS:';
}

export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  // If a local GGUF is installed, it is the primary chat engine on Android.
  // Prompts and conversation history remain on-device. Image payloads are not
  // silently forwarded to a cloud provider when local vision is unavailable.
  if (isAndroidNative()) {
    const model = await JarvisLocalModel.getModelStatus();
    if (model.ready && model.path) {
      if (request.messages.some((message) => (message.images?.length ?? 0) > 0)) {
        throw new Error('This local model runtime currently supports text only. Remove the image or use a verified vision model after vision support is enabled.');
      }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const status = await JarvisInference.getStatus();
      if (!status.loaded) await JarvisInference.loadModel({ path: model.path });
      yield { event: 'inference_start', data: JSON.stringify({ model: 'JARVIS Local', engine: 'llama.cpp', turn: 1 }) };
      const result = await JarvisInference.generate({
        prompt: toLocalPrompt(request.messages),
        maxTokens: Math.min(request.max_tokens ?? 256, 512),
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      yield { data: JSON.stringify({ choices: [{ delta: { content: result.text }, finish_reason: null }], model: 'jarvis-local', engine: 'llama.cpp' }) };
      yield { data: JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], model: 'jarvis-local', engine: 'llama.cpp' }) };
      return;
    }
  }

  const base = getBase();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', ...timeZoneHeaders() }),
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      let currentEvent: string | undefined;
      for (const line of lines) {
        if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
        else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          yield { event: currentEvent, data };
          currentEvent = undefined;
        } else if (line.trim() === '') currentEvent = undefined;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamResearch(
  query: string,
  model?: string,
  signal?: AbortSignal,
): AsyncGenerator<ResearchEvent> {
  const base = getBase().replace(/\/v1\/?$/, '');
  const response = await fetch(`${base}/api/research`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query, ...(model ? { model } : {}) }),
    signal,
  });
  if (!response.ok) throw new Error(`Research request failed: ${response.status}`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as ResearchEvent;
          yield parsed;
          if (parsed.type === 'done') return;
        } catch { /* Ignore malformed event chunks. */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
