import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Cpu, Download, HardDrive, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';
import {
  estimateAndroidModelFit,
  searchQwenGgufModels,
  type DiscoveredGgufModel,
  type ModelFit,
} from '../lib/huggingface-models';
import {
  JarvisModelLibrary,
  type DeviceCapacity,
  type LibraryModel,
  type ModelDownloadStatus,
} from '../lib/local-model';

interface ActiveDownload {
  model: DiscoveredGgufModel;
  downloadId: number;
  status: ModelDownloadStatus | null;
}

function bytes(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(unit >= 3 ? 2 : 1)} ${units[unit]}`;
}

function fitLabel(fit: ModelFit): string {
  if (fit.level === 'recommended') return 'Recommended for this phone';
  if (fit.level === 'possible') return 'May work, performance varies';
  if (fit.level === 'not-recommended') return 'Not recommended on this phone';
  return 'Compatibility unknown';
}

export function QwenModelLibrary() {
  const [query, setQuery] = useState('Qwen');
  const [models, setModels] = useState<DiscoveredGgufModel[]>([]);
  const [capacity, setCapacity] = useState<DeviceCapacity | null>(null);
  const [installed, setInstalled] = useState<LibraryModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | undefined>();
  const [downloads, setDownloads] = useState<ActiveDownload[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [busyModel, setBusyModel] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const result = await JarvisModelLibrary.listModels();
      setInstalled(result.models || []);
      setActiveModelId(result.activeModelId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void JarvisModelLibrary.getDeviceStorageInfo().then(setCapacity).catch(() => setCapacity(null));
    void refreshLibrary();
    void JarvisModelLibrary.listDownloads().then(({ downloads: rows }) => {
      setDownloads(rows
        .filter((row) => !['complete', 'missing'].includes(row.status))
        .map((row) => ({
          downloadId: row.downloadId,
          model: {
            id: row.id,
            repoId: row.id.split('@')[0] || 'Hugging Face',
            fileName: row.fileName,
            quantization: null,
            sizeBytes: row.expectedSizeBytes || null,
            sha256: null,
            revision: 'main',
            downloadUrl: '',
            license: null,
          },
          status: {
            downloadId: row.downloadId,
            status: row.status,
            bytesDownloaded: row.bytesDownloaded,
            totalBytes: row.totalBytes,
            progress: row.progress,
          },
        })));
    }).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
  }, [refreshLibrary]);

  const search = async () => {
    setSearching(true);
    setMessage('');
    try {
      const found = await searchQwenGgufModels(query);
      setModels(found.slice(0, 40));
      if (found.length === 0) setMessage('No matching Qwen GGUF files were returned by Hugging Face.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (downloads.length === 0) return;
    const timer = window.setInterval(() => {
      void Promise.all(downloads.map(async (item) => {
        try {
          const status = await JarvisModelLibrary.getDownloadStatus({ downloadId: item.downloadId });
          return { ...item, status };
        } catch {
          return item;
        }
      })).then((updated) => {
        setDownloads(updated.filter((item) => !['complete', 'failed', 'missing'].includes(item.status?.status || '')));
        if (updated.some((item) => item.status?.status === 'complete')) {
          setMessage('Model verified and added to your JARVIS library.');
          void refreshLibrary();
          window.dispatchEvent(new Event('jarvis-model-library-updated'));
        }
        if (updated.some((item) => item.status?.status === 'failed')) {
          setMessage('A model download failed or did not pass GGUF/checksum verification. You can retry it.');
        }
      });
    }, 1600);
    return () => window.clearInterval(timer);
  }, [downloads, refreshLibrary]);

  const fitFor = useMemo(() => {
    const profile = capacity ? {
      physicalRamBytes: capacity.physicalRamBytes,
      availableStorageBytes: capacity.availableStorageBytes,
      architecture: capacity.architecture,
    } : null;
    return (model: DiscoveredGgufModel) => profile
      ? estimateAndroidModelFit(model, profile)
      : { level: 'unknown' as const, estimatedRuntimeRamBytes: null, requiredStorageBytes: null, reason: 'Device capacity is unavailable.' };
  }, [capacity]);

  const download = async (model: DiscoveredGgufModel) => {
    const fit = fitFor(model);
    if (fit.level === 'not-recommended') {
      setMessage(`Download blocked by the safety estimate: ${fit.reason}`);
      return;
    }
    const size = bytes(model.sizeBytes);
    const warning = model.sizeBytes
      ? `Download ${model.fileName} (${size}) from Hugging Face? This uses internet data and may take time. No paid AI service is involved.`
      : `Hugging Face did not provide a file size for ${model.fileName}. Download anyway? Storage safety cannot be estimated reliably.`;
    if (!window.confirm(warning)) return;
    setBusyModel(model.id);
    setMessage('');
    try {
      const started = await JarvisModelLibrary.startDownload({
        id: model.id,
        url: model.downloadUrl,
        fileName: model.fileName,
        expectedSha256: model.sha256 || undefined,
        expectedSizeBytes: model.sizeBytes || undefined,
      });
      setDownloads((current) => [...current.filter((item) => item.model.id !== model.id), {
        model,
        downloadId: started.downloadId,
        status: null,
      }]);
      setMessage(`Download started for ${model.fileName}. Android will manage the transfer in the background.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyModel(null);
    }
  };

  const cancelDownload = async (item: ActiveDownload) => {
    if (!window.confirm(`Cancel the download of ${item.model.fileName}?`)) return;
    setBusyModel(item.model.id);
    try {
      const result = await JarvisModelLibrary.cancelDownload({ downloadId: item.downloadId });
      if (result.cancelled) {
        setDownloads((current) => current.filter((download) => download.downloadId !== item.downloadId));
        setMessage(`Download cancelled: ${item.model.fileName}. You can start it again at any time.`);
      } else {
        setMessage('Android could not confirm cancellation. Refresh the library and check the download status.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyModel(null);
    }
  };

  const activate = async (modelId: string) => {
    setBusyModel(modelId);
    try {
      await JarvisModelLibrary.activateModel({ modelId });
      setActiveModelId(modelId);
      setMessage('Local model activated. The next JARVIS Local conversation will use it.');
      window.dispatchEvent(new Event('jarvis-model-library-updated'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyModel(null);
    }
  };

  const remove = async (modelId: string) => {
    if (!window.confirm('Remove this model file from JARVIS private storage?')) return;
    setBusyModel(modelId);
    try {
      await JarvisModelLibrary.removeLibraryModel({ modelId });
      await refreshLibrary();
      window.dispatchEvent(new Event('jarvis-model-library-updated'));
      setMessage('Model removed from the local library.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyModel(null);
    }
  };

  return (
    <section className="rounded-xl p-5 space-y-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Qwen model library</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Discover public Qwen GGUF files, download only when you approve, and keep multiple models in JARVIS private storage.
        </p>
      </div>

      {capacity && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--color-bg-secondary)' }}>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="inline-flex items-center gap-1"><Cpu size={13} /> Device RAM {bytes(capacity.physicalRamBytes)}</span>
            <span className="inline-flex items-center gap-1"><HardDrive size={13} /> Phone storage free {bytes(capacity.availableStorageBytes)}</span>
            <span>{capacity.architecture}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
            <div className="h-full rounded-full" style={{ width: `${capacity.totalStorageBytes > 0 ? Math.max(0, Math.min(100, ((capacity.totalStorageBytes - capacity.availableStorageBytes) / capacity.totalStorageBytes) * 100)) : 0}%`, background: 'var(--color-accent)' }} />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            JARVIS model files are stored on this phone in the app's private storage, not in a cloud drive. Total device storage: {bytes(capacity.totalStorageBytes)}.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void search(); }}
          placeholder="Search Qwen2.5, Qwen3..."
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
        />
        <button type="button" onClick={() => void search()} disabled={searching || !query.trim()}
          className="rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-1.5"
          style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)', opacity: searching ? 0.6 : 1 }}>
          {searching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Search
        </button>
      </div>

      {message && <p className="text-xs break-words" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>}

      {downloads.map((item) => (
        <div key={item.downloadId} className="rounded-lg p-3" style={{ background: 'var(--color-bg-secondary)' }}>
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate" style={{ color: 'var(--color-text)' }}>{item.model.fileName}</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>{item.status?.status || 'queued'}</span>
          </div>
          <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--color-border)' }}>
            <div className="h-full rounded-full" style={{ width: `${item.status?.progress || 0}%`, background: 'var(--color-accent)' }} />
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {item.status ? `${Math.max(0, Math.min(100, item.status.progress))}% · ${bytes(item.status.bytesDownloaded)} / ${bytes(item.status.totalBytes)}` : 'Waiting for Android DownloadManager'}
            </div>
            <button type="button" disabled={busyModel === item.model.id} onClick={() => void cancelDownload(item)}
              className="inline-flex items-center gap-1 text-[10px] underline" style={{ color: 'var(--color-error)' }}>
              {busyModel === item.model.id ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
              Cancel
            </button>
          </div>
        </div>
      ))}

      {models.map((model) => {
        const fit = fitFor(model);
        const alreadyInstalled = installed.some((entry) => entry.id === model.id);
        const isDownloading = downloads.some((entry) => entry.model.id === model.id);
        return (
          <div key={model.id} className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--color-border)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium break-all" style={{ color: 'var(--color-text)' }}>{model.repoId}</div>
                <div className="text-xs break-all mt-1" style={{ color: 'var(--color-text-secondary)' }}>{model.fileName}</div>
              </div>
              <span className="shrink-0 text-[10px] rounded-full px-2 py-1" style={{ background: fit.level === 'recommended' ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                {fit.level}
              </span>
            </div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {model.quantization || 'Unknown quantization'} · {bytes(model.sizeBytes)} · {model.license || 'Licence not listed'}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
              {fitLabel(fit)}. Estimated RAM {bytes(fit.estimatedRuntimeRamBytes)}, storage {bytes(fit.requiredStorageBytes)}.
            </div>
            <div className="flex items-center justify-between gap-2">
              <a href={model.downloadUrl} target="_blank" rel="noreferrer" className="text-[10px] underline" style={{ color: 'var(--color-text-tertiary)' }}>Hugging Face file</a>
              <button type="button" disabled={alreadyInstalled || isDownloading || busyModel === model.id || fit.level === 'not-recommended'}
                onClick={() => void download(model)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)', opacity: alreadyInstalled || isDownloading || fit.level === 'not-recommended' ? 0.5 : 1 }}>
                {busyModel === model.id ? <Loader2 size={12} className="animate-spin" /> : alreadyInstalled ? <Check size={12} /> : <Download size={12} />}
                {alreadyInstalled ? 'Installed' : isDownloading ? 'Downloading' : 'Download'}
              </button>
            </div>
          </div>
        );
      })}

      <div className="pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Installed private models ({installed.length})</div>
        {installed.length === 0 && <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No models registered yet. Existing imported GGUF files are migrated when the app starts.</p>}
        {installed.map((model) => (
          <div key={model.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="text-xs truncate" style={{ color: 'var(--color-text)' }}>{model.fileName || model.name || model.id}</div>
              <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{bytes(model.sizeBytes)} · {model.verified || 'unverified'}</div>
            </div>
            <div className="flex items-center gap-1">
              {activeModelId === model.id
                ? <span className="text-[10px]" style={{ color: 'var(--color-success)' }}>Active</span>
                : <button type="button" disabled={busyModel === model.id} onClick={() => void activate(model.id)} className="text-[10px] underline" style={{ color: 'var(--color-accent)' }}>Activate</button>}
              <button type="button" disabled={busyModel === model.id} onClick={() => void remove(model.id)} className="p-1" title="Remove model" style={{ color: 'var(--color-error)' }}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Downloads use Android's background DownloadManager. The OS may pause transfers for network or power conditions and retry them, but this first version does not provide a manual pause button. A checksum is verified when Hugging Face supplies a SHA-256 digest; otherwise JARVIS verifies the GGUF header and records that the checksum was unavailable.
      </p>
    </section>
  );
}
