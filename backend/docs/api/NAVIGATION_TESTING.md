# KL East navigation startup

Run from the repository root using Python 3.12 or newer:

```powershell
Set-Location "D:\Sime Darby hackathon"
& ".\.venv\Scripts\python.exe" -B -m backend.navigation.prepare
& ".\.venv\Scripts\python.exe" -B -m backend.navigation.engine
```

Preparation installs pinned pyvalhalla 3.9.1 under the Git-ignored navigation/.runtime
directory and builds the bundled public OSM graph with two workers. No Docker,
new env file, cloud key, or hosted road-table changes are required. The engine stays
private on 127.0.0.1:8002; /health reports readiness. Restart it after updating code.

In another terminal start the normal backend, unless already running:

```powershell
& ".\.venv\Scripts\python.exe" -B -m uvicorn main:app --reload --port 8001
```

Use a real active verified resident JWT in http://127.0.0.1:8001/docs.
POST /api/v1/navigation/routes accepts route_mode shortest, avoid_damage, accessible.
Shortest uses allowed walking roads and ignores damage. Other modes require SQL 009
two-resident issue snapshots. Accessible additionally needs surveyed network coverage;
the initial real dataset is empty and returns 422 instead of a claimed accessible path.

See [COMMUNITY_ROUTES_TESTING.md](COMMUNITY_ROUTES_TESTING.md) for the exact JSON,
facility/evidence linking, threshold, local sandbox on 8006, errors, and deployment.
The older flag avoid_confirmed_obstacles is only a deprecated compatibility alias
for shortest/avoid_damage. SQL 008 management confirmation no longer affects routes.

Pilot endpoint window: [101.721,3.217,101.741,3.235]. Buffered OSM extract:
[101.719,3.212,101.745,3.240]. These are development rectangles, not official township
boundaries. Paths/access are not field verified; walking routes can use stairs.
The optional provider-free navigation.demo on 8005 remains synthetic contract
practice only; its fabricated path is not an actual walkway or accessible route.

The frontend handles GPS, camera following, speech, progress, sustained deviation,
and arrival. Route IDs are request references, not persisted GPS tracking sessions.
Production requires a private engine and a trusted injected NavigationSettings origin;
backend deployment alone does not create an engine. No extra application env variables.

References: [Valhalla API](https://valhalla.github.io/valhalla/api/route/api-reference/),
[OSM attribution](https://www.openstreetmap.org/copyright).
