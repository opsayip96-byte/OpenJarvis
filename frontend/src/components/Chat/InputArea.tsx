import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Square, Paperclip, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore, generateId } from '../../lib/store';
import { streamChat, streamResearch } from '../../lib/sse';
import { fetchSavings, getBase, authHeaders, isMemoryContextEnabled } from '../../lib/api';
import { listConnectors, getSyncStatus } from '../../lib/connectors-api';
import { serializeToolCallArguments } from '../../lib/tool-call';
import { NeedleNative } from '../../lib/needle-native';
import { isAndroidNative, JarvisNative } from '../../lib/android-native';
import {
  engineFromCompletionChunk,
  resolveChatEngine,
} from '../../lib/chat-telemetry';
import { MicButton } from './MicButton';
import { useSpeech } from '../../hooks/useSpeech';
import type {
  ChatMessage,
  MessageTelemetry,
  ResearchSearchTrace,
  ResearchSource,
  TokenUsage,
  ToolCallInfo,
} from '../../types';

const MAX_MEDIA_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_EDGE = 1280;

function canvasToJpegBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '';
}

async function captureVideoFrames(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`Could not read video: ${file.name}`));
      video.load();
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) throw new Error(`Video has no readable duration: ${file.name}`);
    const times = [...new Set([0, duration / 2, Math.max(0, duration - 0.15)])];
    const frames: string[] = [];
    for (const time of times) {
      if (Math.abs(video.currentTime - time) > 0.02) {
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error(`Could not read a frame from ${file.name}`));
          video.currentTime = time;
        });
      }
      const scale = Math.min(1, MAX_MEDIA_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This device cannot process video frames.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvasToJpegBase64(canvas));
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function prepareMediaImages(files: File[]): Promise<string[]> {
  const payloads: string[] = [];
  for (const file of files) {
    if (file.size > MAX_MEDIA_FILE_BYTES) {
      throw new Error(`${file.name} is larger than 25 MB. Choose a smaller file.`);
    }
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, MAX_MEDIA_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This device cannot process the selected photo.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        payloads.push(canvasToJpegBase64(canvas));
      } finally {
        bitmap.close();
      }
    } else if (file.type.startsWith('video/')) {
      payloads.push(...await captureVideoFrames(file));
    } else {
      throw new Error(`Unsupported file type: ${file.name}. Choose a photo or video.`);
    }
  }
  return payloads;
}

// While Deep Research is toggled on, poll connected sources for sync
// progress so we can surface "Searching over N items — sync in progress"
// next to the toggle. Polling is gated on `enabled` so toggling DR off
// stops the network chatter immediately.
function useResearchCorpusSync(enabled: boolean): {
  syncing: boolean;
  itemsSynced: number;
} {
  const [state, setState] = useState({ syncing: false, itemsSynced: 0 });

  useEffect(() => {
    if (!enabled) {
      setState({ syncing: false, itemsSynced: 0 });
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const list = await listConnectors();
        const connected = list.filter((c) => c.connected);
        if (connected.length === 0) {
          if (!cancelled) setState({ syncing: false, itemsSynced: 0 });
          return;
        }
        const results = await Promise.all(
          connected.map(async (c) => {
            try {
              return await getSyncStatus(c.connector_id);
            } catch {
              return null;
            }
          }),
        );
        let syncing = false;
        let itemsSynced = 0;
        for (const r of results) {
          if (!r) continue;
          if (r.state === 'syncing') syncing = true;
          itemsSynced += r.items_synced ?? 0;
        }
        if (!cancelled) setState({ syncing, itemsSynced });
      } catch {
        // Network blip — leave previous state intact.
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return state;
}

async function handleNeedleResult(raw: string): Promise<string> {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.trim();
  }
  if (!parsed || typeof parsed !== 'object') return raw.trim();
  if (parsed.success === false) {
    throw new Error(parsed.error || 'Needle could not route this request.');
  }
  const calls = Array.isArray(parsed.function_calls) ? parsed.function_calls : [];
  const confidence = Number(parsed.confidence ?? 0);
  if (calls.length === 0) {
    return "I'm online. Needle 3 is running locally. I act as JARVIS's tool-routing model: I select an available action and prepare its arguments. For normal conversation, choose your JARVIS chat model.";
  }
  if (confidence < 0.7) {
    const names = calls.map((call: any) => String(call.name || 'unknown action')).join(', ');
    return `I found a possible action (${names}), but confidence is too low to run it safely. Please rephrase the request.`;
  }
  const completed: string[] = [];
  for (const call of calls) {
    const name = String(call?.name || '');
    const args = call?.arguments && typeof call.arguments === 'object' ? call.arguments : {};
    if (name === 'speak_text') {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('Needle requested speech without any text.');
      await JarvisNative.speak({ text, language: 'en-GB', rate: 1, pitch: 1, volume: 1 });
      completed.push('Spoke the requested text.');
    } else if (name === 'open_app_settings') {
      await JarvisNative.openAppSettings();
      completed.push('Opened JARVIS app settings.');
    } else if (name === 'stop_speaking') {
      await JarvisNative.stopSpeaking();
      completed.push('Stopped speech.');
    } else if (name === 'open_system_panel') {
      const panel = String(args.panel || '').trim();
      const labels: Record<string, string> = {
        wifi: 'Wi-Fi settings',
        bluetooth: 'Bluetooth settings',
        display: 'Display settings',
        sound: 'Sound settings',
        battery: 'Battery settings',
        location: 'Location settings',
        app_settings: 'JARVIS app permissions',
      };
      if (!labels[panel]) throw new Error('Needle requested an unsupported Android settings panel.');
      await JarvisNative.openSystemPanel({ panel });
      completed.push(`Opened ${labels[panel]}.`);
    } else if (name === 'launch_app') {
      const packageName = String(args.packageName || '').trim();
      if (!/^[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+$/.test(packageName)) {
        throw new Error('To launch an app, JARVIS needs its valid Android package name.');
      }
      await JarvisNative.launchApp({ packageName });
      completed.push(`Launched ${packageName}.`);
    } else if (name === 'set_media_volume') {
      const percent = Number(args.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error('Media volume must be between 0 and 100 percent.');
      }
      const result = await JarvisNative.setMediaVolume({ percent });
      completed.push(`Set media volume to ${result.percent}%.`);
    } else if (name === 'get_battery_status') {
      const battery = await JarvisNative.getBatteryStatus();
      completed.push(`Phone battery is ${battery.percent}%, ${battery.charging ? 'charging' : 'not charging'}.`);
    } else {
      throw new Error(`Needle selected "${name}", but no Android executor is connected for that action yet.`);
    }
  }
  return completed.join(' ');
}

export function InputArea() {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendRecognizedSpeechRef = useRef<(text: string) => Promise<void>>(async () => {});

  const activeId = useAppStore((s) => s.activeId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const streamState = useAppStore((s) => s.streamState);
  const messages = useAppStore((s) => s.messages);
  const speechEnabled = useAppStore((s) => s.settings.speechEnabled);
  const maxTokens = useAppStore((s) => s.settings.maxTokens);
  const temperature = useAppStore((s) => s.settings.temperature);
  const createConversation = useAppStore((s) => s.createConversation);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateLastAssistant = useAppStore((s) => s.updateLastAssistant);
  const setStreamState = useAppStore((s) => s.setStreamState);
  const resetStream = useAppStore((s) => s.resetStream);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const deepResearch = useAppStore((s) => s.deepResearch);
  const setDeepResearch = useAppStore((s) => s.setDeepResearch);
  const corpusSync = useResearchCorpusSync(deepResearch);
  const isCurrentChatStreaming = streamState.isStreaming && streamState.conversationId === activeId;

  const {
    state: speechState,
    error: speechError,
    available: speechAvailable,
    permissionDenied: speechPermissionDenied,
    openPermissionSettings,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useSpeech();

  // Abort in-flight stream when the user switches models mid-generation.
  // This prevents errors from trying to continue a stream with a stale model.
  const prevModelRef = useRef(selectedModel);
  useEffect(() => {
    if (prevModelRef.current !== selectedModel && streamState.isStreaming) {
      abortRef.current?.abort();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      resetStream();
      abortRef.current = null;
    }
    prevModelRef.current = selectedModel;
  }, [selectedModel, streamState.isStreaming, resetStream]);

  const micDisabled = !speechEnabled || !speechAvailable || streamState.isStreaming;
  const micReason: 'not-enabled' | 'no-backend' | 'streaming' | undefined =
    !speechEnabled ? 'not-enabled'
    : !speechAvailable ? 'no-backend'
    : streamState.isStreaming ? 'streaming'
    : undefined;

  useEffect(() => {
    if (speechError) {
      toast.error(speechError, {
        duration: 8000,
        ...(speechPermissionDenied ? {
          action: { label: 'Open app permissions', onClick: () => void openPermissionSettings() },
        } : {}),
      });
    }
  }, [speechError, speechPermissionDenied, openPermissionSettings]);

  const handleMicClick = useCallback(async () => {
    if (speechState === 'recording') {
      try {
        const text = await stopRecording();
        if (text) {
          await sendRecognizedSpeechRef.current(text);
        }
      } catch {
        // Error is captured in useSpeech
      }
    } else {
      await startRecording();
    }
  }, [speechState, startRecording, stopRecording]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    resetStream();
  }, [resetStream]);

  const sendMessage = useCallback(async (recognizedText?: string) => {
    const filesToSend = attachments;
    const textContent = recognizedText
      ? [input.trim(), recognizedText.trim()].filter(Boolean).join(' ')
      : input.trim();
    const content = textContent || (filesToSend.length ? 'Please analyze the attached media.' : '');
    if ((!content && filesToSend.length === 0) || streamState.isStreaming) return;
    if (!selectedModel) {
      toast.error('Pick a model first (⌘K)');
      return;
    }
    if (selectedModel === 'needle3-local' && filesToSend.length > 0) {
      toast.error('Needle 3 currently handles text only. Select a vision-capable model to analyze photos or videos.');
      return;
    }

    let mediaImages: string[] = [];
    if (filesToSend.length > 0) {
      try {
        mediaImages = await prepareMediaImages(filesToSend);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not process the selected media.');
        return;
      }
    }
    setInput('');
    setAttachments([]);

    let convId = activeId;
    if (!convId) {
      convId = createConversation(selectedModel);
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: filesToSend.length
        ? `${content}\n\n[Attached media: ${filesToSend.map((file) => file.name).join(', ')}]`
        : content,
      timestamp: Date.now(),
    };
    addMessage(convId, userMsg);

    // Keep binary media out of local conversation storage. Attach the
    // processed frames only to this request payload.
    const currentMessages = useAppStore.getState().messages;
    const apiMessages = currentMessages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images?.length ? { images: m.images } : {}),
    }));
    if (mediaImages.length > 0) {
      const lastUserIndex = apiMessages.map((m) => m.role).lastIndexOf('user');
      if (lastUserIndex >= 0) apiMessages[lastUserIndex].images = mediaImages;
    }

    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isResearch: deepResearch || undefined,
    };
    addMessage(convId, assistantMsg);

    // Start streaming
    const startTime = Date.now();
    const timer = setInterval(() => {
      setStreamState({ elapsedMs: Date.now() - startTime });
    }, 100);
    timerRef.current = timer;

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulatedContent = '';
    let usage: TokenUsage | undefined;
    let complexity: { score: number; tier: string; suggested_max_tokens: number } | undefined;
    let routedEngine: string | undefined;
    const toolCalls: ToolCallInfo[] = [];
    const researchTraces: ResearchSearchTrace[] = [];
    const researchSourcesByRef = new Map<number, ResearchSource>();
    const flushSources = () =>
      Array.from(researchSourcesByRef.values()).sort((a, b) => a.ref - b.ref);
    let lastFlush = 0;
    let ttftMs: number | undefined;

    setStreamState({
      conversationId: convId,
      isStreaming: true,
      phase: deepResearch ? 'Researching...' : 'Generating...',
      elapsedMs: 0,
      activeToolCalls: [],
      content: '',
    });
    useAppStore.getState().addLogEntry({
      timestamp: Date.now(),
      level: 'info',
      category: 'chat',
      message: deepResearch
        ? `Research: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`
        : `Request: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}" → ${selectedModel}`,
    });

    const isNeedleLocal = selectedModel === 'needle3-local';

    let needleActionResponse: string | null = null;
    try {
      // On Android, Needle is the first-stage router even when a separate
      // chat model is selected. The selected model is only called after
      // Needle has inspected the request and returned no local action.
      if (!isNeedleLocal && isAndroidNative()) {
        setStreamState({ phase: 'Needle 3 analysing locally...' });
        const needleStatus = await NeedleNative.getStatus();
        if (!needleStatus.nativeAvailable || !needleStatus.modelDownloaded) {
          throw new Error('Needle 3 routing is not ready. Install the Needle-enabled JARVIS build and download the local Needle model in Settings.');
        }
        const routingInput = apiMessages
          .slice(-16)
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join('\\n\\n');
        const routed = await NeedleNative.complete({
          input: routingInput,
          maxTokens: Math.max(64, Math.min(maxTokens, 512)),
        });
        let routingResult: any = null;
        try { routingResult = JSON.parse(routed.response); } catch { /* no structured action */ }
        const routedCalls = Array.isArray(routingResult?.function_calls)
          ? routingResult.function_calls
          : [];
        if (routedCalls.length > 0) {
          needleActionResponse = await handleNeedleResult(routed.response);
          accumulatedContent = needleActionResponse;
          setStreamState({ content: accumulatedContent, phase: 'JARVIS completed the local action.' });
        } else {
          setStreamState({ phase: `Needle 3 ready. ${selectedModel} processing...` });
        }
      }

      if (isNeedleLocal) {
        if (deepResearch) {
          throw new Error('Deep Research requires a configured backend. Turn it off to chat locally with Needle 3.');
        }
        const localPrompt = apiMessages
          .slice(-16)
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join('\n\n');
        const result = await NeedleNative.complete({
          input: localPrompt,
          maxTokens: Math.max(64, Math.min(maxTokens, 512)),
        });
        const rawNeedleOutput = result.response?.trim() || '';
        if (!rawNeedleOutput) throw new Error('Needle returned an empty response. Check that the model is loaded in Settings.');
        accumulatedContent = await handleNeedleResult(rawNeedleOutput);
        setStreamState({ content: accumulatedContent, phase: '' });
        // A reply to microphone input should be audible even when the optional
        // chat-wide autoplay setting is off. Avoid speaking twice when Needle
        // already executed the explicit speak_text tool.
        if (recognizedText && !accumulatedContent.includes('Spoke the requested text.')) {
          try {
            await JarvisNative.speak({
              text: accumulatedContent,
              language: 'en-GB',
              rate: 1,
              pitch: 1,
              volume: 1,
            });
          } catch (speechError) {
            toast.error(speechError instanceof Error ? speechError.message : 'JARVIS could not speak the reply.');
          }
        }
      } else if (needleActionResponse !== null) {
        // Needle selected and executed a local Android action. Do not bypass it\n        // by sending the same request directly to the downstream model.\n      } else if (deepResearch) {
        for await (const ev of streamResearch(
          content,
          selectedModel,
          controller.signal,
        )) {
          if (ev.type === 'search_call') {
            const trace: ResearchSearchTrace = {
              id: generateId(),
              query: ev.arguments?.query ?? '',
              person: ev.arguments?.person,
              timeRange: ev.arguments?.time_range,
              status: 'pending',
            };
            researchTraces.push(trace);
            setStreamState({ phase: `Searching: ${trace.query}` });
            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'info',
              category: 'tool',
              message: `Search: "${trace.query}"${trace.person ? ` (person: ${trace.person})` : ''}`,
            });
          } else if (ev.type === 'search_result') {
            const pending = [...researchTraces].reverse().find((t) => t.status === 'pending');
            if (pending) {
              pending.status = 'complete';
              pending.numHits = ev.num_hits;
              pending.topTitles = ev.top_titles;
            }
            if (ev.sources) {
              for (const src of ev.sources) {
                if (src && typeof src.ref === 'number' && !researchSourcesByRef.has(src.ref)) {
                  researchSourcesByRef.set(src.ref, src);
                }
              }
            }
            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
          } else if (ev.type === 'synthesis') {
            if (!ttftMs) ttftMs = Date.now() - startTime;
            accumulatedContent += ev.text;
            setStreamState({ content: accumulatedContent, phase: '' });
            const now = Date.now();
            if (now - lastFlush >= 80) {
              updateLastAssistant(
                convId,
                accumulatedContent,
                undefined,
                undefined,
                undefined,
                undefined,
                [...researchTraces],
                flushSources(),
              );
              lastFlush = now;
            }
          } else if (ev.type === 'system_metrics') {
            // Live GPU sample — feed straight to the System panel so Power
            // (W) and Energy (kJ) tick up in real time as the agent runs.
            useAppStore.getState().setLiveEnergy({
              power_w: ev.power_w,
              energy_j: ev.energy_j,
              duration_s: ev.duration_s,
            });
          } else if (ev.type === 'error') {
            // Backend setup/worker failure (Ollama down, planner model
            // missing, KnowledgeStore locked, etc.). Without surfacing the
            // message, the user sees only the generic "No response was
            // generated" fallback and has no way to self-diagnose.
            const msg = ev.message || 'Research failed (no detail provided)';
            accumulatedContent = accumulatedContent
              ? `${accumulatedContent}\n\n**Research stopped:** ${msg}`
              : `**Research failed:** ${msg}`;
            setStreamState({ content: accumulatedContent, phase: '' });
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(),
              level: 'error',
              category: 'chat',
              message: `Deep Research error: ${msg}`,
            });
            toast.error(msg, { duration: 8000 });
          } else if (ev.type === 'done') {
            if (ev.usage) {
              usage = {
                prompt_tokens: ev.usage.prompt_tokens ?? 0,
                completion_tokens: ev.usage.completion_tokens ?? 0,
                total_tokens:
                  ev.usage.total_tokens ??
                  (ev.usage.prompt_tokens ?? 0) +
                    (ev.usage.completion_tokens ?? 0),
              };
              // Optimistically roll this research turn into the session
              // counters so the Session panel updates the moment the
              // stream finishes, regardless of how /v1/savings aggregates
              // research telemetry server-side.
              useAppStore.getState().incrementSavings(usage);
            }
            // Hold the final live numbers visible for a beat so the panel
            // doesn't flash to 0 between the SSE close and the next
            // /v1/telemetry/energy poll picking up the persisted record.
            window.setTimeout(() => {
              useAppStore.getState().setLiveEnergy(null);
            }, 1500);
            break;
          }
        }
      } else {
      for await (const sseEvent of streamChat(
        {
          model: selectedModel,
          conversation_id: convId,
          messages: apiMessages,
          stream: true,
          temperature,
          max_tokens: maxTokens,
          memory_context: isMemoryContextEnabled(),
        },
        controller.signal,
      )) {
        const eventName = sseEvent.event;

        if (eventName === 'agent_turn_start') {
          setStreamState({ phase: 'Agent thinking...' });
        } else if (eventName === 'inference_start') {
          setStreamState({ phase: 'Generating...' });
          useAppStore.getState().addLogEntry({
            timestamp: Date.now(), level: 'info', category: 'chat',
            message: `Generating with ${selectedModel}...`,
          });
        } else if (eventName === 'tool_call_start') {
          try {
            const data = JSON.parse(sseEvent.data);
            const tc: ToolCallInfo = {
              id: generateId(),
              tool: data.tool,
              arguments: serializeToolCallArguments(data.arguments),
              status: 'running',
            };
            toolCalls.push(tc);
            setStreamState({
              phase: `Calling ${data.tool}...`,
              activeToolCalls: [...toolCalls],
            });
            updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
            useAppStore.getState().addLogEntry({
              timestamp: Date.now(), level: 'info', category: 'tool',
              message: `Calling ${data.tool}(${serializeToolCallArguments(data.arguments)})`,
            });
          } catch {}
        } else if (eventName === 'tool_call_end') {
          try {
            const data = JSON.parse(sseEvent.data);
            const tc = toolCalls.find(
              (t) => t.tool === data.tool && t.status === 'running',
            );
            if (tc) {
              tc.status = data.success ? 'success' : 'error';
              tc.latency = data.latency;
              tc.result = data.result;
            }
            setStreamState({
              phase: 'Generating...',
              activeToolCalls: [...toolCalls],
            });
            updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
          } catch {}
        } else {
          try {
            const data = JSON.parse(sseEvent.data);
            const delta = data.choices?.[0]?.delta;
            if (data.usage) usage = data.usage;
            if (data.complexity) complexity = data.complexity;
            routedEngine = engineFromCompletionChunk(data) ?? routedEngine;
            if (delta?.content) {
              if (!ttftMs) ttftMs = Date.now() - startTime;
              accumulatedContent += delta.content;
              setStreamState({ content: accumulatedContent, phase: '' });

              const now = Date.now();
              if (now - lastFlush >= 80) {
                updateLastAssistant(
                  convId,
                  accumulatedContent,
                  toolCalls.length > 0 ? [...toolCalls] : undefined,
                );
                lastFlush = now;
              }
            }
            if (data.choices?.[0]?.finish_reason === 'stop') break;
          } catch {}
        }
      }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User cancelled or model switch — keep whatever was accumulated
        if (!accumulatedContent) accumulatedContent = '(Generation stopped)';
      } else {
        const errMsg = err?.message || String(err);
        accumulatedContent =
          accumulatedContent || `Error: ${errMsg}`;
        useAppStore.getState().addLogEntry({
          timestamp: Date.now(), level: 'error', category: 'chat',
          message: `Stream error: ${errMsg}`,
        });
      }
      // If we tore out mid-research, make sure the live System panel
      // numbers don't get stuck on the last sample.
      useAppStore.getState().setLiveEnergy(null);
    } finally {
      if (!accumulatedContent) {
        accumulatedContent = 'No response was generated. Please try again.';
      }
      const totalMs = Date.now() - startTime;
      const appState = useAppStore.getState();
      const selectedOwner = appState.models.find((m) => m.id === selectedModel)?.owned_by;
      const engineLabel = resolveChatEngine({
        routedEngine,
        serverEngine: appState.serverInfo?.engine,
        selectedModel,
        selectedOwner,
      });
      const telemetry: MessageTelemetry = {
        engine: engineLabel,
        model_id: selectedModel,
        total_ms: totalMs,
        ttft_ms: ttftMs,
        tokens_per_sec: usage?.completion_tokens
          ? usage.completion_tokens / (totalMs / 1000)
          : undefined,
        complexity_score: complexity?.score,
        complexity_tier: complexity?.tier,
        suggested_max_tokens: complexity?.suggested_max_tokens,
      };
      // Digest metadata is a backend feature. Do not make network requests
      // for a fully local Needle turn.
      let audioMeta: { url: string } | undefined;
      if (!isNeedleLocal) {
        try {
          const digestRes = await fetch(`${getBase()}/api/digest`, { headers: authHeaders() });
          if (digestRes.ok) {
            const digest = await digestRes.json();
            if (digest.audio_available) {
              audioMeta = { url: `${getBase()}/api/digest/audio` };
            }
          }
        } catch {
          // Not a digest response or server unavailable — skip
        }
      }

      updateLastAssistant(
        convId,
        accumulatedContent,
        toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        telemetry,
        audioMeta,
        researchTraces.length > 0 ? researchTraces : undefined,
        researchSourcesByRef.size > 0 ? flushSources() : undefined,
      );
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      resetStream();
      useAppStore.getState().addLogEntry({
        timestamp: Date.now(), level: 'info', category: 'chat',
        message: `Response: ${accumulatedContent.length} chars`,
      });
      abortRef.current = null;

      // Research path updates session counters optimistically from the
      // `done` event's usage payload — re-fetching here would overwrite
      // it with a potentially stale snapshot if the server's research
      // telemetry hasn't been merged into /v1/savings yet.
      if (!deepResearch && !isNeedleLocal) {
        fetchSavings()
          .then((data) => useAppStore.getState().setSavings(data))
          .catch(() => {});
      }
    }
  }, [
    input,
    attachments,
    activeId,
    selectedModel,
    streamState.isStreaming,
    createConversation,
    addMessage,
    updateLastAssistant,
    setStreamState,
    resetStream,
    deepResearch,
    temperature,
    maxTokens,
  ]);

  sendRecognizedSpeechRef.current = (text) => sendMessage(text);

  // When the user has explicitly started the microphone, accept a spoken
  // "Hello JARVIS" wake phrase and submit the words that follow it. This is
  // foreground, tap-to-enable listening, not an always-on background mic.
  useEffect(() => {
    if (!isAndroidNative()) return;
    let active = true;
    let listener: { remove: () => Promise<void> } | null = null;
    JarvisNative.addListener('speechResult', ({ text }) => {
      if (!active || !text) return;
      const match = text.match(/^(?:hello|hey)\\s+jarvis\\b[,.! ]*/i);
      if (!match) return;
      const command = text.slice(match[0].length).trim() || 'Hello';
      void (async () => {
        await cancelRecording();
        await sendRecognizedSpeechRef.current(command);
      })();
    }).then((handle) => {
      if (active) listener = handle;
      else void handle.remove();
    }).catch((error) => {
      console.warn('JARVIS wake phrase listener could not start:', error);
    });
    return () => {
      active = false;
      if (listener) void listener.remove();
    };
  }, [cancelRecording]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-input-safe-area px-4 pb-4 pt-2" style={{ maxWidth: 'var(--chat-max-width)', margin: '0 auto', width: '100%' }}>
      <div className="mb-2 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDeepResearch(!deepResearch)}
            disabled={streamState.isStreaming}
            aria-pressed={deepResearch}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
            style={{
              background: deepResearch ? 'var(--color-accent-subtle)' : 'transparent',
              border: `1px solid ${deepResearch ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: deepResearch ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            title={deepResearch ? 'Deep Research: on' : 'Deep Research: off'}
          >
            <Search size={12} />
            Deep Research
          </button>
        </div>
        {deepResearch && corpusSync.syncing && corpusSync.itemsSynced > 0 && (
          <div
            className="text-[11px] leading-snug"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Searching over{' '}
            <span key={corpusSync.itemsSynced} className="sync-bump" style={{ color: 'var(--color-text-secondary)' }}>
              {corpusSync.itemsSynced.toLocaleString()}
            </span>{' '}
            items — sync in progress, results will improve as more data is indexed.
          </div>
        )}
      </div>
      <div
        className="flex items-center gap-2 rounded-2xl px-4 py-3 transition-shadow"
        style={{
          background: 'var(--color-input-bg)',
          border: '1px solid var(--color-input-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (selected.length) setAttachments((current) => [...current, ...selected].slice(0, 5));
            event.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={streamState.isStreaming || modelLoading || attachments.length >= 5}
          className="p-2 rounded-xl shrink-0 disabled:opacity-30"
          style={{ color: 'var(--color-text-secondary)' }}
          title="Attach photos or videos"
          aria-label="Attach photos or videos"
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedModel ? 'Message OpenJarvis...' : 'Pick a model first (⌘K)...'}
          rows={1}
          className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed"
          style={{ color: 'var(--color-text)', maxHeight: '200px' }}
          disabled={streamState.isStreaming || modelLoading}
        />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {attachments.map((file, index) => (
              <span key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-[11px]" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>
                <span className="max-w-40 truncate">{file.name}</span>
                <button type="button" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`} title="Remove attachment">×</button>
              </span>
            ))}
          </div>
        )}
        {isCurrentChatStreaming ? (
          <button
            onClick={stopStreaming}
            className="p-2 rounded-xl transition-colors shrink-0 cursor-pointer"
            style={{ background: 'var(--color-error)', color: 'var(--color-on-accent)' }}
            title="Stop generating"
          >
            <Square size={16} />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <MicButton
              state={speechState}
              onClick={handleMicClick}
              onCancel={() => void cancelRecording()}
              disabled={micDisabled}
              reason={micReason}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={streamState.isStreaming || (!input.trim() && attachments.length === 0) || modelLoading || !selectedModel}
              title={selectedModel ? 'Send message' : 'Pick a model first (⌘K)'}
              className="p-2 rounded-xl transition-colors shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-default"
              style={{
                background: input.trim() ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                color: input.trim() ? 'white' : 'var(--color-text-tertiary)',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center mt-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>
          <kbd className="font-mono">Enter</kbd> to send &middot;{' '}
          <kbd className="font-mono">Shift+Enter</kbd> for new line
        </span>
      </div>
    </div>
  );
}