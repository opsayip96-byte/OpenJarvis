# Android and Termux setup

This setup runs the existing OpenJarvis API and PWA on the phone. The API must
stay bound to loopback when using the unauthenticated local setup.

## Start the API

In the Debian PRoot, from the project checkout:

```sh
cd /root/OpenJarvis
source .venv/bin/activate
uv run --with maturin maturin develop -m rust/crates/openjarvis-python/Cargo.toml
jarvis serve --host 127.0.0.1 --port 8000 --engine cloud --model openrouter/free --agent orchestrator
```

The `maturin develop` step installs the repository's existing ARM64 SQLite
memory extension into the project venv. It requires the Rust toolchain and is
needed only when `openjarvis_rust` is not importable in that venv.

Use the existing OpenRouter credential already configured in the environment.
Do not paste it into frontend files or share it with the browser. Confirm the
server with `curl --max-time 10 http://127.0.0.1:8000/health`.

Stop the foreground server with `Ctrl-C`. If it was started in the background,
stop only that process with `kill <server-pid>`.

## Open the interface

Build the frontend from `frontend/` with the Node and npm versions declared in
`frontend/package.json`, then start the API as above. The Vite production build
is written to `src/openjarvis/server/static` and is served by FastAPI. Open
`http://127.0.0.1:8000/` in Android Chrome, then use Chrome's menu → **Add to
Home screen** (or **Install app** when offered). The service worker and manifest
are included in the production build.

The production bundle is a generated, ignored build artifact. Rebuild it after
frontend changes before restarting the server. A development-only alternative
is Vite's dev server, with its API URL set to `http://127.0.0.1:8000`; that dev
server is not installable as the production PWA.

## Phone features and permissions

Browser speech recognition is used when the browser exposes it. Otherwise the
chat offers microphone recording and server transcription, which requires a
configured speech backend. Read-aloud uses server TTS when available, then the
browser's built-in speech synthesis. Voice ID and speed are configurable in
Settings. The browser asks for microphone permission when recording begins.

No Termux:API commands were present in the inspected environment. Battery,
notifications, clipboard, camera, location, app launching, and device automation
therefore remain unavailable here. They require an installed and explicitly
permitted Termux:API companion plus a separately implemented local bridge; the
cloud model has no direct access to phone hardware.

## Expose the API beyond the phone

Do not change the loopback host casually. For another device or a public host,
configure `OPENJARVIS_API_KEY`, require HTTPS at the reverse proxy, and bind only
behind that protected proxy. The app's API key setting is stored in browser
local storage, so use it only on a device you control and do not include it in a
public frontend build.
