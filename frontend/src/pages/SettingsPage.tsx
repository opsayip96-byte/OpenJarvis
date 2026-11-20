import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Palette,
  Globe,
  Cpu,
  Database,
  Info,
  Check,
  Sun,
  Moon,
  Monitor,
  Download,
  Upload,
  Trash2,
  Mic,
  Key,
  Search,
  Brain,
  RefreshCw,
} from 'lucide-react';
import { useAppStore, type ThemeMode } from '../lib/store';
import { deviceTimeZone, listTimeZones, resolveTimeZone, utcOffsetLabel } from '../lib/timezone';
import {
  checkHealth,
  fetchSpeechHealth,
  fetchTtsHealth,
  getMemoryStats,
  clearIndexedMemory,
  getInferenceSource,
  setInferenceSource,
  getCloudKeyStatus,
  saveCloudKey,
  fetchToolCredentialStatus,
  saveToolCredentials,
  deleteToolCredential,
  isTauri,
  saveAndroidBackendApiKey,
  type InferenceSource,
  type MemoryStats,
} from '../lib/api';
import { isAndroidNative, JarvisNative, type AndroidVoice } from '../lib/android-native';
import { isAutoUpdateDisabled, setAutoUpdateDisabled } from '../components/Desktop/UpdateChecker';
import { apiFetch } from '../lib/api';
import { JarvisLocalModel, type LocalModelStatus } from '../lib/local-model';
import { QwenModelLibrary } from '../components/QwenModelLibrary';
import { listPendingLessons, removePendingLesson, clearPendingLessons, exportPendingLessonsJsonl, approvePendingLesson, listTeachingInstructions, removeTeachingInstruction, type JarvisLesson } from '../lib/jarvis-learning';

const CLOUD_KEY_STATUS_CHANGED = 'openjarvis-cloud-key-status-changed';

function LocalModelManager() {
  const [status, setStatus] = useState<LocalModelStatus>({ ready: false, sizeBytes: 0, path: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try { setStatus(await JarvisLocalModel.getModelStatus()); }
    catch { setStatus({ ready: false, sizeBytes: 0, path: '' }); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const choose = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await JarvisLocalModel.chooseModel();
      setStatus(result);
      setMessage(`Imported ${result.name || 'GGUF model'} and verified its GGUF header. SHA-256: ${result.sha256 || 'available'}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (!text.toLowerCase().includes('cancel')) setMessage(text);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('Remove the locally stored model file?')) return;
    setBusy(true);
    try { await JarvisLocalModel.removeModel(); await refresh(); setMessage('Local model file removed.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return (
    <Section title="JARVIS local model">
      <SettingRow label="Private GGUF model" description="Import a model into app-private storage. It stays on this phone.">
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: status.ready ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
            {status.ready ? `Stored · ${(status.sizeBytes / 1e9).toFixed(2)} GB` : 'No local model'}
          </span>
          <button type="button" disabled={busy} onClick={() => void choose()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'white' }}>
            {busy ? 'Working…' : status.ready ? 'Replace model' : 'Import GGUF'}
          </button>
          {status.ready && <button type="button" disabled={busy} onClick={() => void remove()}
            className="px-2 py-1.5 rounded-lg text-xs" style={{ color: 'var(--color-error)' }}>Remove</button>}
        </div>
      </SettingRow>
      {message && <p className="mt-2 break-all text-xs" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>}
      <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        After import, the Android app loads this model into its on-device llama.cpp text engine when you start a chat. The current runtime is CPU-only and text-only. Vision, video, documents, and model-specific chat-template detection are still being developed.
      </p>
    </Section>
  );
}

function OllamaModelList() {
  const [models, setModels] = useState<Array<{ name: string; size: number }>>([]);
  useEffect(() => {
    fetch('http://localhost:11434/api/tags')
      .then(r => r.json())
      .then(data => setModels((data.models || []).map((m: any) => ({ name: m.name, size: m.size }))))
      .catch(() => setModels([]));
  }, []);
  if (models.length === 0) return <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No models loaded</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {models.map(m => (
        <span key={m.name} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px]"
          style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
          {m.name} ({(m.size / 1e9).toFixed(1)} GB)
        </span>
      ))}
    </div>
  );
}

function ApiKeyInput({
  keyName,
  placeholder,
  toolName,
}: {
  keyName: string;
  placeholder: string;
  toolName?: string;
}) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState('');
  const desktopKeyStorage = isTauri();
  const serverToolStorage = !desktopKeyStorage && !!toolName;
  const canManage = desktopKeyStorage || serverToolStorage;

  const refresh = useCallback(async () => {
    if (!canManage) {
      setHasKey(false);
      return;
    }
    try {
      const status = desktopKeyStorage
        ? await getCloudKeyStatus()
        : await fetchToolCredentialStatus(toolName!);
      setHasKey(!!status[keyName]);
    } catch {
      setHasKey(false);
    }
  }, [canManage, desktopKeyStorage, keyName, toolName]);

  useEffect(() => {
    void refresh();
    window.addEventListener(CLOUD_KEY_STATUS_CHANGED, refresh);
    return () => window.removeEventListener(CLOUD_KEY_STATUS_CHANGED, refresh);
  }, [refresh]);

  const save = async (v: string) => {
    const next = v.trim();
    if (!next) return;
    setError('');
    try {
      if (desktopKeyStorage) {
        await saveCloudKey(keyName, next);
      } else if (toolName) {
        await saveToolCredentials(toolName, { [keyName]: next });
      } else {
        return;
      }
      setValue('');
      setHasKey(true);
      setSaved(true);
      window.dispatchEvent(new Event(CLOUD_KEY_STATUS_CHANGED));
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to save API key');
    }
  };

  const remove = async () => {
    setError('');
    try {
      if (desktopKeyStorage) {
        await saveCloudKey(keyName, '');
      } else if (toolName) {
        await deleteToolCredential(toolName, keyName);
      } else {
        return;
      }
      setValue('');
      setHasKey(false);
      setSaved(true);
      window.dispatchEvent(new Event(CLOUD_KEY_STATUS_CHANGED));
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to remove API key');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => { if (value.trim()) void save(value); }}
        placeholder={hasKey ? (desktopKeyStorage ? 'Saved in secure storage' : 'Saved by local server') : placeholder}
        disabled={!canManage}
        className="w-48 px-2 py-1 rounded text-xs"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
      {hasKey && (
        <button
          onClick={() => void remove()}
          className="px-2 py-1 rounded text-[10px] cursor-pointer"
          style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
        >
          Remove
        </button>
      )}
      {saved && <span className="text-[10px]" style={{ color: 'var(--color-success)' }}>Saved</span>}
      {error && <span className="text-[10px]" style={{ color: 'var(--color-error)' }}>{error}</span>}
    </div>
  );
}

function CloudProviderStatus({ label, keyName }: { label: string; keyName: string }) {
  const [hasKey, setHasKey] = useState(false);
  const secureKeyStorage = isTauri() || isAndroidNative();

  const refresh = useCallback(async () => {
    if (!secureKeyStorage) {
      setHasKey(false);
      return;
    }
    try {
      const status = await getCloudKeyStatus();
      setHasKey(!!status[keyName]);
    } catch {
      setHasKey(false);
    }
  }, [secureKeyStorage, keyName]);

  useEffect(() => {
    void refresh();
    window.addEventListener(CLOUD_KEY_STATUS_CHANGED, refresh);
    return () => window.removeEventListener(CLOUD_KEY_STATUS_CHANGED, refresh);
  }, [refresh]);

  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
        background: hasKey ? 'var(--color-success)' : 'var(--color-text-tertiary)',
      }} />
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      <div className="min-w-0">
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5 break-words" style={{ color: 'var(--color-text-tertiary)' }}>{description}</div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

type MemoryStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; stats: MemoryStats }
  | { kind: 'error'; message: string };

export function MemoryStatusRow({
  status,
  onRetry,
}: {
  status: MemoryStatus;
  onRetry: () => void;
}) {
  const stats = status.kind === 'ready' ? status.stats : null;
  const description = status.kind === 'error'
    ? status.message
    : status.kind === 'loading'
      ? 'Checking memory backend...'
      : stats?.backend === 'none'
        ? 'Memory is not configured'
        : `${stats?.backend} backend — ${stats?.entries} entries`;
  const label = status.kind === 'loading'
    ? 'Checking...'
    : stats?.backend === 'none'
      ? 'Not configured'
      : stats
        ? `${stats.entries} entries`
        : 'Unavailable';

  return (
    <SettingRow label="Indexed document memory" description={`${description}. Saved personal facts are listed separately below.`}>
      <div className="flex items-center gap-2">
        <Brain size={14} style={{ color: stats && stats.backend !== 'none' ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }} />
        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
          {label}
        </span>
        {status.kind === 'error' && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs underline cursor-pointer whitespace-nowrap"
            style={{ color: 'var(--color-accent)' }}
          >
            Retry
          </button>
        )}
      </div>
    </SettingRow>
  );
}

type PersonalMemory = { index: number; text: string; source: string; trust: string };

function PersonalMemoryManager() {
  const [memories, setMemories] = useState<PersonalMemory[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/v1/memories');
      if (!response.ok) throw new Error(`Could not load saved memories (HTTP ${response.status}).`);
      const body = await response.json();
      setMemories(Array.isArray(body.memories) ? body.memories : []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (index?: number) => {
    const text = draft.trim();
    if (!text) return;
    try {
      const response = index === undefined
        ? await apiFetch('/v1/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
        : await apiFetch(`/v1/memories/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `Could not save memory (HTTP ${response.status}).`);
      }
      setDraft('');
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (index: number) => {
    if (!window.confirm('Delete this saved memory?')) return;
    try {
      const response = await apiFetch(`/v1/memories/${index}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Could not delete memory (HTTP ${response.status}).`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportMemories = async () => {
    try {
      const response = await apiFetch('/v1/memories/export');
      if (!response.ok) throw new Error(`Could not export memories (HTTP ${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'jarvis-memories.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>Saved personal memories</div>
        <button type="button" onClick={() => void exportMemories()} className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-accent)' }}>
          <Download size={12} /> Export
        </button>
      </div>
      <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
        Facts you add here are saved locally and may be used as context in future chats.
      </p>
      {loading && <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</p>}
      {memories.map((memory) => (
        <div key={`${memory.index}-${memory.text}`} className="flex items-start gap-2 py-2">
          {editing === memory.index ? (
            <>
              <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} className="flex-1 min-w-0 px-2 py-1 rounded text-xs" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
              <button type="button" onClick={() => void save(memory.index)} className="text-xs cursor-pointer" style={{ color: 'var(--color-accent)' }}>Save</button>
              <button type="button" onClick={() => { setEditing(null); setDraft(''); }} className="text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
            </>
          ) : (
            <>
              <span className="flex-1 min-w-0 text-xs break-words" style={{ color: 'var(--color-text-secondary)' }}>{memory.text}</span>
              <button type="button" onClick={() => { setEditing(memory.index); setDraft(memory.text); }} className="text-xs cursor-pointer" style={{ color: 'var(--color-accent)' }}>Edit</button>
              <button type="button" onClick={() => void remove(memory.index)} className="text-xs cursor-pointer" style={{ color: 'var(--color-error)' }}>Delete</button>
            </>
          )}
        </div>
      ))}
      {!loading && memories.length === 0 && <p className="text-xs py-1" style={{ color: 'var(--color-text-tertiary)' }}>No saved personal memories yet.</p>}
      <div className="flex gap-2 mt-2">
        <input value={editing === null ? draft : ''} onChange={(event) => setDraft(event.target.value)} placeholder="Add a fact or preference to remember" className="flex-1 min-w-0 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
        <button type="button" onClick={() => void save()} disabled={!draft.trim()} className="px-3 py-1.5 rounded text-xs cursor-pointer disabled:opacity-40" style={{ background: 'var(--color-accent)', color: 'white' }}>Remember</button>
      </div>
      {error && <p role="alert" className="text-xs mt-2" style={{ color: 'var(--color-error)' }}>{error}</p>}
    </div>
  );
}


function JarvisLearningQueue() {
  const [lessons, setLessons] = useState<JarvisLesson[]>([]);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    const rows = listPendingLessons();
    setLessons(rows);
    setInstructions(listTeachingInstructions());
    setAnswers((current) => {
      const next = { ...current };
      for (const lesson of rows) if (!(lesson.id in next)) next[lesson.id] = lesson.targetResponse || lesson.suggestedResponse;
      return next;
    });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const approvedCount = lessons.filter((lesson) => lesson.status === 'approved' && lesson.targetResponse.trim()).length;
  const exportLessons = () => {
    const content = exportPendingLessonsJsonl();
    if (!content) { setError('Approve at least one corrected example before exporting.'); return; }
    const url = URL.createObjectURL(new Blob([content], { type: 'application/x-ndjson' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'jarvis-approved-training.jsonl';
    anchor.click();
    URL.revokeObjectURL(url);
    setError('');
  };

  return (
    <Section title="JARVIS learning lab">
      <SettingRow label="Immediate memory learning" description="Instructions you teach are saved privately on this device and added to local JARVIS context in future chats.">
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{instructions.length} instructions</span>
      </SettingRow>
      {instructions.slice().reverse().map((instruction) => {
        const originalIndex = instructions.indexOf(instruction);
        return (
          <div key={originalIndex} className="flex items-start gap-2 py-2">
            <p className="flex-1 min-w-0 text-xs whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-secondary)' }}>{instruction}</p>
            <button type="button" onClick={() => { removeTeachingInstruction(originalIndex); refresh(); }} className="text-xs" style={{ color: 'var(--color-error)' }}>Forget</button>
          </div>
        );
      })}
      <SettingRow label="Supervised training examples" description="JARVIS responses are suggestions only. Edit the target answer to the correct response, then approve it. Only approved examples enter the export.">
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{approvedCount}/{lessons.length} approved</span>
          <button type="button" disabled={!approvedCount} onClick={exportLessons}
            className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: 'white' }}>Export approved</button>
          <button type="button" disabled={!lessons.length} onClick={() => {
            if (window.confirm('Delete all pending and approved JARVIS training examples from this device?')) {
              clearPendingLessons(); refresh();
            }
          }} className="px-2 py-1.5 rounded-lg text-xs disabled:opacity-40"
            style={{ color: 'var(--color-error)' }}>Clear</button>
        </div>
      </SettingRow>
      {lessons.slice().reverse().map((lesson) => (
        <div key={lesson.id} className="mt-3 rounded-lg p-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Teaching prompt</div>
          <p className="text-xs whitespace-pre-wrap break-words">{lesson.prompt}</p>
          <div className="text-xs font-medium mt-2 mb-1" style={{ color: 'var(--color-text-secondary)' }}>JARVIS suggestion, not trusted training data</div>
          <p className="text-xs whitespace-pre-wrap break-words">{lesson.suggestedResponse}</p>
          <label className="block text-xs font-medium mt-3 mb-1" style={{ color: 'var(--color-text-secondary)' }}>Correct target answer</label>
          <textarea value={answers[lesson.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [lesson.id]: event.target.value }))}
            rows={4} className="w-full px-2 py-2 rounded text-xs resize-y"
            style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            placeholder="Write or correct the answer JARVIS should learn..." />
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-xs" style={{ color: lesson.status === 'approved' ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
              {lesson.status === 'approved' ? 'Approved for dataset' : 'Awaiting your approval'}
            </span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => {
                try { approvePendingLesson(lesson.id, answers[lesson.id] || ''); refresh(); setError(''); }
                catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              }} className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>Approve answer</button>
              <button type="button" onClick={() => { removePendingLesson(lesson.id); refresh(); }} className="text-xs" style={{ color: 'var(--color-error)' }}>Remove</button>
            </div>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
      <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        Memory learning takes effect on the next local chat. Weight training is a separate LoRA process on suitable training hardware. Exported data stays on this device until you choose to export it. Never teach JARVIS passwords or sensitive personal data.
      </p>
    </Section>
  );
}

const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const timeZones = useMemo(listTimeZones, []);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const conversations = useAppStore((s) => s.conversations);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [speechBackendAvailable, setSpeechBackendAvailable] = useState<boolean | null>(null);
  const [speechLanguage, setSpeechLanguage] = useState(() => {
    try { return localStorage.getItem('openjarvis-speech-language') || ''; } catch { return ''; }
  });
  const [ttsBackend, setTtsBackend] = useState<{ available: boolean; backend?: string; voice_id?: string } | null>(null);
  const [ttsVoice, setTtsVoice] = useState(() => {
    try { return localStorage.getItem('openjarvis-tts-voice') || ''; } catch { return ''; }
  });
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [browserVoice, setBrowserVoice] = useState(() => {
    try { return localStorage.getItem('openjarvis-browser-voice') || ''; } catch { return ''; }
  });
  const [ttsPitch, setTtsPitch] = useState(() => {
    try {
      const value = Number(localStorage.getItem('openjarvis-tts-pitch') || '0.85');
      return Number.isFinite(value) && value >= 0 && value <= 2 ? value : 0.85;
    } catch { return 0.85; }
  });
  const [ttsVolume, setTtsVolume] = useState(() => {
    try {
      const value = Number(localStorage.getItem('openjarvis-tts-volume') || '1');
      return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
    } catch { return 1; }
  });
  const [ttsSpeed, setTtsSpeed] = useState(() => {
    try {
      const value = Number(localStorage.getItem('openjarvis-tts-speed') || '1');
      return Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : 1;
    } catch { return 1; }
  });
  const [saved, setSaved] = useState(false);

  const androidApp = isAndroidNative();
  const [androidApiKeyDraft, setAndroidApiKeyDraft] = useState('');
  const [androidApiKeySaved, setAndroidApiKeySaved] = useState(false);
  const [androidApiKeyError, setAndroidApiKeyError] = useState('');
  const [androidVoices, setAndroidVoices] = useState<AndroidVoice[]>([]);
  const [androidVoiceError, setAndroidVoiceError] = useState('');
  const [ttsLanguage, setTtsLanguage] = useState(() => {
    try { return localStorage.getItem('openjarvis-tts-language') || 'en-GB'; } catch { return 'en-GB'; }
  });


  useEffect(() => {
    if (!androidApp) return;
    JarvisNative.getSecureStatus()
      .then((status) => setAndroidApiKeySaved(!!status.OPENJARVIS_API_KEY))
      .catch(() => setAndroidApiKeyError('Android secure storage is unavailable.'));
    JarvisNative.getSpeechVoices()
      .then(({ voices }) => {
        setAndroidVoices(voices);
        setAndroidVoiceError(voices.length ? '' : 'No offline Android voices are installed. Add a voice in Android Text-to-speech settings.');
      })
      .catch((error) => setAndroidVoiceError(error instanceof Error ? error.message : 'Android speech engine unavailable.'));
  }, [androidApp]);

  const saveAndroidApiKey = useCallback(async () => {
    setAndroidApiKeyError('');
    try {
      await saveAndroidBackendApiKey(androidApiKeyDraft);
      setAndroidApiKeyDraft('');
      setAndroidApiKeySaved(!!androidApiKeyDraft.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      if (androidApp) {
        JarvisNative.getSecureStatus().then((status) => setAndroidApiKeySaved(!!status.OPENJARVIS_API_KEY)).catch(() => {});
      }
      setAndroidApiKeyError(error instanceof Error ? error.message : 'Could not save API key.');
    }
  }, [androidApiKeyDraft, androidApp]);


  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const speech = window.speechSynthesis;
    const refresh = () => setBrowserVoices(speech.getVoices());
    refresh();
    speech.addEventListener?.('voiceschanged', refresh);
    return () => speech.removeEventListener?.('voiceschanged', refresh);
  }, []);

  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(() => !isAutoUpdateDisabled());
  const [updateCheckState, setUpdateCheckState] = useState<'idle' | 'checking' | 'available' | 'latest'>('idle');

  const handleAutoUpdateToggle = useCallback((enabled: boolean) => {
    setAutoUpdateEnabled(enabled);
    setAutoUpdateDisabled(!enabled);
  }, []);

  const handleCheckNow = useCallback(async () => {
    if (!(window as any).__TAURI_INTERNALS__) return;
    setUpdateCheckState('checking');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      setUpdateCheckState(update ? 'available' : 'latest');
      setTimeout(() => setUpdateCheckState('idle'), 4000);
    } catch {
      setUpdateCheckState('idle');
    }
  }, []);

  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus>({ kind: 'loading' });
  const [memoryClearMessage, setMemoryClearMessage] = useState('');
  const memoryRequestId = useRef(0);
  const [memoryEnabled, setMemoryEnabled] = useState(() => {
    try { return localStorage.getItem('openjarvis-memory-enabled') !== 'false'; } catch { return true; }
  });
  const [memoryBackend, setMemoryBackend] = useState(() => {
    try { return localStorage.getItem('openjarvis-memory-backend') || 'sqlite'; } catch { return 'sqlite'; }
  });
  const [memoryTopK, setMemoryTopK] = useState(() => {
    try { return parseInt(localStorage.getItem('openjarvis-memory-top-k') || '5'); } catch { return 5; }
  });
  const [memoryMinScore, setMemoryMinScore] = useState(() => {
    try { return parseFloat(localStorage.getItem('openjarvis-memory-min-score') || '0.1'); } catch { return 0.1; }
  });
  const [memoryMaxTokens, setMemoryMaxTokens] = useState(() => {
    try { return parseInt(localStorage.getItem('openjarvis-memory-max-tokens') || '2048'); } catch { return 2048; }
  });

  const [srcKind, setSrcKind] = useState<InferenceSource['kind']>('ollama');
  const [customHost, setCustomHost] = useState('http://localhost:1234/v1');
  const [customModel, setCustomModel] = useState('');
  const [customEngine, setCustomEngine] = useState('lmstudio');
  const [customKey, setCustomKey] = useState('');
  const [srcMsg, setSrcMsg] = useState('');

  useEffect(() => {
    getInferenceSource().then((s) => {
      setSrcKind(s.kind);
      if (s.host) setCustomHost(s.host);
      if (s.model) setCustomModel(s.model);
      if (s.engine) setCustomEngine(s.engine);
    }).catch(() => {});
  }, []);

  const saveSource = useCallback(async () => {
    try {
      if (srcKind === 'custom') {
        await setInferenceSource({ kind: 'custom', host: customHost, model: customModel, engine: customEngine, apiKey: customKey || undefined });
      } else {
        await setInferenceSource({ kind: 'ollama' });
      }
      setSrcMsg('Saved — restart the app to apply.');
    } catch (e: any) {
      setSrcMsg(e?.message ?? 'Failed to save.');
    }
  }, [srcKind, customHost, customModel, customEngine, customKey]);

  const refreshMemoryStatus = useCallback(async () => {
    const requestId = ++memoryRequestId.current;
    setMemoryStatus({ kind: 'loading' });
    try {
      const stats = await getMemoryStats();
      if (requestId === memoryRequestId.current) {
        setMemoryStatus({ kind: 'ready', stats });
      }
    } catch (error) {
      if (requestId === memoryRequestId.current) {
        setMemoryStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, []);

  const handleClearIndexedMemory = useCallback(async () => {
    if (!window.confirm('Clear all indexed memory? This cannot be undone.')) return;
    setMemoryClearMessage('Clearing indexed memory…');
    try {
      const removed = await clearIndexedMemory();
      setMemoryClearMessage(`Cleared ${removed} indexed entr${removed === 1 ? 'y' : 'ies'}.`);
      await refreshMemoryStatus();
    } catch (error) {
      setMemoryClearMessage(error instanceof Error ? error.message : 'Could not clear memory.');
    }
  }, [refreshMemoryStatus]);

  useEffect(() => {
    void refreshMemoryStatus();
    const onFocus = () => { void refreshMemoryStatus(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      ++memoryRequestId.current;
    };
  }, [refreshMemoryStatus, settings.apiUrl]);

  useEffect(() => {
    checkHealth().then(setHealthy);
    fetchSpeechHealth()
      .then((h) => setSpeechBackendAvailable(h.available))
      .catch(() => setSpeechBackendAvailable(false));
    fetchTtsHealth()
      .then((h) => setTtsBackend(h))
      .catch(() => setTtsBackend({ available: false }));
  }, []);

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleExport = () => {
    const data = localStorage.getItem('openjarvis-conversations') || '{}';
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openjarvis-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (data.version === 1) {
            localStorage.setItem('openjarvis-conversations', JSON.stringify(data));
            useAppStore.getState().loadConversations();
            showSaved();
          }
        } catch {}
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const [confirmClear, setConfirmClear] = useState(false);
  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    localStorage.removeItem('openjarvis-conversations');
    useAppStore.getState().loadConversations();
    setConfirmClear(false);
    showSaved();
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              Settings
            </h1>
            {saved && (
              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-success)',
              }}>
                <Check size={12} /> Saved
              </span>
            )}
          </div>
          <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--color-text-secondary)' }}>
            App preferences — appearance, model defaults, keyboard shortcuts, and data management.
          </p>
        </header>

        <div className="flex flex-col gap-4">
          {/* Appearance */}
          <Section title="Appearance">
            <SettingRow label="Theme" description="Choose how OpenJarvis looks">
              <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
                {themeOptions.map((opt) => {
                  const isActive = settings.theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { updateSettings({ theme: opt.value }); showSaved(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
                      style={{
                        background: isActive ? 'var(--color-surface)' : 'transparent',
                        color: isActive ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                        boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                      }}
                    >
                      <opt.icon size={14} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </SettingRow>
            <SettingRow label="Font size">
              <select
                value={settings.fontSize}
                onChange={(e) => { updateSettings({ fontSize: e.target.value as any }); showSaved(); }}
                className="text-sm px-3 py-1.5 rounded-lg outline-none cursor-pointer"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <option value="small">Small</option>
                <option value="default">Default</option>
                <option value="large">Large</option>
              </select>
            </SettingRow>
            <SettingRow
              label="Time zone"
              description={`Dates and times in answers use this zone. Now: ${resolveTimeZone(settings.timeZone)} (${utcOffsetLabel(resolveTimeZone(settings.timeZone))})`}
            >
              <select
                aria-label="Time zone"
                value={settings.timeZone}
                onChange={(e) => { updateSettings({ timeZone: e.target.value }); showSaved(); }}
                className="text-sm px-3 py-1.5 rounded-lg outline-none cursor-pointer max-w-[14rem]"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <option value="">Automatic ({deviceTimeZone()})</option>
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </SettingRow>
          </Section>

          {/* Connection */}
          <Section title="Connection">
            <SettingRow label="Server status" description={serverInfo ? `${serverInfo.engine} / ${serverInfo.model}` : 'Not connected'}>
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: healthy === true ? 'var(--color-success)' : healthy === false ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {healthy === true ? 'Connected' : healthy === false ? 'Disconnected' : 'Checking...'}
                </span>
              </div>
            </SettingRow>
            <SettingRow label="API URL" description={androidApp ? 'Use the public HTTPS URL of your JARVIS backend.' : 'Set if backend runs on a different port or host'}>
              <input
                type="text"
                value={settings.apiUrl}
                onChange={(e) => { updateSettings({ apiUrl: e.target.value }); showSaved(); }}
                placeholder={androidApp ? 'https://your-jarvis-server.example' : 'http://localhost:8000'}
                className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              />
            </SettingRow>
            <SettingRow
              label="API key"
              description={androidApp ? 'Stored encrypted with Android Keystore. Sent only to your HTTPS backend.' : 'Required only if the server was started with an API key'}
            >
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={androidApp ? androidApiKeyDraft : settings.apiKey}
                    onChange={(e) => androidApp
                      ? setAndroidApiKeyDraft(e.target.value)
                      : (updateSettings({ apiKey: e.target.value }), showSaved())}
                    placeholder={androidApp && androidApiKeySaved ? 'Saved securely' : 'OPENJARVIS_API_KEY'}
                    autoComplete="off"
                    className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  />
                  {androidApp && (
                    <button type="button" onClick={() => void saveAndroidApiKey()} className="px-3 py-1.5 rounded-lg text-xs cursor-pointer" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
                      {androidApiKeyDraft.trim() ? 'Save' : 'Remove'}
                    </button>
                  )}
                </div>
                {androidApiKeySaved && <span className="text-[10px]" style={{ color: 'var(--color-success)' }}>Credential saved in Android secure storage</span>}
                {androidApiKeyError && <span className="text-[10px]" style={{ color: 'var(--color-error)' }}>{androidApiKeyError}</span>}
              </div>
            </SettingRow>
          </Section>

          {/* Inference source */}
          <Section title="Inference source">
            <SettingRow label="Source" description="Where the app runs models. Applies after restart.">
              <select
                value={srcKind}
                onChange={(e) => { setSrcKind(e.target.value as InferenceSource['kind']); setSrcMsg(''); }}
                className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                <option value="ollama">Bundled Ollama (default)</option>
                <option value="custom">Custom OpenAI-compatible server</option>
              </select>
            </SettingRow>
            {srcKind === 'custom' && (
              <>
                <SettingRow label="Server URL" description="e.g. LM Studio: http://localhost:1234/v1">
                  <input type="text" value={customHost} onChange={(e) => { setCustomHost(e.target.value); setSrcMsg(''); }} placeholder="http://localhost:1234/v1"
                    className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                </SettingRow>
                <SettingRow label="Model" description="Model id served by your endpoint">
                  <input type="text" value={customModel} onChange={(e) => { setCustomModel(e.target.value); setSrcMsg(''); }} placeholder="qwen2.5-7b-instruct"
                    className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                </SettingRow>
                <SettingRow label="Server type" description="OpenAI-compatible engine">
                  <select value={customEngine} onChange={(e) => { setCustomEngine(e.target.value); setSrcMsg(''); }}
                    className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                    <option value="lmstudio">LM Studio</option>
                    <option value="vllm">vLLM</option>
                    <option value="sglang">SGLang</option>
                    <option value="llamacpp">llama.cpp</option>
                    <option value="mlx">MLX</option>
                  </select>
                </SettingRow>
                <SettingRow label="API key (optional)" description="Only if your server requires one">
                  <input type="password" value={customKey} onChange={(e) => { setCustomKey(e.target.value); setSrcMsg(''); }} placeholder="leave blank if none"
                    className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                </SettingRow>
              </>
            )}
            <SettingRow label="" description={srcMsg}>
              <button onClick={saveSource}
                className="text-sm px-3 py-1.5 rounded-lg outline-none cursor-pointer"
                style={{ background: 'var(--color-accent, var(--color-bg-tertiary))', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                Save inference source
              </button>
            </SettingRow>
          </Section>

          {/* Models */}
          {androidApp && <LocalModelManager />}
          {androidApp && <QwenModelLibrary />}\n          {androidApp && <JarvisLearningQueue />}

          <Section title="Models">
            <SettingRow label="Local models (Ollama)" description="Models available for local inference">
              <OllamaModelList />
            </SettingRow>
            <div className="text-xs mt-2 px-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Run <code className="px-1 py-0.5 rounded text-[11px]" style={{ background: 'var(--color-bg-tertiary)' }}>ollama pull &lt;model-name&gt;</code> in your terminal to add more models
            </div>
            <SettingRow label="Cloud providers" description="Green dot means API key is configured">
              <div className="flex flex-wrap gap-3">
                <CloudProviderStatus label="OpenAI" keyName="OPENAI_API_KEY" />
                <CloudProviderStatus label="Anthropic" keyName="ANTHROPIC_API_KEY" />
                <CloudProviderStatus label="Google" keyName="GEMINI_API_KEY" />
                <CloudProviderStatus label="OpenRouter" keyName="OPENROUTER_API_KEY" />
                <CloudProviderStatus label="Atlas Cloud" keyName="ATLASCLOUD_API_KEY" />
              </div>
            </SettingRow>
          </Section>

          {/* API Keys */}
          <Section title="API Keys">
            <SettingRow label="OpenAI" description="GPT-4, GPT-3.5, etc.">
              <ApiKeyInput keyName="OPENAI_API_KEY" placeholder="sk-..." />
            </SettingRow>
            <SettingRow label="Anthropic" description="Claude models">
              <ApiKeyInput keyName="ANTHROPIC_API_KEY" placeholder="sk-ant-..." />
            </SettingRow>
            <SettingRow label="Google" description="Gemini models">
              <ApiKeyInput keyName="GEMINI_API_KEY" placeholder="AI..." />
            </SettingRow>
            <SettingRow label="OpenRouter" description="Multi-provider routing">
              <ApiKeyInput keyName="OPENROUTER_API_KEY" placeholder="sk-or-..." />
            </SettingRow>
            <SettingRow label="Atlas Cloud" description="Models routed through Atlas Cloud">
              <ApiKeyInput keyName="ATLASCLOUD_API_KEY" placeholder="Atlas Cloud API key" />
            </SettingRow>
          </Section>

          {/* Tools */}
          <Section title="Tools">
            <SettingRow label="Web Search" description="Tavily key for web search tool">
              <ApiKeyInput keyName="TAVILY_API_KEY" placeholder="tvly-..." toolName="web_search" />
            </SettingRow>
          </Section>

          {/* Memory */}
          <Section title="Memory">
            <MemoryStatusRow status={memoryStatus} onRetry={() => { void refreshMemoryStatus(); }} />
            <PersonalMemoryManager />
            <SettingRow label="Use memory context" description="Automatically inject relevant memories into conversations">
              <button
                onClick={() => {
                  const next = !memoryEnabled;
                  setMemoryEnabled(next);
                  try { localStorage.setItem('openjarvis-memory-enabled', String(next)); } catch {}
                  showSaved();
                }}
                className="relative w-11 h-6 rounded-full transition-colors cursor-pointer"
                style={{
                  background: memoryEnabled ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform bg-white"
                  style={{
                    transform: memoryEnabled ? 'translateX(20px)' : 'translateX(0)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </SettingRow>
            <SettingRow label="Delete indexed memory" description="Remove indexed documents and memories; this does not delete chat history">
              <button
                onClick={() => void handleClearIndexedMemory()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'transparent' }}
              >
                <Trash2 size={12} /> Clear
              </button>
            </SettingRow>
            {memoryClearMessage && (
              <p role="status" className="text-xs -mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                {memoryClearMessage}
              </p>
            )}
            <SettingRow label="Memory backend" description="Which retrieval engine to use">
              <select
                value={memoryBackend}
                onChange={(e) => {
                  setMemoryBackend(e.target.value);
                  try { localStorage.setItem('openjarvis-memory-backend', e.target.value); } catch {}
                  showSaved();
                }}
                className="text-sm px-3 py-1.5 rounded-lg outline-none cursor-pointer"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <option value="sqlite">sqlite</option>
                <option value="faiss">faiss</option>
                <option value="bm25">bm25</option>
                <option value="colbert">colbert</option>
                <option value="hybrid">hybrid</option>
              </select>
            </SettingRow>
            <SettingRow label="Results to inject" description={`${memoryTopK}`}>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                value={memoryTopK}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setMemoryTopK(v);
                  try { localStorage.setItem('openjarvis-memory-top-k', String(v)); } catch {}
                  showSaved();
                }}
                className="w-32 cursor-pointer accent-[var(--color-accent)]"
              />
            </SettingRow>
            <SettingRow label="Min relevance score" description={`${memoryMinScore}`}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={memoryMinScore}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setMemoryMinScore(v);
                  try { localStorage.setItem('openjarvis-memory-min-score', String(v)); } catch {}
                  showSaved();
                }}
                className="w-32 cursor-pointer accent-[var(--color-accent)]"
              />
            </SettingRow>
            <SettingRow label="Max context tokens" description={`${memoryMaxTokens}`}>
              <input
                type="range"
                min="256"
                max="8192"
                step="256"
                value={memoryMaxTokens}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setMemoryMaxTokens(v);
                  try { localStorage.setItem('openjarvis-memory-max-tokens', String(v)); } catch {}
                  showSaved();
                }}
                className="w-32 cursor-pointer accent-[var(--color-accent)]"
              />
            </SettingRow>
          </Section>

          {/* Model defaults */}
          <Section title="Model Defaults">
            <SettingRow label="Temperature" description={`${settings.temperature}`}>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={settings.temperature}
                onChange={(e) => { updateSettings({ temperature: parseFloat(e.target.value) }); showSaved(); }}
                className="w-32 cursor-pointer accent-[var(--color-accent)]"
              />
            </SettingRow>
            <SettingRow label="Max tokens" description={`${settings.maxTokens}`}>
              <input
                type="range"
                min="256"
                max="32768"
                step="256"
                value={settings.maxTokens}
                onChange={(e) => { updateSettings({ maxTokens: parseInt(e.target.value) }); showSaved(); }}
                className="w-32 cursor-pointer accent-[var(--color-accent)]"
              />
            </SettingRow>
          </Section>

          {/* Speech */}
          <Section title={androidApp ? 'Speech & Voice Studio' : 'Speech'}>
            <SettingRow label="Speech-to-Text" description="Enable microphone input for voice dictation">
              <button
                onClick={() => { updateSettings({ speechEnabled: !settings.speechEnabled }); showSaved(); }}
                className="relative w-11 h-6 rounded-full transition-colors cursor-pointer"
                style={{
                  background: settings.speechEnabled ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform bg-white"
                  style={{
                    transform: settings.speechEnabled ? 'translateX(20px)' : 'translateX(0)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </SettingRow>
            <SettingRow label="Text-to-Speech" description="Show a read-aloud button on assistant replies">
              <button
                onClick={() => { updateSettings({ voiceOutputEnabled: !settings.voiceOutputEnabled }); showSaved(); }}
                className="relative w-11 h-6 rounded-full transition-colors cursor-pointer"
                style={{
                  background: settings.voiceOutputEnabled ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform bg-white"
                  style={{
                    transform: settings.voiceOutputEnabled ? 'translateX(20px)' : 'translateX(0)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </SettingRow>
            <SettingRow label="Speak replies automatically" description="Read every assistant reply aloud as soon as it finishes">
              <button
                onClick={() => { updateSettings({ voiceAutoplay: !settings.voiceAutoplay }); showSaved(); }}
                disabled={!settings.voiceOutputEnabled}
                className="relative w-11 h-6 rounded-full transition-colors cursor-pointer"
                style={{
                  background: settings.voiceAutoplay && settings.voiceOutputEnabled ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                  opacity: settings.voiceOutputEnabled ? 1 : 0.4,
                  cursor: settings.voiceOutputEnabled ? 'pointer' : 'default',
                }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform bg-white"
                  style={{
                    transform: settings.voiceAutoplay && settings.voiceOutputEnabled ? 'translateX(20px)' : 'translateX(0)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </SettingRow>
            <SettingRow label="Voice" description="Backend voice ID override; leave blank to use its default">
              <div className="flex flex-col items-end gap-2">
                <span
                  className="flex items-center gap-2 text-xs"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: ttsBackend?.available ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                  }}
                  />
                  {ttsBackend === null ? 'Checking...'
                    : ttsBackend.available ? `${ttsBackend.backend}${ttsBackend.voice_id ? ` / ${ttsBackend.voice_id}` : ''}`
                    : typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
                      ? 'Browser voice available'
                      : 'Not configured'}
                </span>
                <input
                  aria-label="Text-to-speech voice ID"
                  value={ttsVoice}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTtsVoice(value);
                    try { localStorage.setItem('openjarvis-tts-voice', value); } catch {}
                  }}
                  placeholder={ttsBackend?.voice_id || 'Backend default'}
                  className="text-sm px-3 py-1.5 rounded-lg outline-none w-56"
                  style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                />
              </div>
            </SettingRow>
            <SettingRow
              label={androidApp ? 'Android system voice' : 'Device voice'}
              description={androidApp ? 'Native Android Text-to-speech voices installed on this phone.' : 'Available voices depend on voices installed on this device'}
            >
              <div className="flex items-center gap-2">
                <select
                  aria-label={androidApp ? 'Android text-to-speech voice' : 'Device text-to-speech voice'}
                  value={browserVoice}
                  onChange={(event) => {
                    const value = event.target.value;
                    setBrowserVoice(value);
                    try { localStorage.setItem('openjarvis-browser-voice', value); } catch {}
                  }}
                  className="max-w-56 text-xs px-2 py-1.5 rounded-lg"
                  style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  disabled={androidApp ? androidVoices.length === 0 : browserVoices.length === 0}
                >
                  <option value="">System default</option>
                  {androidApp
                    ? androidVoices.map((voice) => <option key={voice.name} value={voice.name}>{voice.name} ({voice.language})</option>)
                    : browserVoices.map((voice) => <option key={voice.voiceURI} value={voice.name}>{voice.name} ({voice.lang})</option>)}
                </select>
                <button
                  type="button"
                  disabled={androidApp ? androidVoices.length === 0 : browserVoices.length === 0}
                  onClick={() => {
                    if (androidApp) {
                      const voice = androidVoices.find((item) => item.name === browserVoice);
                      void JarvisNative.speak({
                        text: 'Hello sir. How can I help you?', language: voice?.language || ttsLanguage,
                        voiceName: browserVoice || undefined, rate: ttsSpeed, pitch: ttsPitch, volume: ttsVolume,
                      }).catch((error) => setAndroidVoiceError(error instanceof Error ? error.message : 'Voice preview failed.'));
                      return;
                    }
                    if (!window.speechSynthesis) return;
                    window.speechSynthesis.cancel();
                    const sample = new SpeechSynthesisUtterance('Hello sir. How can I help you?');
                    sample.rate = ttsSpeed;
                    sample.pitch = ttsPitch;
                    sample.volume = ttsVolume;
                    sample.voice = browserVoices.find((voice) => voice.name === browserVoice) ?? null;
                    window.speechSynthesis.speak(sample);
                  }}
                  className="text-xs cursor-pointer disabled:opacity-40"
                  style={{ color: 'var(--color-accent)' }}
                >Preview</button>
                <button
                  type="button"
                  onClick={() => {
                    setBrowserVoice('');
                    setTtsVoice('');
                    setTtsPitch(0.85);
                    setTtsSpeed(1);
                    setTtsVolume(1);
                    setTtsLanguage('en-GB');
                    try {
                      localStorage.removeItem('openjarvis-browser-voice');
                      localStorage.removeItem('openjarvis-tts-voice');
                      localStorage.setItem('openjarvis-tts-pitch', '0.85');
                      localStorage.setItem('openjarvis-tts-speed', '1');
                      localStorage.setItem('openjarvis-tts-volume', '1');
                      localStorage.setItem('openjarvis-tts-language', 'en-GB');
                    } catch {}
                  }}
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--color-text-secondary)' }}
                >Restore default</button>
              </div>
            </SettingRow>
            {androidApp && androidVoiceError && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{androidVoiceError}</p>}
            <SettingRow label="Voice language" description="Choose a language when the installed engine provides it">
              <select
                aria-label="Voice language"
                value={ttsLanguage}
                onChange={(event) => {
                  setTtsLanguage(event.target.value);
                  try { localStorage.setItem('openjarvis-tts-language', event.target.value); } catch {}
                }}
                className="text-xs px-2 py-1.5 rounded-lg"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                <option value="en-GB">British English</option>
                <option value="en-US">American English</option>
                <option value="en-IN">Indian English</option>
              </select>
            </SettingRow>
            <SettingRow label={androidApp ? 'Native voice pitch' : 'Browser voice pitch'} description={`${ttsPitch.toFixed(2)} · lower values sound deeper`}>
              <input
                aria-label="Voice pitch"
                type="range" min={androidApp ? '0.5' : '0'} max="2" step="0.05" value={ttsPitch}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setTtsPitch(value);
                  try { localStorage.setItem('openjarvis-tts-pitch', String(value)); } catch {}
                }}
                className="w-40 accent-cyan-400"
              />
            </SettingRow>
            <SettingRow label="Speaking speed" description={`${ttsSpeed.toFixed(1)}×`}>
              <input
                aria-label="Speaking speed"
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={ttsSpeed}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setTtsSpeed(value);
                  try { localStorage.setItem('openjarvis-tts-speed', String(value)); } catch {}
                }}
                className="w-40 accent-cyan-400"
              />
            </SettingRow>
            <SettingRow label="Voice volume" description={`${Math.round(ttsVolume * 100)}%`}>
              <input
                aria-label="Voice volume" type="range" min="0" max="1" step="0.05" value={ttsVolume}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setTtsVolume(value);
                  try { localStorage.setItem('openjarvis-tts-volume', String(value)); } catch {}
                }}
                className="w-40 accent-cyan-400"
              />
            </SettingRow>
            <SettingRow label="Recognition language" description="Used by browser speech recognition; automatic uses this device's language">
              <select
                aria-label="Speech recognition language"
                value={speechLanguage}
                onChange={(event) => {
                  const value = event.target.value;
                  setSpeechLanguage(value);
                  try { localStorage.setItem('openjarvis-speech-language', value); } catch {}
                }}
                className="text-xs px-2 py-1.5 rounded-lg"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                <option value="">Automatic</option>
                <option value="en-GB">English (United Kingdom)</option>
                <option value="en-US">English (United States)</option>
                <option value="en-IN">English (India)</option>
                <option value="fr-FR">Français</option>
                <option value="de-DE">Deutsch</option>
                <option value="es-ES">Español</option>
                <option value="hi-IN">हिन्दी</option>
                <option value="ja-JP">日本語</option>
              </select>
            </SettingRow>
            <SettingRow label="Server transcription" description="Fallback when browser speech recognition is unavailable">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: speechBackendAvailable === true ? 'var(--color-success)'
                      : speechBackendAvailable === false ? 'var(--color-text-tertiary)'
                      : 'var(--color-text-tertiary)',
                  }}
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {speechBackendAvailable === null ? 'Checking...'
                    : speechBackendAvailable ? 'Available'
                    : 'Not configured'}
                </span>
              </div>
            </SettingRow>
            {!speechBackendAvailable && speechBackendAvailable !== null && (
              <div className="text-xs mt-2 px-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Browser recognition is used when available. Set up a server speech backend for the fallback.
                See the <a href="https://open-jarvis.github.io/OpenJarvis/user-guide/tools/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>documentation</a> for details.
              </div>
            )}
          </Section>

          {/* Data */}
          <Section title="Data">
            <SettingRow label="Conversations" description={`${conversations.length} stored locally`}>
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
                >
                  <Download size={12} /> Export
                </button>
                <button
                  onClick={handleImport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
                >
                  <Upload size={12} /> Import
                </button>
              </div>
            </SettingRow>
            <SettingRow label="Clear all data" description="Permanently delete all conversations">
              <button
                onClick={handleClear}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                style={{
                  color: confirmClear ? 'white' : 'var(--color-error)',
                  background: confirmClear ? 'var(--color-error)' : 'transparent',
                  border: '1px solid var(--color-error)',
                }}
                onMouseEnter={(e) => { if (!confirmClear) e.currentTarget.style.background = 'rgba(220,38,38,0.1)'; }}
                onMouseLeave={(e) => { if (!confirmClear) e.currentTarget.style.background = 'transparent'; }}
              >
                <Trash2 size={12} /> {confirmClear ? 'Click again to confirm' : 'Clear'}
              </button>
            </SettingRow>
          </Section>

          {/* Updates */}
          <Section title="Updates">
            <SettingRow label="Auto-update" description="Check for new desktop builds automatically every 30 minutes">
              <button
                onClick={() => handleAutoUpdateToggle(!autoUpdateEnabled)}
                className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                style={{ background: autoUpdateEnabled ? 'var(--color-accent)' : 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
              >
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full transition-transform"
                  style={{
                    background: 'white',
                    transform: autoUpdateEnabled ? 'translateX(18px)' : 'translateX(2px)',
                  }}
                />
              </button>
            </SettingRow>
            <SettingRow label="Check for updates" description="Manually check for a new version right now">
              <button
                onClick={handleCheckNow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', cursor: 'pointer' }}
                disabled={updateCheckState === 'checking'}
              >
                <RefreshCw size={12} className={updateCheckState === 'checking' ? 'animate-spin' : ''} />
                {updateCheckState === 'checking' && 'Checking...'}
                {updateCheckState === 'available' && 'Update available — see banner above'}
                {updateCheckState === 'latest' && 'Already up to date'}
                {updateCheckState === 'idle' && 'Check now'}
              </button>
            </SettingRow>
          </Section>

          {/* About */}
          <Section title="About">
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <p className="mb-2">
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>OpenJarvis</span> — Programming abstractions for on-device AI.
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Part of Intelligence Per Watt, a research initiative at Stanford SAIL.
              </p>
              <div className="flex gap-3 mt-3 text-xs">
                <a
                  href="https://openjarvis.stanford.edu/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-accent)' }}
                >
                  Project site
                </a>
                <a
                  href="https://open-jarvis.github.io/OpenJarvis/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-accent)' }}
                >
                  Documentation
                </a>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
