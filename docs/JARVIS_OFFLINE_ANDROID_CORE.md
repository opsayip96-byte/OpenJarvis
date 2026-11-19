# JARVIS Offline Android Core: Architecture Decision

Status: Proposed implementation baseline
Target device: iQOO Neo 10R, 8 GB physical RAM, 256 GB storage
Branch: jarvis-offline-android-core
Production impact: none. This branch is isolated from Render's deployed backend.

## Product requirement

JARVIS must be able to load its language model, hold a conversation, retrieve local memories, plan tasks, and execute approved on-device tools with Wi-Fi and mobile data disabled. Cloud providers and Render are optional add-ons only. The APK must never silently fall back to a remote model when Offline Mode is selected.

This is a practical local assistant, not a claim of sentience, consciousness, unlimited intelligence, or fictional omnipotence.

## Model decision

Primary candidate: Qwen3.5-4B in a 4-bit GGUF quantization (Q4_K_M where available), downloaded separately after installation.

Why: a current compact general-purpose model with reasoning and multilingual capability is a better single-model starting point than a tiny router-only model. The model file is not bundled in the APK, to avoid a multi-gigabyte install and allow model updates independently.

Important memory constraint: 8 GB is total device RAM, not an 8 GB model budget. Begin with a 2,048-token context, memory-mapped weights where supported, bounded KV cache, one active model, and no concurrent large model. Benchmark cold load, peak resident memory, tokens/second, heat, battery and Android process survival before making 4B the default.

Fallback if Qwen3.5-4B exceeds safe memory/thermal limits: Qwen3.5-2B Q4. A small fast routing model may be considered later, but do not ship multiple resident LLMs initially.

Model licensing and exact downloadable artifact must be verified at model selection time. Store model ID, source, revision, license, quantization and SHA-256 in a signed/verified model manifest. Never download an arbitrary model URL supplied by a chat prompt.

## Runtime decision

First implementation runtime: llama.cpp Android arm64 native library, integrated through a Capacitor Android plugin/JNI boundary.

- Start with a portable CPU build for correctness and broad compatibility.
- Enable Arm KleidiAI where supported by the NDK build.
- Treat Vulkan/OpenCL/Qualcomm Hexagon/NPU acceleration as optional backends discovered and benchmarked on the actual iQOO. Do not assume Adreno 735 or this firmware supports a particular backend.
- Keep the inference interface independent of the runtime so LiteRT-LM can be evaluated later against the same offline tests.
- Never require Termux, a localhost server, Render, or an external API for normal offline chat.

## Android app architecture

1. Model Manager: model catalogue, explicit download consent, resumable download, free-space check, checksum verification, delete/switch model.
2. LocalInferenceService: app-private model path, single model lifecycle, streaming token output, cancellation, memory limits, thermal-aware generation.
3. JARVIS Orchestrator: system persona, bounded planning loop, tool registry, typed arguments, permission checks, result verification, safe retry limits.
4. Local Memory: encrypted/private SQLite store for conversation metadata and user-approved durable facts; FTS search first, optional local embeddings later.
5. Device Tools: explicit native capabilities such as app launch, timers, reminders, approved file search and selected settings intents. Each tool declares permissions and risk level. Consequential actions require confirmation.
6. Offline Voice: offline speech-to-text and on-device TTS where available; user-visible microphone permission and push-to-talk first. Wake-word listening is a later opt-in due to battery and background restrictions.
7. Connectivity Policy: Offline Mode blocks all model/chat HTTP requests. Cloud mode is separately selected and clearly labelled. Local memory and tool execution remain local in either mode.

## Security and privacy

- Model files and personal memory stay in app-private storage by default.
- No secrets in JavaScript bundles, logs, prompts, analytics or model manifests.
- No arbitrary shell execution, unrestricted accessibility service, silent SMS/calls, purchases, payments, account changes, or destructive file operations.
- Request Android permissions only when a feature is enabled and explain why.
- Use Android Keystore for encryption keys where appropriate.
- Redact personal data from diagnostic exports.

## Build sequence

### Phase 1: local inference proof
- Add native llama.cpp runtime and a minimal Kotlin plugin API: getRuntimeStatus, listModels, downloadModel, loadModel, unloadModel, generate, cancelGeneration.
- Add a model manager screen and Qwen3.5-4B Q4 candidate manifest.
- Test with network disabled after model download.
- Add a smaller fallback model option.

### Phase 2: actual JARVIS orchestration
- Replace the cloud-only chat path with a Local/Cloud engine interface.
- Implement local system prompt, streaming, conversation history and explicit memory retrieval.
- Add a small typed tool loop with allowlisted tools, bounded steps and result verification.
- Display which engine is active and which tools are truly installed.

### Phase 3: offline voice and Android tools
- Integrate offline speech recognition and local TTS.
- Add permission-controlled device integrations.
- Add foreground service only for user-enabled ongoing sessions; respect Android battery/background limits.

### Phase 4: release hardening
- Test airplane-mode conversation, app restart, phone restart, memory persistence, cancellation, low-storage recovery, model corruption, thermal throttling, battery use and process death.
- Produce debug APK and device-specific benchmark report.
- Keep Render and cloud model paths unchanged until local mode passes acceptance tests.

## Acceptance criteria

- First-time model download is explicit, resumable and checksum-verified.
- Once downloaded, chat works in airplane mode after force-stop and relaunch.
- No HTTP request is made for local inference or local memory in Offline Mode.
- Local chat can retrieve an approved memory after app restart.
- Tool calls are typed, allowlisted, permission-checked and result-verified.
- The UI never claims a tool or device permission exists unless the native plugin confirms it.
- Model load failure, low memory, thermal limits and cancellation are surfaced clearly without corrupting history.
- The app reports measured model name, quantization, runtime backend, context limit and performance on the actual device.

## References

- llama.cpp Android integration: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md
- llama.cpp Android build and KleidiAI guidance: https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md
- llama.cpp Qualcomm/OpenCL support matrix: https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md
- Google LiteRT-LM: https://developers.google.com/edge/litert
- Candidate model comparison (secondary source, verify model card before download): https://llm.chinesepowered.com/blog/best-open-source-llms-for-phones/

## Rollout guardrails

Do not merge this branch into the Render production branch or change production environment variables as part of the offline implementation. Do not add paid services. Do not bundle a multi-gigabyte model in the APK. Do not claim offline capability until the airplane-mode acceptance test passes on the target phone.
