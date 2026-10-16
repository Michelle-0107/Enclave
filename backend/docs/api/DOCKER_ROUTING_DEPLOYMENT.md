# Docker routing runtime: API and private Valhalla in one container

## Problem

The original Dockerfile uses Python 3.11 and starts only `uvicorn main:app`.
The API's routing origin is `http://127.0.0.1:8002`, which means the container itself,
not a developer's computer. Deploying the API alone does not prepare the road graph
or start the routing engine. A successful What-if candidates request proves the
database/role path works; compare still needs the engine and may return 503.

## Reviewed configuration changes required

The backend container entry point is `backend.navigation.container_app:app`.
Apply the reviewed Dockerfile and `.dockerignore` changes before using it in Render:

1. Use `python:3.12-slim-bookworm`. Pinned pyvalhalla 3.9.1 binary wheels require
   CPython 3.12+ and Linux glibc 2.28+; Debian bookworm meets the glibc requirement.
2. Preserve the current requirements installation and existing system build tools;
   include `libgomp1` and `libstdc++6` for the native routing runtime.
3. Exclude `**/.runtime/` and `.local-backups/` from Docker context. Local Windows
   packages, absolute-path config and tiles must not overwrite the Linux build.
   Retain the existing exclusions for real env files, databases and other private files.
4. After copying sources, run `python -B -m backend.navigation.prepare` during image
   build. It installs pinned pyvalhalla into the ignored runtime and builds the
   bundled public KL East OSM snapshot. No provider secrets are required at build time.
5. Start the protected API through the container entry point, with one worker:

```dockerfile
CMD ["sh", "-c", "exec uvicorn backend.navigation.container_app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
```

`PORT` is Render's existing platform-provided variable, already used by the original
Dockerfile. Do not add it to the team's ten-variable application env example. No
new application environment variables, keys or env files are needed.

## Render settings

- Keep the existing Docker service and its existing runtime secrets.
- Use the repository-root Dockerfile and build context.
- In Settings, check **Docker Command**. An old override such as `uvicorn main:app`
  bypasses the new image CMD. Leave the override blank to use the Dockerfile CMD,
  or have the cloud owner set an equivalent reviewed command.
- Use `/health` as the service health-check path. The container entry point reports
  unavailable if its private engine stops or is shutting down.
- Merge approved configuration changes into the deployed branch and let normal
  auto-deploy build the image. A new build is needed; restarting the old image cannot
  install a missing native runtime or graph.
- Do not deploy `navigation.demo`, `reports.community_demo`, or `what_if.demo`.

## Runtime behavior

The public server binds `0.0.0.0:$PORT`. During API startup its owned private server
loads the prepared graph and binds **127.0.0.1:8002 only**. The protected API lifespan
starts after the private engine is ready. Existing JWT checks, Supabase role checks,
reports and What-if contracts are unchanged. The raw private `/route` is not mounted
on the public API, and API credentials are not forwarded to it.

The public Uvicorn process owns signals. Shutdown closes API clients and then shuts
down the private engine with a bounded wait/cancellation fallback. One API worker is
required per container, because every worker would otherwise contend for the same
private port. Render replicas have independent container network namespaces.

The standard local `main:app` remains independent and still expects a separately
started local engine. Docker uses the container-specific entry point intentionally.
There are no runtime package downloads or graph rebuilds on each request/restart;
the runtime artifacts are constructed in the image at the same `/app` path.

## Validation and deployment checks

Local tests cover private HTTP route calculation, real KL East graph startup,
before/after What-if calculation, no public raw route, startup failure, occupied-port
safety, readiness loss, bounded shutdown and resource cleanup:

```powershell
python -B -m unittest -q backend.tests.test_container_navigation
```

The occupied-port test deliberately logs a bind failure; it verifies that an existing
listener is not stopped. The missing-graph test deliberately logs startup failure.
These are expected test cases, not successful production startup messages.

If a local Docker daemon is available, validate the actual Linux image after the
reviewed root configuration changes are applied:

```powershell
docker build -t enclave-routing:test .
docker run --rm -p 8008:8000 --env-file .env enclave-routing:test
```

Open `http://127.0.0.1:8008/docs`. Keys are supplied at runtime, not build arguments.
On Render verify the same sequence:

1. Build logs show preparation completed, with no native import/build failure.
2. `/health` returns 200 after startup.
3. A real management JWT can GET `/api/v1/management/what-if/candidates`.
4. POST compare using a returned facility ID and mode `avoid_damage` returns 200
   with a calculated baseline/plan result. This proves more than OpenAPI presence.
5. Resident navigation can calculate a real route. Missing surveyed accessibility
   coverage still returns no verified accessible route/not_assessable, not fabricated data.

No production success is claimed until the Linux image builds and the deployed
authenticated route calculation is retested. The local Docker daemon was unavailable
during preparation; it was not started or reconfigured automatically.

References: [pyvalhalla 3.9.1](https://pypi.org/project/pyvalhalla/3.9.1/),
[Render Docker](https://render.com/docs/docker).
