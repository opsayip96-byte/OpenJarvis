import { describe, expect, it } from 'vitest';
import { resolveJarvisEngine, composeJarvisPrompt } from './jarvis-core';
import {
  approveDevelopmentProposal,
  canInstallDevelopmentUpdate,
  createDevelopmentProposal,
  markDevelopmentTests,
} from './jarvis-self-development';

describe('JARVIS-owned intelligence core', () => {
  const local = { id: 'qwen-local', kind: 'local' as const, costClass: 'free' as const, available: true };
  const remoteFree = { id: 'remote-free', kind: 'remote' as const, costClass: 'free' as const, available: true };
  const remotePaid = { id: 'remote-paid', kind: 'remote' as const, costClass: 'paid' as const, available: true };

  it('uses a local engine by default even when online', () => {
    expect(resolveJarvisEngine({
      mode: 'auto', networkAvailable: true, engines: [local, remoteFree],
    }).engineId).toBe('qwen-local');
  });

  it('never selects a remote engine while offline', () => {
    expect(resolveJarvisEngine({
      mode: 'offline', networkAvailable: false, engines: [remoteFree],
    }).route).toBe('unavailable');
  });

  it('does not select paid engines without explicit permission', () => {
    expect(resolveJarvisEngine({
      mode: 'online', networkAvailable: true, engines: [remotePaid], explicitlyRequestedRemote: true,
    }).route).toBe('unavailable');
  });

  it('keeps JARVIS identity independent of the selected model', () => {
    const prompt = composeJarvisPrompt({ userMessage: 'Hello', approvedMemory: 'Call me Joshua' });
    expect(prompt).toContain('You are J.A.R.V.I.S.');
    expect(prompt).toContain('APPROVED USER MEMORY');
    expect(prompt).not.toContain('You are Qwen');
  });
});

describe('JARVIS self-development safeguards', () => {
  it('requires approval, passing tests, isolation and a backup before install', () => {
    const proposal = createDevelopmentProposal({
      id: 'feature-1', request: 'Add voice app launching', summary: 'Add a permission-gated app launcher',
    });
    expect(canInstallDevelopmentUpdate(proposal, { isolated: true, backupCreated: true })).toBe(false);

    const approved = approveDevelopmentProposal(proposal, true);
    const tested = markDevelopmentTests(approved, true);
    expect(canInstallDevelopmentUpdate(tested, { isolated: true, backupCreated: false })).toBe(false);
    expect(canInstallDevelopmentUpdate(tested, { isolated: true, backupCreated: true })).toBe(true);
  });

  it('does not allow rejected proposals to become installable', () => {
    const proposal = createDevelopmentProposal({
      id: 'feature-2', request: 'Delete all safeguards', summary: 'Unsafe request',
    });
    const rejected = approveDevelopmentProposal(proposal, false);
    const afterTests = markDevelopmentTests(rejected, true);
    expect(canInstallDevelopmentUpdate(afterTests, { isolated: true, backupCreated: true })).toBe(false);
  });
});
