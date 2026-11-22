# Needle 3 on JARVIS Android

This branch adds an ARM64-only local Needle 3 inference bridge to the existing Capacitor Android app. It keeps the existing JARVIS native plugin and JARVIS-Nano workflow intact.

## What it does

- Builds the Cactus Android ARM64 engine from the pinned `cactus-compute==4.2.6` distribution.
- Links the Android static engine into a JNI bridge using the Android NDK.
- Registers a separate Capacitor plugin named `NeedleNative`.
- Downloads the Needle 3 `.cact` weights into the app private files directory.
- Loads the model into native memory and exposes local completion to the Settings screen.
- Runs inference on-device after the model is downloaded. The model is not bundled inside the APK.

Needle 3 is optimized for tool selection, structured extraction and embeddings. It is a specialist local tool-routing brain, not a replacement for JARVIS-Nano general conversational role. In this first integration, proposed tool calls are displayed for inspection and are not executed automatically.

## Build and download

The GitHub Actions workflow builds the ARM64 debug APK and publishes it together with the standalone model as one 30-day artifact:

- [Open the JARVIS Needle 3 Android workflow](https://github.com/opsayip96-byte/OpenJarvis/actions/workflows/jarvis-needle3-android.yml)

After a successful run, open its **Artifacts** section and download `JARVIS-Needle3-Android-arm64`. It contains:

- `JARVIS-Needle3-Android-arm64-debug.apk`
- `needle3.cact`

The model can also be downloaded directly from [Cactus-Compute/needle3 on Hugging Face](https://huggingface.co/Cactus-Compute/needle3).

## On-device use

1. Install the ARM64 APK on the Android phone.
2. Open **Settings → Needle 3 Local Brain**.
3. Tap **Download model**. This stores the weights inside the app private storage.
4. Tap **Load into RAM**.
5. Enter a prompt and tap **Run local test**.

The model must be downloaded once. Later inference can run offline. Loading the model uses additional RAM; close other heavy apps if the phone reports memory pressure.

## Native build layout

- `frontend/android/app/src/main/cpp/needle_jni.cpp`: JNI wrapper for the Cactus C ABI.
- `frontend/android/app/src/main/cpp/CMakeLists.txt`: links the Android ARM64 static library.
- `frontend/android/app/src/main/java/com/openjarvis/jarvis/NeedleNativePlugin.java`: download, load, status and inference methods.
- `frontend/src/lib/needle-native.ts`: Capacitor TypeScript bridge.
- `frontend/src/components/settings/NeedleLocalSection.tsx`: model controls and local test console.

The build workflow downloads the matching `libcactus.a`, `cactus.h` and `needle3.cact` from the Cactus distribution at build time. The binary weights and engine are not committed to Git history.
