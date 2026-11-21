import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Activity, Bot, Check, ChevronRight, CircleAlert, Cpu, FileText,
  LockKeyhole, Mic, Play, ShieldCheck, Smartphone, Sparkles, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../lib/store';
import { clearIndexedMemory, deleteModel, fetchModels, preloadModel } from '../lib/api';
import { isAndroidNative, JarvisNative } from '../lib/android-native';
import { JarvisControlNative } from '../lib/jarvis-control-native';

type Action =
  | { type: 'theme'; value: 'dark' | 'light' | 'system'; label: string }
  | { type: 'voice-output'; value: boolean; label: string }
  | { type: 'voice-autoplay'; value: boolean; label: string }
  | { type: 'speech'; value: boolean; label: string }
  | { type: 'temperature'; value: number; label: string }
  | { type: 'max-tokens'; value: number; label: string }
  | { type: 'font-size'; value: 'small' | 'default' | 'large'; label: string }
  | { type: 'deep-research'; value: boolean; label: string }
  | { type: 'sidebar'; value: boolean; label: string }
  | { type: 'system-panel'; value: boolean; label: string }
  | { type: 'clear-logs'; label: string }
  | { type: 'clear-agent-events'; label: string }
  | { type: 'new-chat'; label: string }
  | { type: 'navigate'; path: string; label: string }
  | { type: 'select-model'; model: string; label: string }
  | { type: 'launch-app'; app: string; label: string }
  | { type: 'delete-model'; model: string; label: string }
  | { type: 'delete-chat'; label: string }
  | { type: 'clear-memory'; label: string };

type AuditRow = { at: number; label: string; result: 'done' | 'denied' | 'failed' };

const AUDIT_KEY = 'jarvis-control-audit-v1';
const ROUTES: Record<string, string> = {
  chat: '/', dashboard: '/dashboard', settings: '/settings',
  agents: '/agents', logs: '/logs', 'data sources': '/data-sources', 'get started': '/get-started',
};
const KNOWN_APPS = ['youtube', 'chrome', 'maps', 'whatsapp', 'instagram', 'gmail'];

function readAudit(): AuditRow[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch { return []; }
}

function parseCommand(raw: string, models: Array<{ id: string }>): Action | null {
  const text = raw.trim().toLowerCase();
  let match: RegExpMatchArray | null;

  if ((match = text.match(/^(?:set )?theme (?:to )?(dark|light|system)$/)))
    return { type: 'theme', value: match[1] as 'dark' | 'light' | 'system', label: 'Change app theme to ' + match[1] };
  if ((match = text.match(/^(?:turn |switch )?voice output (on|off)$/)))
    return { type: 'voice-output', value: match[1] === 'on', label: (match[1] === 'on' ? 'Enable' : 'Disable') + ' voice output' };
  if ((match = text.match(/^(?:turn |switch )?voice autoplay (on|off)$/)))
    return { type: 'voice-autoplay', value: match[1] === 'on', label: (match[1] === 'on' ? 'Enable' : 'Disable') + ' voice autoplay' };
  if ((match = text.match(/^(?:turn |switch )?speech (on|off)$/)))
    return { type: 'speech', value: match[1] === 'on', label: (match[1] === 'on' ? 'Enable' : 'Disable') + ' speech input' };
  if ((match = text.match(/^set temperature(?: to)? (0(?:\.\d+)?|1(?:\.0+)?)$/)))
    return { type: 'temperature', value: Number(match[1]), label: 'Set model temperature to ' + match[1] };
  if ((match = text.match(/^set max tokens(?: to)? (\d{2,5})$/))) {
    const value = Math.min(16384, Math.max(128, Number(match[1])));
    return { type: 'max-tokens', value, label: 'Set maximum response tokens to ' + value };
  }
  if ((match = text.match(/^set font size(?: to)? (small|default|large)$/)))
    return { type: 'font-size', value: match[1] as 'small' | 'default' | 'large', label: 'Set font size to ' + match[1] };
  if ((match = text.match(/^deep research (on|off)$/)))
    return { type: 'deep-research', value: match[1] === 'on', label: (match[1] === 'on' ? 'Enable' : 'Disable') + ' deep research' };
  if ((match = text.match(/^sidebar (open|close)$/)))
    return { type: 'sidebar', value: match[1] === 'open', label: (match[1] === 'open' ? 'Open' : 'Close') + ' sidebar' };
  if ((match = text.match(/^system panel (open|close)$/)))
    return { type: 'system-panel', value: match[1] === 'open', label: (match[1] === 'open' ? 'Open' : 'Close') + ' system panel' };
  if (/^(?:clear|delete) (?:the )?logs$/.test(text))
    return { type: 'clear-logs', label: 'Clear application logs' };
  if (/^(?:clear|delete) agent events$/.test(text))
    return { type: 'clear-agent-events', label: 'Clear agent event history' };
  if (/^(?:new chat|start new chat|create conversation)$/.test(text))
    return { type: 'new-chat', label: 'Start a new conversation' };
  if ((match = text.match(/^open (chat|dashboard|settings|agents|logs|data sources|get started)$/)))
    return { type: 'navigate', path: ROUTES[match[1]], label: 'Open ' + match[1] };
  if ((match = text.match(/^switch model(?: to)? (.+)$/))) {
    const model = models.find((item) => item.id.toLowerCase() === match![1].trim());
    if (model) return { type: 'select-model', model: model.id, label: 'Switch active model to ' + model.id };
    return null;
  }
  if ((match = text.match(/^open (youtube|chrome|maps|whatsapp|instagram|gmail)$/)))
    return { type: 'launch-app', app: match[1], label: 'Launch ' + match[1] };
  if ((match = text.match(/^delete model (.+)$/))) {
    const model = models.find((item) => item.id.toLowerCase() === match![1].trim());
    if (model) return { type: 'delete-model', model: model.id, label: 'Delete model ' + model.id };
    return null;
  }
  if (/^(?:delete|remove) (?:this |current )?(?:chat|conversation)$/.test(text))
    return { type: 'delete-chat', label: 'Delete the current conversation' };
  if (/^(?:clear|delete) (?:indexed )?memory$/.test(text))
    return { type: 'clear-memory', label: 'Clear indexed memory' };
  return null;
}

export function JarvisControlPage() {
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  const models = useAppStore((s) => s.models);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const [command, setCommand] = useState('');
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [audit, setAudit] = useState<AuditRow[]>(readAudit);

  const capabilities = useMemo(() => [
    { icon: Mic, title: 'Voice interface', detail: isAndroidNative() ? 'Android speech recognition and speech output' : 'Voice APIs available in native Android build', active: true },
    { icon: Cpu, title: 'Model control', detail: models.length + ' models discovered', active: models.length > 0 },
    { icon: FileText, title: 'Conversation memory', detail: 'Manage chats through the app store', active: true },
    { icon: Smartphone, title: 'Android app launch', detail: 'Six allowlisted apps, Android only', active: isAndroidNative() },
    { icon: Bot, title: 'Agent workflows', detail: 'Existing Agents and backend tools remain available', active: true },
    { icon: ShieldCheck, title: 'Action safety', detail: 'Routine actions automatic, destructive actions require approval', active: true },
  ], [models.length]);

  const record = (label: string, result: AuditRow['result']) => {
    const next = [{ at: Date.now(), label, result }, ...audit].slice(0, 12);
    setAudit(next);
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(next)); } catch { /* best effort */ }
    const state = result === 'done' ? 'info' : result === 'denied' ? 'warn' : 'error';
    useAppStore.getState().addLogEntry({
      timestamp: Date.now(), level: state, category: 'tool',
      message: 'JARVIS control: ' + label + ' (' + result + ')',
    });
  };

  const execute = async (action: Action) => {
    setBusy(true);
    try {
      const store = useAppStore.getState();
      switch (action.type) {
        case 'theme':
          store.updateSettings({ theme: action.value });
          break;
        case 'voice-output':
          store.updateSettings({ voiceOutputEnabled: action.value });
          break;
        case 'voice-autoplay':
          store.updateSettings({ voiceAutoplay: action.value });
          break;
        case 'speech':
          store.updateSettings({ speechEnabled: action.value });
          break;
        case 'temperature':
          store.updateSettings({ temperature: action.value });
          break;
        case 'max-tokens':
          store.updateSettings({ maxTokens: action.value });
          break;
        case 'font-size':
          store.updateSettings({ fontSize: action.value });
          break;
        case 'deep-research':
          store.setDeepResearch(action.value);
          break;
        case 'sidebar':
          store.setSidebarOpen(action.value);
          break;
        case 'system-panel':
          store.setSystemPanelOpen(action.value);
          break;
        case 'clear-logs':
          store.clearLogs();
          break;
        case 'clear-agent-events':
          store.clearAgentEvents();
          break;
        case 'new-chat':
          store.createConversation(store.selectedModel);
          navigate('/');
          break;
        case 'navigate':
          navigate(action.path);
          break;
        case 'select-model':
          store.setSelectedModel(action.model);
          await preloadModel(action.model, models.find((m) => m.id === action.model)?.owned_by);
          break;
        case 'launch-app':
          if (!isAndroidNative()) throw new Error('Launching other Android apps is available in the installed Android APK only.');
          await JarvisControlNative.launchKnownApp({ app: action.app });
          break;
        case 'delete-chat':
          if (!store.activeId) throw new Error('There is no active conversation to delete.');
          store.deleteConversation(store.activeId);
          navigate('/');
          break;
        case 'clear-memory': {
          const removed = await clearIndexedMemory();
          toast.success('Cleared ' + removed + ' indexed memory entries.');
          break;
        }
        case 'delete-model': {
          await deleteModel(action.model);
          const refreshed = await fetchModels();
          store.setModels(refreshed);
          if (store.selectedModel === action.model) store.setSelectedModel(refreshed[0]?.id || '');
          break;
        }
      }
      record(action.label, 'done');
      toast.success(action.label);
      setPending(null);
      setCommand('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record(action.label, 'failed');
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const action = parseCommand(command, models);
    if (!action) {
      toast.error('Command not recognized. Try one of the examples below.');
      return;
    }
    if (action.type === 'delete-chat' || action.type === 'delete-model' || action.type === 'clear-memory') {
      setPending(action);
      return;
    }
    await execute(action);
  };

  const startVoice = async () => {
    if (!isAndroidNative()) {
      toast.error('Voice command capture requires the installed Android APK.');
      return;
    }
    try {
      await JarvisNative.startRecognition({ language: 'en-IN' });
      setVoiceActive(true);
      toast.info('Listening. Tap Stop when you have finished speaking.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const stopVoice = async () => {
    try {
      const result = await JarvisNative.stopRecognition();
      setCommand(result.text || '');
      setVoiceActive(false);
      toast.success(result.text ? 'Voice command captured. Review it before execution.' : 'No speech was captured.');
    } catch (error) {
      setVoiceActive(false);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const examples = [
    'set theme dark', 'voice output on', 'voice autoplay off',
    'set temperature 0.5', 'set max tokens 2048', 'new chat',
    'open agents', 'open dashboard', 'open data sources', 'open get started',
    'switch model to MODEL_ID', 'open youtube', 'speech off',
    'set font size large', 'deep research on', 'sidebar open',
    'system panel open', 'clear logs', 'clear agent events',
    'delete current chat', 'clear memory',
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em]" style={{ color: 'var(--color-accent)' }}>
              <Sparkles size={14} /> JARVIS executive system
            </div>
            <h1 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Control Center</h1>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Control app settings, conversations, models and supported Android actions from one place.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full px-3 py-2 text-xs" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
            <ShieldCheck size={14} /> Trusted automation
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((item) => (
            <div key={item.title} className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between">
                <item.icon size={18} style={{ color: item.active ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }} />
                <span className="text-[10px] uppercase tracking-wider" style={{ color: item.active ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>{item.active ? 'Available' : 'Needs setup'}</span>
              </div>
              <div className="mt-3 text-sm font-medium" style={{ color: 'var(--color-text)' }}>{item.title}</div>
              <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{item.detail}</div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl p-4 md:p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Activity size={18} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Command JARVIS</h2>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Routine commands execute automatically. Destructive commands are held for your approval.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="JARVIS command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void submit(); }}
              placeholder="Tell JARVIS what to do..."
              className="min-h-12 min-w-0 flex-1 rounded-lg px-4 text-sm outline-none"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
            {isAndroidNative() && (
              <button type="button" onClick={voiceActive ? () => void stopVoice() : () => void startVoice()} className="min-h-12 rounded-lg px-4 text-sm" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)' }}>
                <Mic size={16} className="inline mr-2" />{voiceActive ? 'Stop' : 'Speak'}
              </button>
            )}
            <button type="button" disabled={busy || !command.trim()} onClick={() => void submit()} className="min-h-12 rounded-lg px-5 text-sm font-medium disabled:opacity-50" style={{ background: 'var(--color-accent)', color: 'white' }}>
              <Play size={15} className="inline mr-2" />Execute
            </button>
          </div>

          {pending && (
            <div className="mt-4 rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--color-warning) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)' }}>
              <div className="flex items-start gap-3">
                <CircleAlert size={18} style={{ color: 'var(--color-warning)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Approval required</div>
                  <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{pending.label}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>This action can delete data. Nothing will happen until you approve it.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void execute(pending)} className="min-h-10 rounded-lg px-4 text-sm" style={{ background: 'var(--color-accent)', color: 'white' }}><Check size={14} className="inline mr-1" />Approve</button>
                    <button type="button" disabled={busy} onClick={() => { record(pending.label, 'denied'); setPending(null); }} className="min-h-10 rounded-lg px-4 text-sm" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)' }}><X size={14} className="inline mr-1" />Deny</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-5">
            <div className="mb-2 text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Example commands</div>
            <div className="flex flex-wrap gap-2">
              {examples.map((example) => (
                <button key={example} type="button" onClick={() => setCommand(example)} className="rounded-full px-3 py-2 text-xs" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>{example}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Current runtime</h2>
            <div className="mt-3 space-y-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <div className="flex justify-between gap-3"><span>Active model</span><span className="max-w-[60%] truncate" style={{ color: 'var(--color-text)' }}>{selectedModel || 'Not selected'}</span></div>
              <div className="flex justify-between"><span>Available models</span><span style={{ color: 'var(--color-text)' }}>{models.length}</span></div>
              <div className="flex justify-between"><span>Theme</span><span style={{ color: 'var(--color-text)' }}>{settings.theme}</span></div>
              <div className="flex justify-between"><span>Voice output</span><span style={{ color: 'var(--color-text)' }}>{settings.voiceOutputEnabled ? 'On' : 'Off'}</span></div>
              <div className="flex justify-between"><span>Voice autoplay</span><span style={{ color: 'var(--color-text)' }}>{settings.voiceAutoplay ? 'On' : 'Off'}</span></div>
              <div className="flex justify-between"><span>Temperature</span><span style={{ color: 'var(--color-text)' }}>{settings.temperature}</span></div>
              <div className="flex justify-between"><span>Maximum tokens</span><span style={{ color: 'var(--color-text)' }}>{settings.maxTokens}</span></div>
              <div className="flex justify-between"><span>Font size</span><span style={{ color: 'var(--color-text)' }}>{settings.fontSize}</span></div>
              <div className="flex justify-between"><span>Deep research</span><span style={{ color: 'var(--color-text)' }}>{useAppStore.getState().deepResearch ? 'On' : 'Off'}</span></div>
            </div>
            <button type="button" onClick={() => navigate('/settings')} className="mt-4 inline-flex min-h-10 items-center gap-1 text-xs" style={{ color: 'var(--color-accent)' }}>Advanced settings <ChevronRight size={14} /></button>
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2">
              <LockKeyhole size={16} style={{ color: 'var(--color-accent)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Trusted security policy</h2>
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              <li>• Routine app settings and navigation: automatic.</li>
              <li>• Launching an allowlisted Android app: automatic.</li>
              <li>• Deleting conversations or models: approval required.</li>
              <li>• Arbitrary shell commands, hidden access and permission grants: never exposed to the model.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Recent control actions</h2>
          {audit.length === 0 ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No actions yet. JARVIS will record action names and outcomes, not command contents or credentials.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {audit.map((row, index) => (
                <div key={row.at + ':' + index} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate" style={{ color: 'var(--color-text)' }}>{row.label}</span>
                  <span className="shrink-0" style={{ color: row.result === 'done' ? 'var(--color-success)' : row.result === 'failed' ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>{row.result} · {new Date(row.at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
