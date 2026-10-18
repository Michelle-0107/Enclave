# Server-owned resident-demo service areas

Area names, bounds, centers and support flags are configured in
`backend/data/service_areas.json`. The app discovers the catalog and selected
graph through the API. No Prima Saujana coordinates, landmarks or area-specific
conditions are added to frontend source code.

| Area | ID | Bounds (west, south, east, north) | Resident demo | Live routing API |
| --- | --- | --- | --- | --- |
| KL East | kl-east-pilot | 101.721, 3.217, 101.741, 3.235 | Existing facilities/graph preserved | Existing implementation |
| Prima Saujana, Kajang | kajang-prima-saujana | 101.795, 2.999, 101.815, 3.018 | 1,203 nodes, 1,460 road polylines, 40 real landmarks | Not enabled by this demo change |

Prima Saujana's center was derived from the named OpenStreetMap commercial
feature [way 25689860](https://www.openstreetmap.org/way/25689860), checked with the
[official OSM API](https://api.openstreetmap.org/api/0.6/way/25689860/full.json).
The surrounding service rectangle is an application development window, not an
official township boundary. The regions remain separate; the land between
KL East and Kajang is not implicitly included.

The new area's road geometry and named places are real OSM data. Only service
coverage and its road graph were added: no new fictional facilities, reports,
repairs, or preset journeys were created. Prima Saujana has zero facilities in
this snapshot. The existing demo disclaimer still applies to inferred access;
an OSM path does not establish surveyed step-free access.

## Endpoints

Both GET endpoints use the existing Bearer access token and active verified
resident check, with `Cache-Control: private, no-store`:

- `GET /api/v1/navigation/areas`: `{default_area_id, items}`. Each item includes
  ID, name, bounds, center, `enabled`, `resident_demo_supported`,
  `routing_supported`, source reference and verification flags.
- `GET /api/v1/navigation/areas/{area_id}/demo`: `{area_id, dataset}`. The graph
  follows the existing version-3 format with attribution and XML checksum.
  Unknown IDs return 404; unavailable graphs return 503. IDs cannot select
  arbitrary filesystem paths.

Existing `GET /api/v1/navigation/area`, live navigation, obstacle and What-if
scope retain their KL East behavior. The support flags describe configured
implementations, not engine health.

## Data and client behavior

Server graphs live in `backend/data/demo_areas/{area_id}.json`. KL East's original
graph is preserved exactly. Prima Saujana's public OSM XML and source metadata
are stored with its graph and ODbL-1.0 attribution. The reusable backend builder
provides `build(source, area, metadata, add_demo_facilities=False)`.

`ServiceAreaDemoScreen` is a generic loader/selector. Changing area remounts the
demo, clearing locations, route results, guidance and facility selections.
Routing, search and driving links explicitly receive the selected dataset.
Mismatched area payloads are rejected instead of mixed with the displayed map.

The old bundled KL East JSON remains as an explicitly labelled offline/older-server
fallback. Backend data is authoritative when its endpoints are available; the
fallback never pretends to be a Kajang map. Future areas require registry entries
and compatible backend graph files, not new frontend location constants.

## Activation

1. Deploy the backend, including `backend/data/demo_areas/`. No new env variables,
   SQL migrations or routing-container changes are required.
2. Restart a local backend after editing its registry (cached per process).
3. Authorize a verified resident in Swagger. Check the catalog and
   `/api/v1/navigation/areas/kajang-prima-saujana/demo` return 200.
4. Reload Metro in the existing development APK. Open Resident demo, select
   Prima Saujana, Kajang, pick locations, and calculate a route. Switching back
   to KL East must clear those locations and restore that area's graph.

No new APK is needed. If the configured cloud backend has not been deployed,
the app displays the labelled built-in snapshot and retry message. Reloading
frontend code cannot create missing server endpoints.

## Checks

```sh
python -m unittest backend.tests.test_service_areas backend.tests.test_navigation
cd frontend/enclave-mobile
npx tsc --noEmit
node tests/service-areas.test.cjs
```

Backend checks cover auth, eligibility, bounds, safe lookup, compatibility and
graph reproducibility. Frontend checks cover the actual Kajang graph, walking
modes, dataset propagation, future areas, wrong responses, offline fallback and
cancellation. All 2,797 eligible source segments were independently verified
against the original OSM XML. No hosted resident data is used in these checks.

This feature does not automatically push commits, deploy cloud services, publish
EAS Updates, or create cloud builds.
