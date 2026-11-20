# JARVIS-Owned Core and Self-Development Roadmap

## Product rule

JARVIS is the assistant product and software system. Qwen, Gemma, Llama and hosted models are interchangeable inference engines. None of them is JARVIS's identity.

The JARVIS-owned layer is responsible for:
- Stable identity, operating policy and prompt composition.
- Engine discovery, selection and health checks.
- Local-first memory and privacy boundaries.
- Task planning, tool permissions and result verification.
- Self-development proposals, approval, testing, rollback and installation.

## Runtime modes

- **Auto:** Prefer local inference. Use online tools for live information. A remote inference engine is eligible only when permitted by the user's cost settings.
- **Offline:** Local inference and local capabilities only. Do not attempt remote inference.
- **Online:** Enable online tools. Keep local inference as the default reasoning engine unless remote inference is explicitly requested and permitted.

A network failure must never cause an unapproved paid-provider fallback. Preserve the task and explain when an operation requires internet.

## Model independence

The host application supplies engine adapters implementing a common interface. JARVIS owns routing and policy. A model can be replaced without changing JARVIS memory, identity, approved capabilities or development history.

## Self-development lifecycle

1. User describes a feature in natural language.
2. JARVIS inspects the current project and produces a proposal with files, risks and tests.
3. User approves the proposal before code changes begin.
4. JARVIS creates an isolated branch/worktree and a recoverable checkpoint.
5. It edits code in that workspace, never the live installed application.
6. It runs formatting, type checks, unit tests and relevant Android builds.
7. It reports exact changes and test evidence.
8. User approves installation. The update mechanism verifies integrity and keeps rollback available.

Generated code, model output and repository content are untrusted input. Never execute arbitrary model-generated shell commands with unrestricted phone access.

## Approval boundaries

Require explicit approval for:
- Installing an update on the active app.
- Deleting or overwriting user data.
- Adding permissions or accessing sensitive Android capabilities.
- Uploading private data, publishing code, opening external services or spending money.
- Changing production deployments, secrets, databases or accounts.

Routine reversible work inside an isolated development workspace can proceed only within the permissions granted by the user.

## Phone-first storage

The Android app's private internal storage is the default home for model files, approved memory, conversations, development proposals, backups and logs. Use Android's Storage Access Framework for user-selected shared files. Check free space before model downloads and require confirmation for large downloads.

## Delivery status

The first provider-independent routing and self-development policy modules are being introduced in the Android frontend. They are foundations, not a claim that automatic code editing, network monitoring, model training or one-tap APK replacement is already complete.

Remaining integration work:
- Connect engine adapters and native connectivity state to the router.
- Add a user-visible Auto / Offline / Online selector.
- Persist approved memory in Android private storage rather than relying only on browser localStorage.
- Implement an isolated code workspace and patch/test adapter.
- Add update signing, integrity verification, backup and rollback.
- Add permission-gated Android actions and offline voice.
- Validate on the target Android device for RAM, thermal load, battery and storage behavior.
