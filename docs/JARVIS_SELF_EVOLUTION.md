# JARVIS conversational self-improvement architecture

## Goal

A user can say: "JARVIS, investigate the crash and fix it." JARVIS should collect diagnostics, identify a reproducible cause, prepare a source patch, run tests, and offer an updated APK. This is a code-maintenance agent, not a promise that a running Android APK can rewrite its own signed executable in place.

## Required execution path

1. **Intent and scope**: classify the request as diagnosis, documentation, code change, model update, or system action. Ask for clarification when the target is ambiguous.
2. **Evidence collection**: capture app version, Android version, sanitized crash stack, relevant logs, and the exact source revision. Never collect passwords, tokens, private messages, or unrelated files.
3. **Plan**: explain the suspected cause, files to change, tests to run, and expected effect. For ordinary bug fixes, a user-approved "fix it" command authorizes the proposed patch, not unrelated changes.
4. **Isolated workspace**: create a new branch/worktree or remote build workspace. Never edit the installed APK or the only copy of the source.
5. **Patch generation**: produce a bounded unified diff. Reject edits outside the approved paths and reject dependency, permission, signing, network, or security-policy changes unless separately approved.
6. **Validation**: run formatting, type checks, unit tests, Android compilation, and targeted regression tests. A failed test blocks packaging.
7. **Review and rollback**: show the diff and test report. Keep the previous known-good commit and APK. If a deployed update regresses, revert to the last known-good revision.
8. **Package delivery**: build a signed update using a user-controlled signing key. Android package updates must be signed with the same key and installed through Android's package installer with the user's confirmation.

## Model responsibilities

- JARVIS-Nano is the local language model and can run offline after a compatible GGUF has been installed.
- The JARVIS agent runtime owns tool routing, memory access, permissions, patch validation, test orchestration, and audit history.
- Online models are optional helpers. They must not be required for local diagnostics, saved memory, or offline chat.
- A model update and an app-code update are separate operations. Updating Nano's weights must not silently change the app source.

## Safety policy

The agent may read only app-owned source/workspace files and explicitly selected diagnostic logs. It must not silently run arbitrary shell commands, change Android security settings, exfiltrate local files, disable protections, alter signing keys, or install packages. Destructive operations and external network writes require a separate confirmation. Every patch is logged with timestamp, base revision, changed paths, test results, and rollback revision.

## Android platform constraint

An Android app cannot replace its own installed executable or silently install a new APK under ordinary app permissions. JARVIS can create a patch in its private workspace, use a connected build service or CI to compile a new APK, and launch Android's package installer. The user confirms installation. A self-update that bypasses these platform controls is not part of this design.

## Current implementation status

This document is the target architecture, not a claim that the self-repair agent is implemented. The repository currently contains the local llama.cpp bridge, GGUF import/load/generate methods, and an experimental JARVIS-Nano from-scratch training script. A trained Nano checkpoint, a secure source workspace, patch executor, test orchestrator, and APK update flow still need implementation and device testing.
