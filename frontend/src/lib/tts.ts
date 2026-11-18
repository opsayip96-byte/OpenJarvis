import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { toSpeakableText } from './message-text';

export type TtsState = 'idle' | 'loading' | 'speaking';

/**
 * Voice output is a single shared resource: one utterance at a time, for the
 * whole app. The state lives in one store rather than per component, because a
 * per-component hook would give every message its own audio element -- two
 * replies would then talk over each other, and autoplay would make that the
 * normal case rather than the exception.
 */
interface TtsStore {
  state: TtsState;
  /** id of the message currently loading or speaking, if any. */
  speakingId: string | null;
  error: string | null;
  /** Message whose read-aloud attempt failed, if any. */
  errorId: string | null;
  /** null until the health probe has answered. */
  available: boolean | null;
  /** Last message spoken by autoplay, so a re-render never repeats it. */
  autoSpokenId: string | null;
  speak: (id: string, text: string) => Promise<void>;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

// Playback handles are not render state -- keeping them out of the store avoids
// re-rendering every subscriber when an audio element is swapped.
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let browserUtterance: SpeechSynthesisUtterance | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;

function getBrowserSpeech(): SpeechSynthesis | null {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return null;
  return speechSynthesis;
}

/** Only a stream ending in the active conversation may trigger autoplay. */
export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

function teardown(): void {
  if (audio) {
    // Detach first: clearing src re-runs the media load algorithm, which fails
    // on an empty source and dispatches an `error` event. With the handler
    // still attached that surfaces as a bogus "Playback failed" after every
    // successful utterance.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (controller) {
    controller.abort();
    controller = null;
  }
  if (browserUtterance) {
    browserUtterance.onend = null;
    browserUtterance.onerror = null;
    getBrowserSpeech()?.cancel();
    browserUtterance = null;
  }
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  state: 'idle',
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        const available = health.available || getBrowserSpeech() !== null;
        set({ available });
        if (!available) healthProbe = null;
      })
      .catch(() => {
        const available = getBrowserSpeech() !== null;
        set({ available });
        if (!available) healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  speak: async (id: string, text: string) => {
    const trimmed = toSpeakableText(text);
    if (!trimmed) return;

    // Bump before teardown so a synthesis still in flight is both aborted and
    // fenced off by the token, even if the abort loses the race.
    token += 1;
    const mine = token;
    teardown();
    set({ state: 'loading', speakingId: id, error: null, errorId: null });

    const ac = new AbortController();
    controller = ac;

    try {
      let voiceId: string | undefined;
      let speed: number | undefined;
      try {
        voiceId = localStorage.getItem('openjarvis-tts-voice')?.trim() || undefined;
        const savedSpeed = Number(localStorage.getItem('openjarvis-tts-speed'));
        speed = Number.isFinite(savedSpeed) && savedSpeed >= 0.5 && savedSpeed <= 2 ? savedSpeed : undefined;
      } catch {
        // Browser storage may be disabled; server defaults remain usable.
      }
      let blob: Blob | null = null;
      let serverError: unknown;
      try {
        blob = await synthesizeSpeech(trimmed, { voiceId, speed, signal: ac.signal });
      } catch (err) {
        serverError = err;
      }
      if (mine !== token) return;

      if (blob) {
        const url = URL.createObjectURL(blob);
        objectUrl = url;
        const el = new Audio(url);
        try {
          const volume = Number(localStorage.getItem('openjarvis-tts-volume') || '1');
          el.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
        } catch {}
        audio = el;

        el.onended = () => {
          if (mine !== token) return;
          teardown();
          set({ state: 'idle', speakingId: null });
        };
        el.onerror = () => {
          if (mine !== token) return;
          teardown();
          set({ state: 'idle', speakingId: null, error: 'Playback failed', errorId: id });
        };

        await el.play();
        if (mine === token) set({ state: 'speaking', speakingId: id });
      } else {
        const speech = getBrowserSpeech();
        if (!speech) throw serverError ?? new Error('No text-to-speech backend available');
        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = speed ?? 1;
        try {
          const pitch = Number(localStorage.getItem('openjarvis-tts-pitch') || '0.85');
          utterance.pitch = Number.isFinite(pitch) ? Math.max(0, Math.min(2, pitch)) : 0.85;
          const volume = Number(localStorage.getItem('openjarvis-tts-volume') || '1');
          utterance.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
          const browserVoice = localStorage.getItem('openjarvis-browser-voice')?.trim();
          if (browserVoice) voiceId = browserVoice;
        } catch {
          utterance.pitch = 0.85;
        }
        if (voiceId) {
          const wanted = voiceId.toLocaleLowerCase();
          utterance.voice = speech.getVoices().find((voice) =>
            voice.name.toLocaleLowerCase() === wanted
            || voice.voiceURI.toLocaleLowerCase() === wanted
          ) ?? null;
        }
        browserUtterance = utterance;
        await new Promise<void>((resolve, reject) => {
          utterance.onend = () => {
            if (mine === token) {
              browserUtterance = null;
              set({ state: 'idle', speakingId: null });
            }
            resolve();
          };
          utterance.onerror = (event) => {
            if (mine === token) {
              browserUtterance = null;
              reject(new Error(event.error || 'Browser speech synthesis failed'));
            } else {
              resolve();
            }
          };
          speech.speak(utterance);
          set({ state: 'speaking', speakingId: id });
        });
      }
    } catch (err) {
      if (mine !== token) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      teardown();
      set({
        state: 'idle',
        speakingId: null,
        error: err instanceof Error ? err.message : 'Speech synthesis failed',
        errorId: id,
      });
    }
  },

  stop: () => {
    token += 1;
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

/** Test seam: reset module-level playback handles between cases. */
export function __resetTtsForTests(): void {
  teardown();
  token = 0;
  healthProbe = null;
  useTtsStore.setState({
    state: 'idle',
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}
