# Deploy on Render

The repository's `render.yaml` is a minimal Render Blueprint for the
OpenJarvis API server. It builds `deploy/docker/Dockerfile`, binds the server to
Render's default web-service port (`10000`), and routes chat through the
configured `openrouter/free` model.

## Create the service

1. Open Render's **New Blueprint Instance** flow and select your OpenJarvis
   fork.
2. Provide `OPENROUTER_API_KEY` when Render asks for the Blueprint secret.
3. Apply the Blueprint and wait for `/health` to become healthy.
4. Retrieve the generated `OPENJARVIS_API_KEY` from the Render dashboard and
   send it as `Authorization: Bearer <key>` with API requests.

The Blueprint pins both the `PORT` environment variable and the server's
`--port` argument to `10000`. Render's Docker command does not expand `$PORT`,
so if you customize the service port, update both values in `render.yaml`.

The Blueprint requires only the OpenRouter key. It does not configure a paid
provider. The free Render filesystem is ephemeral, so this deployment is for
evaluation only and cannot provide durable personal memory or conversation
history across restarts; use a persistent host before relying on that state.

## Storage and free-instance limits

!!! warning "Free instances do not preserve OpenJarvis data"
    Render's free web-service filesystem is ephemeral. Everything written to
    `/home/openjarvis/.openjarvis` — including configuration, credentials,
    connector tokens, local databases, and learned state — is lost whenever
    the service restarts, spins down, or redeploys. Free instances also spin
    down after periods without inbound traffic and are not suitable for
    production or durable personal-assistant state.

Do not use this free deployment for personal data or durable memory. For a
no-cost durable deployment, run the container on hardware you control with a
persistent volume mounted at `/home/openjarvis/.openjarvis`. A free external
host with persistent storage could also work, subject to that host's current
limits. The service remains portable because the state path is configurable;
do not assume a free cloud instance preserves it.

The Blueprint intentionally does not declare a disk because Render does not
support persistent disks on free services. No service is deployed by this
configuration; creating a Render service still requires your account action.
