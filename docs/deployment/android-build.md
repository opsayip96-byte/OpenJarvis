# Android APK build

`frontend/android` is a native Capacitor Android application (package
`com.openjarvis.jarvis`) that packages the React interface into an Android app.
The web assets are rebuilt and synchronized during CI; they are not loaded from
Chrome or from a local development server. Chat still requires a reachable
OpenJarvis backend. Set its HTTPS URL in the app's Settings before using chat.
The APK contains no OpenRouter key.

The workflow at `.github/workflows/android-build.yml` builds a debug APK on a
hosted Ubuntu runner and uploads it as the `jarvis-android-debug` artifact.
It runs for changes under `frontend/`, pull requests, and manual workflow
dispatch. Download `app-debug.apk` from the completed run's Artifacts section
and install it on the phone. This debug build is unsigned for Play Store
distribution and is intended for direct testing.

This repo is currently read-only to the available GitHub account. The workflow
cannot run until a user with write access pushes these changes to the existing
repository (or opens a PR from a writable fork). No build result or APK is
claimed until a hosted run completes successfully.
