#!/bin/sh
set -eu

echo "[OpenJarvis startup] diagnostic entrypoint reached"
echo "[OpenJarvis startup] uid: $(id -u), workdir: $(pwd)"
echo "[OpenJarvis startup] jarvis executable: $(command -v jarvis || echo MISSING)"
echo "[OpenJarvis startup] OPENROUTER_API_KEY present: ${OPENROUTER_API_KEY:+yes}"
echo "[OpenJarvis startup] OPENJARVIS_API_KEY present: ${OPENJARVIS_API_KEY:+yes}"
echo "[OpenJarvis startup] PORT: ${PORT:-unset}"

python - <<'PY'
import importlib.util
for name in ("openjarvis", "uvicorn", "fastapi", "openai", "openjarvis_rust"):
    try:
        print(f"[OpenJarvis startup] module {name}: {'available' if importlib.util.find_spec(name) else 'MISSING'}", flush=True)
    except Exception as exc:
        print(f"[OpenJarvis startup] module {name}: CHECK FAILED ({type(exc).__name__})", flush=True)
PY

echo "[OpenJarvis startup] executing: jarvis $*"
exec jarvis "$@"
