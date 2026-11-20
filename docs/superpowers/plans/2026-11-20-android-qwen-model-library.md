# Android Qwen Model Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add an Android-native, private, multi-model GGUF library with Hugging Face Qwen GGUF discovery, explicit downloads, integrity checks, and automatic model registration.

**Architecture:** TypeScript handles public Hugging Face discovery and device-fit estimates. A Capacitor Java plugin handles private model storage and native background-capable downloads. The existing llama.cpp runtime consumes the selected library entry; manual import remains compatible.

**Tech Stack:** React 19, TypeScript, Vitest, Capacitor 7.6.10, Android Java, Android DownloadManager, llama.cpp.

**Spec:** docs/superpowers/specs/2026-11-20-android-qwen-model-library-design.md

## Global Constraints
- No paid API, cloud inference, cloud database, or unexpected billing.
- Never download or switch models without an explicit user action.
- Store model files in app-private storage only.
- Preserve existing import, local learning, conversations, and inference.
- Target ARM64 Android and 8 GB RAM; use conservative recommendations.
- Validate GGUF header and verify SHA-256 when available.
- Do not claim device runtime success from CI compilation.

## Review Focus
- Hugging Face metadata omits file sizes or checksums: show unknown values and do not invent them.
- A download is interrupted or process is killed: incomplete files must not appear installed.
- A file with valid extension but invalid GGUF header: reject it.
- A user switches from local to remote model: local engine must not intercept remote requests.
- Insufficient storage or low RAM: block or warn before downloading/loading.

---

### Task 1: Hugging Face Qwen GGUF catalogue

**Files:**
- Create: `frontend/src/lib/huggingface-models.ts`
- Create: `frontend/src/lib/huggingface-models.test.ts`

**Interfaces:**
- Produces `searchQwenGgufModels(query?: string, signal?: AbortSignal): Promise<DiscoveredGgufModel[]>`
- Produces `estimateAndroidModelFit(model: DiscoveredGgufModel, device: DeviceProfile): ModelFit`
- A discovered model includes repo ID, file name, quantization, byte size (nullable), SHA-256 (nullable), download URL, and licence/revision metadata when provided.

- [ ] Write tests for filtering Qwen GGUF, quantization parsing, unknown metadata, and conservative fit for 8 GB RAM.
- [ ] Run the new test file and observe failures.
- [ ] Implement Hub API calls with bounded results, abort support, validation and graceful handling of missing file metadata.
- [ ] Run tests and frontend typecheck.

### Task 2: Native private model library

**Files:**
- Create: `frontend/android/app/src/main/java/com/openjarvis/jarvis/JarvisModelLibraryPlugin.java`
- Modify: `frontend/android/app/src/main/java/com/openjarvis/jarvis/MainActivity.java`
- Modify: `frontend/src/lib/local-model.ts`
- Modify: `frontend/android/app/src/main/java/com/openjarvis/jarvis/JarvisLocalModelPlugin.java`

**Interfaces:**
- Native methods: `listModels()`, `startDownload({id,url,fileName,expectedSha256})`, `getDownloadStatus({downloadId})`, `cancelDownload({downloadId})`, `activateModel({modelId})`, `getActiveModel()`, `removeLibraryModel({modelId})`.
- Manifest records model ID, safe filename, size, SHA-256, source, verification and active state.
- Incomplete downloads use a temporary suffix and are never listed as ready.

- [ ] Add tests for manifest parsing/filename validation and download status mapping where testable.
- [ ] Run tests and observe failures.
- [ ] Implement native download lifecycle using Android DownloadManager, app-private external files directory, status polling, checksum verification and GGUF header validation.
- [ ] Register completed models atomically in the manifest; retain current single-file import as a library entry.
- [ ] Register plugin and run Android build.

### Task 3: Model discovery and library UI

**Files:**
- Modify: `frontend/src/components/CommandPalette.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/lib/local-model.ts`
- Create/update relevant UI tests.

**Interfaces:**
- Catalogue tab loads Hugging Face Qwen GGUF results and displays file/quantization/size/fit.
- Download requires explicit tap and displays native download status.
- Completed model appears in installed model list and can be selected without import.
- Existing local model selection remains compatible.

- [ ] Write UI/service tests for discovery states, explicit download action, and installed model registration.
- [ ] Run tests and observe failures.
- [ ] Implement discovery, download progress/status, installed library, activation and deletion UI.
- [ ] Run frontend tests and typecheck.

### Task 4: Selected-model inference integration and verification

**Files:**
- Modify: `frontend/src/lib/sse.ts`
- Modify: `frontend/src/lib/jarvis-inference.ts`
- Modify: `frontend/android/app/src/main/java/com/openjarvis/jarvis/JarvisInferencePlugin.java`
- Add or update regression tests.

**Interfaces:**
- Local chat resolves the active model path from the library.
- Switching local model unloads the previous model before loading the selected one.
- Non-local model IDs continue through the existing backend route.
- Local load/generation failures surface as errors, never silent success.

- [ ] Write regression tests for selected local vs remote routing and missing model.
- [ ] Run tests and observe failures.
- [ ] Implement selected-library model resolution and safe engine switching.
- [ ] Run full frontend tests, build frontend, sync Android, assemble debug APK.
- [ ] Inspect workflow result and artifact metadata; report CI separately from physical-device validation.

## Deferred after this milestone
- True pause/resume controls beyond DownloadManager's OS-managed retry behavior, if native DownloadManager cannot safely expose pause/resume.
- Advanced model recommendation using measured runtime profiling.
- Token streaming from JNI (current native API returns a complete string).
- Automatic LoRA training and in-place weight updates. Current Android engine is inference-only; fine-tuning requires a separate training runtime and safe model swap.
- Qwen multimodal support; current JNI path is text-only.
