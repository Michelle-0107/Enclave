# Map location selection

Resident demo and Live map support **Address / place name** and **Pick on map**.
Typing a label clears its old coordinates. Users select an actual search result,
saved place or map point before requesting a route. Changing a search, endpoint,
or service area prevents delayed results from replacing the new selection.
The selected facility/place has a gold square frame; issue colours remain visible.

The app includes 1,252 named places/address reference points from the existing OSM
extracts for KL East and Prima Saujana, Kajang. This catalogue works without a new
APK or backend deployment. It is not a worldwide geocoder: OSM coverage may be
incomplete, and a road or building centre is labelled as a reference point.
Users can choose the exact entrance with Pick on map.

## Database deployment

In the existing Enclave Supabase project's SQL Editor, run in this order:

1. `backend/sql/013_map_places.sql` creates the shared `public.map_places` table,
   resident-only read policy, and `search_map_places` RPC.
2. `backend/sql/014_map_places_seed.sql` imports the 1,252 places with deterministic
   IDs. Re-running it updates matching rows without duplicating them.
3. Deploy the backend for `GET /api/v1/navigation/areas/{area_id}/places?q=...`.

The table records name, address, area ID, latitude, longitude, source and position
basis. Only the backend/admin may maintain the catalogue. The API forwards the
resident's JWT, so RLS still applies. Missing migration or not-yet-seeded matching
data falls back to the bundled catalogue; authentication, network or malformed
responses return explicit errors. User-created pins stay private in the existing
`user_saved_places` table (migration 012), through the Save place control.

No hosted database changes or EAS builds are triggered by these source files.
The initial implementation was checked with a disposable local PostgreSQL 17
database; the hosted migration still needs application if it is not installed.

## Refreshing the catalogue

After replacing the reviewed OSM extracts, run from the repository root:

```powershell
.\.venv\Scripts\python.exe -m backend.tools.build_map_places
```

This regenerates the backend catalogue, mobile catalogue and SQL seed from the
same source. It does not download data or change a hosted database. OSM contributor
attribution and ODbL licensing are retained in the app and generated assets.

## Validation

```powershell
.\.venv\Scripts\python.exe -m unittest backend.tests.test_map_places backend.tests.test_service_areas -q
# From frontend/enclave-mobile:
node tests/place-search.test.cjs
node tests/saved-places.test.cjs
node tests/live-service-areas.test.cjs
node src/demo/__tests__/screen.test.cjs
node src/demo/__tests__/network.test.cjs
.\node_modules\.bin\tsc.cmd --noEmit
```

`backend.tests.test_map_places_postgres` requires the dedicated disposable loopback
database named `enclave_saved_places_test`. It refuses hosted/existing databases.
