import type { ResearchEvent, SSEEvent } from '../types';
import { getBase, authHeaders } from './api';
import { isAndroidNative } from './android-native';
import { timeZoneHeaders } from './timezone';

export interface ChatRequest {
  model: string;
  conversation_id?: string;
  messages: Array<{ role: string; content: string }>;
  stream: true;
  temperature?: number;
  max_tokens?: number;
  memory_context?: boolean;
}

function requireBackendBase(): string {
  const base = getBase().replace(/\\/+$/, '');
  if (!base) {
    throw new Error(
      'JARVIS backend is not configured. Open Settings → Connection → API URL and enter your HTTPS backend address.',
    );
  }
  if (isAndroidNative() && !base.startsWith('https://')) {
    throw new Error(
      'Android requires a public HTTPS JARVIS backend URL. Check Settings → Connection → API URL.',
    );
  }
  return base;
}

async function responseError(response: Response, operation: string): Promise<Error> {
  const body = await response.text().catch(() => '');
  let detail = body.trim();
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      detail = String(parsed.detail ?? parsed.error?.message ?? parsed.message ?? detail);
    } catch {
      // Keep a short plain-text server error.
    }
  }
  return new Error(
    `${operation} failed (${response.status})${detail ? `: ${detail.slice(0, 400)}` : ''}`,
  );
}

export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const base = requireBackendBase();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', ...timeZoneHeaders() }),
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) throw await responseError(response, 'JARVIS chat request');

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!response.body) {
    throw new Error('JARVIS backend returned an empty response stream.');
  }

  // Some compatible servers ignore stream=true and return a normal JSON
  // completion. Handle that response instead of silently showing an empty chat.
  if (!contentType.includes('text/event-stream')) {
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      throw new Error(`JARVIS backend returned an unexpected response type: ${contentType || 'unknown'}.`);
    }
    yield { event: undefined, data: JSON.stringify(payload) };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | undefined;

  const parseLine = (line: string): SSEEvent | null => {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
      return null;
    }
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      const event = { event: currentEvent, data };
      currentEvent = undefined;
      return event;
    }
    if (line.trim() === '') currentEvent = undefined;
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const event = parseLine(line.replace(/\\r$/, ''));
        if (event) {
          if (event.data === '[DONE]') return;
          yield event;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseLine(buffer.replace(/\\r$/, ''));
      if (event && event.data !== '[DONE]') yield event;
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
  // /api/research is mounted at the server root — strip any trailing /v1
  // from the base so configurations like "http://host:8000/v1" still resolve.
  const base = requireBackendBase().replace(/\\/v1\\/?$/, '');
  const response = await fetch(`${base}/api/research`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query, ...(model ? { model } : {}) }),
    signal,
  });

  if (!response.ok) throw await responseError(response, 'JARVIS research request');
  if (!response.body) throw new Error('JARVIS backend returned an empty research stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as ResearchEvent;
          yield parsed;
          if (parsed.type === 'done') return;
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
