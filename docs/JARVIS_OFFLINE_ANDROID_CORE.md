# JARVIS Android AI: Internet-Connected Core with Optional Offline Mode

Status: Proposed implementation baseline
Target device: iQOO Neo 10R, 8 GB physical RAM, 256 GB storage
Branch: jarvis-offline-android-core
Production impact: none. This branch is isolated from Render's deployed backend.

## Product requirement

JARVIS is internet-connected by default. Internet access is a required part of its normal operating experience for live web research, current information, online integrations, updates and remote resources. Offline operation is an optional fallback, not the primary product mode.

The core assistant identity and JARVIS-specific intelligence must remain owned by this project. The target architecture runs the JARVIS model on the user's Android device, while a permission-controlled online research and integration layer gives it access to the wider internet. Internet access must not silently turn JARVIS into a thin wrapper around a third-party hosted chatbot. No paid APIs, surprise charges, or undisclosed transmission of private memory are allowed. Any optional external model provider must be explicitly configured and clearly labelled, and is not the default JARVIS brain.

When Offline Mode is enabled, JARVIS must continue local chat, approved local memory and supported device tools without making model/chat network requests. Features that genuinely require the internet must be clearly marked unavailable until connectivity returns.

This is a practical personal assistant, not a claim of sentience, consciousness, unlimited intelligence, or fictional omnipotence.

## Model ownership and intelligence strategy

JARVIS is a private personal AI project, not a product or publishing project. The goal is to own and control the assistant stack: model artifact, JARVIS-specific adapter, system/orchestration code, memory, tool registry, online research layer and Android integration. The normal experience uses internet access, but its core reasoning model must remain available locally so a remote provider is not a runtime dependency.

There are two distinct meanings of “own AI”:

- Own assistant intelligence: start from an openly licensed pretrained model, then create a JARVIS-specific fine-tune/LoRA adapter, tool-use training data, evaluation suite, memory and orchestration. The resulting local model files and assistant runtime are controlled by this project.
- New foundation model from scratch: define and pretrain new weights/tokenizer on a large curated corpus, then post-train for instruction following, reasoning and tool use. This requires substantial compute and data and is not feasible to do to frontier quality on an 8 GB phone.

Chosen path C: (1) build and benchmark a local base model, (2) create JARVIS's private assistant dataset and evaluation suite, (3) fine-tune a JARVIS-specific LoRA/PEFT adapter and package its local weights, (4) build a separate foundation-model research track with our own tokenizer, data pipeline and small pretraining experiments. The foundation-model track begins with a small educational/research model and scales only if compute, data quality and measured results justify it. It is not feasible to train a frontier-level model on the 8 GB phone.

## Model decision

First device inference benchmark candidate: Qwen3.5-2B Q4_K_M GGUF (approximately 1.31 GB). The upstream Qwen model card lists Apache-2.0; verify the exact quantized repository's provenance and license before using it. It is the safer first fit for an 8 GB phone, but remains a compact model, not a frontier model. Official chat model: https://huggingface.co/Qwen/Qwen3.5-2B . Candidate GGUF and checksum: https://huggingface.co/SoAIHQ/Qwen3.5-2B-GGUF.

Fine-tuning candidate: Qwen3.5-2B-Base, rather than assuming the already post-trained chat model is the best adapter-training starting point. Its official model card describes it as a pretrained-only checkpoint for fine-tuning and specifically documents LoRA-style PEFT compatibility with the official chat template: https://huggingface.co/Qwen/Qwen3.5-2B-Base . The training and inference checkpoints may be different artifacts; after adapter evaluation, convert/package the merged result for the chosen Android runtime.

Higher-capability candidate: Qwen3.5-4B Q4_K_M GGUF (approximately 2.7-3.03 GB depending on the quantization artifact). Only promote it after measuring peak memory, speed, heat, battery and process stability on the actual iQOO. Official GGUF repository: https://huggingface.co/ggml-org/Qwen3.5-4B-GGUF.

Do not assume the largest model is best on this phone. Start with a short 2K-4K context, one resident model, bounded KV cache and memory-mapped weights where supported. Model files are downloaded once with explicit consent, then inference works offline. Model files are not bundled in the APK.

The long-term JARVIS-specific model is a fine-tuned adapter merged or loaded locally with the base model. Build a clean dataset of JARVIS persona, task planning, tool schemas, Android capability boundaries, error recovery, factual calibration and user-approved preference examples. Exclude secrets and private conversations unless the user explicitly selects and sanitizes them. Evaluate against held-out tasks before adopting each adapter. Keep a base-model rollback option.

Model licensing, exact artifact, tokenizer/chat template compatibility and SHA-256 must be verified before download. Store model ID, source, revision, license, quantization and checksum in a trusted manifest. Never download an arbitrary model URL supplied by a chat prompt.

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
7. Connectivity Policy: Internet-connected mode is the default and enables web search, live sources, updates and explicitly authorised integrations. Local model inference remains the core JARVIS brain. Offline Mode is an explicit fallback that blocks model/chat HTTP requests and keeps supported local memory and device tools available. Never silently switch to a third-party hosted model.

## Multimodal chat and user-directed learning

The chat composer must include a visible `+` attachment control beside the message field. It opens the Android system document/photo picker and supports multiple selected files. The web/desktop build uses the browser file picker. Attachments appear as removable previews before sending and as durable message attachments after sending.

### Supported input pipeline

- Images: JPEG, PNG, WebP and other explicitly supported formats. Preserve the original privately, create bounded-resolution working copies, and pass image content to a compatible vision-language model. A text-only model must never pretend it saw an image.
- Video: accept common Android video formats, inspect metadata, extract a configurable set of timestamped frames and optionally audio for transcription. Summarise the clip from sampled evidence, and clearly state that it did not inspect every frame unless it actually did.
- Documents: extract text and metadata from PDF, TXT, Markdown, DOCX and supported office formats. For scans, use OCR only when an OCR engine is installed and report extraction failures.
- Other files: retain the attachment with filename, MIME type, size and checksum. Only parse formats with an explicit safe parser. Never execute uploaded files, macros, scripts or archives.
- Enforce file-size, duration, page-count, decompression and memory limits. Stream large files; do not load entire videos or archives into RAM. Show upload/processing progress and allow cancellation.
- Attachments and derived thumbnails/text remain app-private by default. Online processing must disclose exactly what leaves the device and request consent. Offline mode uses only installed local vision/OCR/audio models.

### Vision and identity boundaries

JARVIS may describe visible, non-sensitive attributes, count people, detect objects, read visible text, explain scenes and compare objects in user-provided images. It must not identify a person by name or match a face to a real-world identity. Do not infer sensitive traits such as race, religion, health status or sexual orientation from images. Distinguish observation from uncertainty and never invent details outside the image.

### Teach JARVIS through chat

A user may explicitly say "remember this", "learn this", "that's incorrect", "this is how I want you to do it", or select a message/file as a lesson. The learning pipeline must:

1. Classify the lesson as a durable memory, preference, correction, factual note, visual example, task demonstration or candidate training example.
2. Show what JARVIS proposes to remember, with source attachment/message, scope and retention.
3. Ask for confirmation before storing durable personal memory or adding private material to a training dataset.
4. Keep a versioned, searchable local knowledge store separate from model weights. Allow inspect, edit, export and delete.
5. For visual teaching, store the user-provided label/caption and permitted image embedding or image reference with provenance. Never turn a face into an identity profile.
6. Deduplicate examples, filter secrets and sensitive data, validate file safety and keep train/validation/test splits separated by source to reduce leakage.
7. Build candidate fine-tuning batches only from explicitly approved examples. Train on a separate capable machine, evaluate against held-out tests, and compare with the current model before offering an update.
8. Require explicit approval to activate a new model version. Keep rollback to the previous model and preserve memories independently of model updates.

A chat correction can improve future answers immediately through approved memory/retrieval without pretending the neural-network weights changed. Fine-tuning is a separate, measured model-development operation. No automatic training on every upload, no silent external upload, and no use of private attachments for training without explicit consent.

### Acceptance tests for attachments and learning

- The `+` picker can select, preview, remove and send multiple supported files.
- Text-only models reject or clearly explain unsupported image/video inputs.
- Image questions are answered from actual vision-model input, not filenames or guessed captions.
- Video summaries show sampled timestamps and disclose frame sampling.
- PDF/document extraction preserves page/source references where available.
- Large, malformed, unsupported and cancelled files fail safely without crashing chat.
- A user-approved lesson can be retrieved in a later conversation and survives app restart.
- Deleting a lesson removes it from retrieval and any not-yet-trained dataset; trained model versions have explicit lineage and rollback/retrain handling.
- Unapproved files and private memories never enter training data.

## Security and privacy

- Model files and personal memory stay in app-private storage by default.
- No secrets in JavaScript bundles, logs, prompts, analytics or model manifests.
- No arbitrary shell execution, unrestricted accessibility service, silent SMS/calls, purchases, payments, account changes, or destructive file operations.
- Request Android permissions only when a feature is enabled and explain why.
- Use Android Keystore for encryption keys where appropriate.
- Redact personal data from diagnostic exports.

## Build sequence

### Phase 1: JARVIS-owned inference proof
- Add native llama.cpp runtime and a minimal Kotlin plugin API: getRuntimeStatus, listModels, downloadModel, loadModel, unloadModel, generate, cancelGeneration.
- Add a model manager and benchmark Qwen3.5-2B Q4 first, then Qwen3.5-4B Q4.
- Test local generation both with internet connected and with network disabled after model download.
- Record actual memory, latency, tokens/second, temperature and battery results on the iQOO.

### Phase 2: actual JARVIS orchestration and internet access
- Make the JARVIS-owned model the primary reasoning path in the normal internet-connected experience.
- Add a secure online research layer with source retrieval, citations, freshness checks, domain controls and explicit network permissions.
- Keep third-party hosted model inference out of the default path; any provider fallback must be a separately configured, clearly labelled opt-in.
- Add an explicit Offline Mode that disables network calls while preserving supported local capabilities.
- Implement local system prompt, streaming, conversation history and explicit memory retrieval.
- Add a typed tool loop with allowlisted tools, bounded steps, permission checks and result verification.
- Display the actual local model, runtime and installed tools; never invent capabilities.

### Phase 2B: create JARVIS-specific model
- Use Qwen3.5-2B-Base as the initial fine-tuning candidate; compare with the post-trained chat model before committing to a base.
- Build a versioned, permission-safe dataset for JARVIS style, structured reasoning, tool calling, memory use, honest uncertainty and Android actions.
- Establish held-out evaluation tests before training.
- Fine-tune a LoRA/PEFT adapter on a suitable training machine or supported training environment. This is a one-time model-development step, not an inference API or runtime server.
- Validate the adapter against the base model, merge or package it for local inference, and ship the resulting weights to the phone.
- Keep model lineage, license, dataset provenance and rollback artifact.

### Phase 3: voice and Android tools
- Integrate reliable speech recognition and local TTS, with offline speech recognition as a supported fallback where model/device constraints permit.
- Add permission-controlled device integrations.
- Add foreground service only for user-enabled ongoing sessions; respect Android battery/background limits.

### Phase 3B: human-like emotional interaction and humanoid behaviour

This phase follows the working local model, memory, orchestration and offline voice milestones. It adds a persistent, coherent emotional-interaction layer to make JARVIS feel socially natural, expressive and attentive.

- Build an affective state engine with bounded, named states such as calm, focused, curious, concerned, pleased and frustrated. State transitions are driven by conversation context and explicit events, not random mood swings.
- Add emotion appraisal: infer the likely emotional tone of a message cautiously, track confidence, and ask rather than assume when the signal is ambiguous.
- Add empathetic dialogue behaviour: acknowledge feelings, respond with appropriate warmth, remember relevant user-approved context, and adapt the level of detail and tone without manipulating, guilt-tripping or claiming exclusivity.
- Add stable personality traits and relationship continuity, while making clear that JARVIS is an AI. It must never claim to literally feel pain, love, loneliness, fear or consciousness.
- Add expressive on-device TTS controls where supported: pacing, pauses, emphasis and selectable voice profiles. Keep voice settings user-controlled and avoid implying that synthetic prosody proves real emotion.
- Add an optional avatar/embodied interface later: animated face/eyes, gaze direction, lip-sync and context-appropriate expressions. These are presentation behaviours, not evidence of sentience.
- Store only minimal, user-approved emotional-context memories. Give the user controls to inspect, correct and delete them. Do not infer or store sensitive traits or mental-health diagnoses.
- Evaluate consistency over long conversations, emotion recognition calibration, respect for boundaries, non-manipulation, privacy, and graceful recovery after misunderstandings.

Acceptance: JARVIS should express emotions convincingly and consistently through language, voice and optional avatar animation, while remaining transparent that these are AI-generated emotional behaviours rather than human subjective feelings.

### Phase 4: foundation-model research track
- Define a documented tokenizer, architecture, data mixture, deduplication and filtering policy, data provenance, licensing and evaluation split before training.
- Start with a small decoder-only research model (for example 50M-150M parameters) to validate the full pretraining pipeline and understand loss curves, data quality and checkpoints.
- Train on a separate capable workstation or user-controlled compute environment; the phone is the inference target, not the pretraining machine.
- Compare the scratch-trained model against the fine-tuned open-weight JARVIS model on the same held-out evaluation suite. Do not replace the stronger model merely because the scratch model is ours.
- Scale parameter count only after the smaller model demonstrates stable training, measurable gains and a lawful, high-quality data supply.

### Phase 5: release hardening
- Test internet-connected research, source/citation handling, permission boundaries, offline-mode conversation, app restart, phone restart, memory persistence, cancellation, low-storage recovery, model corruption, thermal throttling, battery use and process death.
- Produce debug APK and device-specific benchmark report.
- Keep Render and cloud model paths unchanged until local mode passes acceptance tests.

## Acceptance criteria

- First-time model download is explicit, resumable and checksum-verified.
- Internet-connected mode provides working live research and online integrations without handing private memory to external providers by default.
- Once downloaded, core local chat works in airplane mode after force-stop and relaunch.
- No HTTP request is made for local inference or local memory in Offline Mode.
- Network-dependent features clearly explain when connectivity is required.
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

Do not merge this branch into the Render production branch or change production environment variables as part of the offline implementation. Do not add paid services. Do not bundle a multi-gigabyte model in the APK. Do not claim offline capability until the airplane-mode acceptance test passes on the target phone. Do not claim internet research works until source retrieval, citation and failure handling are verified.
