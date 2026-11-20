# Android Qwen Model Library and Local AI Design

## Intent
Extend the existing OpenJarvis Android app so users can discover compatible Qwen GGUF releases, inspect device fit, download models into app-private storage, verify them, register them in a persistent local library, and select them for the existing llama.cpp runtime. Preserve the current app, private learning system, conversation store, and training pipeline.

## Goals
- Query Hugging Face's public model metadata without credentials and filter for Qwen GGUF files.
- Display model/repository, quantization, file size, checksum availability, and conservative device suitability.
- Require an explicit user tap before any model download; show large downloads clearly.
- Download into app-private storage with resumable/retry-capable transfer and integrity checks when repository metadata supplies SHA-256.
- Maintain multiple registered local models and activate one without re-importing it.
- Keep local inference offline after download and honor the user's selected model.
- Preserve existing manually imported GGUF as a library entry during migration.

## Non-goals
- No paid inference or API keys required for local chat.
- No cloud database, Vercel service, Supabase service, or hosted inference.
- No automatic downloading of models at startup.
- No claim of Qwen compatibility based on repository name alone; validate GGUF header and test load.
- No GPU acceleration claim. Current Android llama.cpp integration is CPU-only.
- No full on-device LoRA fine-tuning; the current Android runtime is inference-only.

## Approaches
1. Use a hosted backend for discovery/download orchestration. Rejected because it adds cloud dependency, cost/privacy surface, and breaks offline-first goals.
2. Fetch public Hugging Face metadata in the app and use a native Android downloader + app-private model library. Selected because it keeps model bytes and inference local, avoids new paid services, and fits the existing Capacitor/Java/JNI architecture.
3. Fetch large GGUF files through browser JavaScript. Rejected because large binary downloads are fragile in a WebView and cannot provide reliable native background transfer.

## Architecture
- TypeScript Hugging Face catalogue service queries public Hub APIs, parses model card metadata and GGUF sibling file metadata, and estimates device fit using conservative RAM/storage heuristics.
- A new Capacitor Android plugin owns the model library and native download lifecycle. Downloads target app-private model storage, never public shared storage.
- A persistent manifest maps model IDs to filenames, sizes, quantization, source URLs, expected hashes, actual hashes, and verification state.
- Existing llama.cpp JNI engine remains the inference runtime. The active model path comes from the library manifest rather than a single hard-coded active-model.gguf.
- Existing manual file picker remains supported and adds imported files as library entries.
- App UI surfaces discovery, explicit download confirmation, progress/status, installed library, activation, and removal.
- Model selection remains explicit. Automatic recommendation suggests a model but never silently downloads or switches it.

## Device policy
Target device: iQOO Neo 10R, 8 GB physical RAM, 256 GB storage, Android 16, ARM64.
- Recommend small Qwen GGUF Q4 variants first, typically 0.5B-1.7B/2B class when quantized.
- Treat 4B as conditional and larger models as not recommended by default on an 8 GB device.
- Reserve RAM for Android, WebView, and context/KV cache; model file size is not equal to runtime RAM use.
- Require sufficient free storage for the full download plus temporary file and safety margin.
- Default context stays conservative until on-device profiling proves otherwise.

## Safety and privacy
- Hugging Face public metadata and model file downloads are network operations only when the user opens discovery or explicitly downloads.
- Never download on startup or automatically select an unverified file.
- Verify GGUF magic header, file length, and SHA-256 when a trustworthy expected digest is available.
- Keep models under app-private storage. Never execute model files as code.
- Do not send prompts, conversation history, or memory to Hugging Face.
- Preserve explicit consent and user control for deletion and model activation.

## Acceptance criteria
- Public Qwen GGUF discovery handles empty, malformed, rate-limited, and offline responses.
- A user can inspect quantization, file size, RAM/storage estimate and suitability before download.
- Downloads can be monitored and retried; incomplete files never appear as installed models.
- A verified download becomes selectable from the model selector without manual import.
- Multiple local model entries persist across app restarts and catalogue refreshes.
- Selecting a local model loads its registered path; selecting a remote/server model does not route through local inference.
- Android CI compiles the APK and TypeScript/unit tests pass.
- Device runtime, sustained download/resume, memory pressure and thermal behavior remain explicitly unverified until tested on the iQOO device.
