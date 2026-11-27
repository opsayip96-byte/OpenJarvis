import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Activity, Bot, Brain, Cpu, Database, MessageSquare, Mic,
  Settings, ShieldCheck, Sparkles, Terminal, Zap, Power,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../lib/store';
import { isAndroidNative, JarvisNative } from '../lib/android-native';

export function DashboardPage() {
  const navigate = useNavigate();
  const selectedModel = useAppStore((s) => s.selectedModel);
  const models = useAppStore((s) => s.models);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const [overlayAllowed, setOverlayAllowed] = useState(false);
  const [floatingActive, setFloatingActive] = useState(false);
  const [checkingOverlay, setCheckingOverlay] = useState(true);

  const model = models.find((item) => item.id === selectedModel);
  const isRouter = /needle/i.test(selectedModel || '');
  const coreReady = Boolean(selectedModel && !isRouter);

  const refreshFloatingStatus = async () => {
    if (!isAndroidNative()) {
      setCheckingOverlay(false);
      return;
    }
    try {
      const [permission, service] = await Promise.all([
        JarvisNative.checkOverlayPermission(),
        JarvisNative.isFloatingAssistantRunning(),
      ]);
      setOverlayAllowed(permission.granted);
      setFloatingActive(service.running);
    } catch {
      setOverlayAllowed(false);
      setFloatingActive(false);
    } finally {
      setCheckingOverlay(false);
    }
  };

  useEffect(() => {
    void refreshFloatingStatus();
    const onFocus = () => void refreshFloatingStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const toggleFloatingAssistant = async () => {
    if (!isAndroidNative()) {
      toast.info('The floating orb is available in the Android app.');
      return;
    }
    try {
      if (floatingActive) {
        await JarvisNative.stopFloatingAssistant();
        setFloatingActive(false);
        toast.success('Floating JARVIS stopped.');
        return;
      }
      if (!overlayAllowed) {
        const result = await JarvisNative.requestOverlayPermission();
        setOverlayAllowed(result.granted);
        if (!result.granted) {
          toast.info('Allow “Display over other apps” for JARVIS, return here, then tap Start floating assistant again.');
          return;
        }
      }
      await JarvisNative.startFloatingAssistant();
      setFloatingActive(true);
      toast.success('Floating JARVIS is active.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start floating JARVIS.');
      void refreshFloatingStatus();
    }
  };

  const modules = [
    { title: 'Conversation', detail: 'Talk, type and share media', icon: MessageSquare, action: () => navigate('/') },
    { title: 'Specialist agents', detail: 'Delegate research and tasks', icon: Bot, action: () => navigate('/agents') },
    { title: 'Memory & knowledge', detail: 'Manage saved context and sources', icon: Database, action: () => navigate('/data-sources') },
    { title: 'Voice & device', detail: 'Speech, permissions and phone controls', icon: Mic, action: () => navigate('/settings') },
    { title: 'System diagnostics', detail: 'Activity, traces and runtime details', icon: Activity, action: () => navigate('/logs') },
    { title: 'Configuration', detail: 'Models, privacy and preferences', icon: Settings, action: () => navigate('/settings') },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="relative overflow-hidden rounded-3xl border p-5 sm:p-8"
          style={{ background: 'radial-gradient(circle at 78% 20%, rgba(34,211,238,.16), transparent 34%), linear-gradient(135deg, #07111f, #0b1b30 60%, #10152a)', borderColor: 'rgba(67,190,255,.25)' }}>
          <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full border opacity-20" style={{ borderColor: '#3ddcff', boxShadow: '0 0 70px rgba(34,211,238,.25), inset 0 0 50px rgba(34,211,238,.12)' }} />
          <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-[.24em] text-cyan-300">
                <Sparkles size={15} /> PERSONAL INTELLIGENCE SYSTEM
              </div>
              <h1 className="text-3xl font-semibold tracking-[.12em] text-white sm:text-4xl">J.A.R.V.I.S.</h1>
              <p className="max-w-lg text-sm leading-6 text-slate-300">
                Good day, Sir. Your control centre is ready. Conversation, tools and device controls are gathered in one place.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-200">PERSONAL ASSISTANT</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">ANDROID EDITION</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-3 self-center">
              <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-cyan-300/50"
                style={{ background: 'radial-gradient(circle, rgba(34,211,238,.22), rgba(8,24,44,.92) 65%)', boxShadow: '0 0 42px rgba(34,211,238,.18), inset 0 0 28px rgba(34,211,238,.12)' }}>
                <div className="absolute inset-3 rounded-full border border-cyan-200/25" />
                <div className="absolute inset-6 rounded-full border border-dashed border-cyan-200/25" />
                <Brain size={48} className="text-cyan-200" strokeWidth={1.25} />
              </div>
              <span className="text-[10px] tracking-[.22em] text-cyan-200/80">SYSTEM ONLINE</span>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}><Cpu size={15} /> CONVERSATION MODEL</div>
            <div className="truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{model?.id || selectedModel || 'Not selected'}</div>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{modelLoading ? 'Loading model…' : coreReady ? 'Selected model available to chat' : isRouter ? 'Needle 3 is a tool router, not the chat brain' : 'Choose a conversational model in Chat'}</p>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}><Zap size={15} /> TOOL ROUTER</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Needle 3</div>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Local tool routing, separate from conversational intelligence</p>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}><ShieldCheck size={15} /> FLOATING ASSISTANT</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{checkingOverlay ? 'Checking…' : floatingActive ? 'Running' : overlayAllowed ? 'Ready to start' : 'Permission required'}</div>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{isAndroidNative() ? 'Android display-over-apps permission' : 'Available in the Android app'}</p>
          </div>
        </section>

        <section className="rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Floating assistant</h2>
              <p className="mt-1 text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>Keep a draggable JARVIS orb above other apps. Android will ask you to grant overlay access first.</p>
            </div>
            <button onClick={() => void toggleFloatingAssistant()} disabled={checkingOverlay}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ background: floatingActive ? 'var(--color-bg-tertiary)' : '#0e7490', color: floatingActive ? 'var(--color-text)' : '#fff' }}>
              <Power size={16} /> {floatingActive ? 'Stop assistant' : overlayAllowed ? 'Start assistant' : 'Enable & start'}
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>JARVIS systems</h2>
            <span className="text-[10px] tracking-[.18em]" style={{ color: 'var(--color-text-tertiary)' }}>CONTROL MODULES</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => {
              const Icon = module.icon;
              return (
                <button key={module.title} onClick={module.action}
                  className="group flex min-h-24 items-center gap-3 rounded-2xl border p-4 text-left transition-colors"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{module.title}</span>
                    <span className="mt-1 block text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>{module.detail}</span>
                  </span>
                  <Terminal size={15} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              );
            })}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          <span>JARVIS Core conversational runtime is a separate integration milestone.</span>
          <button onClick={() => navigate('/')} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3" style={{ color: 'var(--color-accent)' }}>
            <MessageSquare size={14} /> Open conversation
          </button>
        </div>
      </div>
    </div>
  );
}
