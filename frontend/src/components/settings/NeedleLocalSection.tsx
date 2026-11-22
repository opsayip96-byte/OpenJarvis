import { useCallback, useEffect, useState } from 'react';
import { Download, Cpu, Play, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { isAndroidNative } from '../../lib/android-native';
import { NeedleNative, type NeedleStatus } from '../../lib/needle-native';

const DEFAULT_PROMPT = 'Hello JARVIS. Confirm that Needle 3 is running locally and explain your role as a tool-routing model.';
const SYSTEM_PROMPT = 'You are Needle 3, JARVIS\'s private on-device tool-routing brain. Choose only from the supplied tools. Never invent tools or arguments. Return structured tool calls when a supplied tool matches the request.';

export function NeedleLocalSection() {
  const [status, setStatus] = useState<NeedleStatus | null>(null);
  const [busy, setBusy] = useState<'download' | 'load' | 'run' | ''>('');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [toolsJson, setToolsJson] = useState('[]');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!isAndroidNative()) return;
    try {
      setStatus(await NeedleNative.getStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runAction = async (action: 'download' | 'load' | 'run') => {
    setBusy(action);
    setError('');
    if (action !== 'run') setResponse('');
    try {
      if (action === 'download') {
        await NeedleNative.downloadModel();
      } else if (action === 'load') {
        JSON.parse(toolsJson);
        await NeedleNative.loadModel({ systemPrompt: SYSTEM_PROMPT, toolsJson });
      } else {
        const result = await NeedleNative.complete({ input: prompt, maxTokens: 256 });
        setResponse(result.response);
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  };

  if (!isAndroidNative()) {
    return <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Needle 3 local inference is available in the Android ARM64 build.</p>;
  }

  const formatSize = (bytes: number) => bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : 'Not downloaded';

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Needle 3 is a compact, offline tool-routing model. It works alongside JARVIS-Nano, it does not replace the conversational model.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <span className="inline-flex items-center gap-1"><Cpu size={13} /> Android ARM64</span>
        <span>•</span>
        <span>{status?.modelLoaded ? 'Loaded in memory' : status?.modelDownloaded ? 'Downloaded, not loaded' : 'Model not downloaded'}</span>
        <span>•</span>
        <span>{formatSize(status?.modelBytes ?? 0)}</span>
      </div>
      {status?.nativeAvailable === false && (
        <p className="text-xs" style={{ color: 'var(--color-error)' }}>Native engine is missing from this APK. Rebuild using the Needle Android workflow.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy || !status?.nativeAvailable} onClick={() => void runAction('download')} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
          {busy === 'download' ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />} Download model
        </button>
        <button type="button" disabled={!!busy || !status?.modelDownloaded || !status?.nativeAvailable} onClick={() => void runAction('load')} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
          {busy === 'load' ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Load into RAM
        </button>
        <button type="button" disabled={!!busy || !status?.modelLoaded} onClick={() => void runAction('run')} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--color-accent)', color: 'white' }}>
          {busy === 'run' ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />} Run local test
        </button>
      </div>
      <label className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Test prompt</label>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} className="w-full rounded-lg p-3 text-xs outline-none" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
      <details>
        <summary className="cursor-pointer text-xs" style={{ color: 'var(--color-text-secondary)' }}>Tool schemas (JSON)</summary>
        <textarea value={toolsJson} onChange={(event) => setToolsJson(event.target.value)} rows={5} spellCheck={false} className="mt-2 w-full rounded-lg p-3 font-mono text-[11px] outline-none" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
      </details>
      {error && <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-error)' }}><AlertCircle size={14} />{error}</p>}
      {response && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg p-3 text-xs" style={{ background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{response}</pre>}
      <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        The model runs locally after download. Tool calls are returned for inspection only in this first integration, they are not executed automatically.
      </p>
    </div>
  );
}
