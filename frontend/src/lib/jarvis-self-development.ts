/**
 * Guarded self-development lifecycle for JARVIS.
 *
 * This module defines the approval and verification boundary. It deliberately
 * does not execute generated code itself. A native/workspace adapter must
 * provide an isolated branch/worktree, patch application, tests and rollback.
 */
export type DevelopmentStatus =
  | 'proposed'
  | 'awaiting-approval'
  | 'approved'
  | 'implementing'
  | 'testing'
  | 'ready-to-install'
  | 'rejected'
  | 'failed';

export interface DevelopmentProposal {
  id: string;
  request: string;
  summary: string;
  filesToChange: string[];
  testsToRun: string[];
  status: DevelopmentStatus;
  userApproved: boolean;
  testsPassed: boolean;
  createdAt: number;
  failureReason?: string;
}

export interface DevelopmentWorkspace {
  /** Must be a disposable branch/worktree, never the installed app directory. */
  isolated: boolean;
  /** True only after the workspace has a recoverable checkpoint. */
  backupCreated: boolean;
}

export function createDevelopmentProposal(input: {
  id: string;
  request: string;
  summary: string;
  filesToChange?: string[];
  testsToRun?: string[];
  now?: number;
}): DevelopmentProposal {
  return {
    id: input.id,
    request: input.request.trim(),
    summary: input.summary.trim(),
    filesToChange: [...(input.filesToChange ?? [])],
    testsToRun: [...(input.testsToRun ?? [])],
    status: 'awaiting-approval',
    userApproved: false,
    testsPassed: false,
    createdAt: input.now ?? Date.now(),
  };
}

export function approveDevelopmentProposal(
  proposal: DevelopmentProposal,
  approved: boolean,
): DevelopmentProposal {
  if (proposal.status !== 'awaiting-approval' && proposal.status !== 'proposed') return proposal;
  return {
    ...proposal,
    userApproved: approved,
    status: approved ? 'approved' : 'rejected',
  };
}

export function markDevelopmentTests(
  proposal: DevelopmentProposal,
  passed: boolean,
  failureReason?: string,
): DevelopmentProposal {
  if (!proposal.userApproved || proposal.status === 'rejected') return proposal;
  return {
    ...proposal,
    testsPassed: passed,
    status: passed ? 'ready-to-install' : 'failed',
    failureReason: passed ? undefined : (failureReason || 'One or more verification checks failed.'),
  };
}

/**
 * Installing an update requires explicit approval, successful tests and a
 * recoverable isolated workspace. A feature request alone never authorizes it.
 */
export function canInstallDevelopmentUpdate(
  proposal: DevelopmentProposal,
  workspace: DevelopmentWorkspace,
): boolean {
  return proposal.userApproved
    && proposal.testsPassed
    && proposal.status === 'ready-to-install'
    && workspace.isolated
    && workspace.backupCreated;
}
