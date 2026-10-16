# Community issue points and three route modes

This is the current contract. It supersedes the approval-gated map and SQL 008
management-confirmation routing design. Maintenance approval still works through
SQL 007; it does not decide map visibility or route avoidance.

## Rules

- Residents select an explicit facility and incident; no grouping by approximate
  proximity/category. Facilities can have separate damage/obstruction incidents.
- At least two distinct active, verified resident accounts must link their own
  reports to the same open incident. Repeated submissions by one account count once.
- One reporter: discoverable through the issue-selection list, absent from the map
  and restriction set. Two reporters: one public marker with reporter_count.
- Every open road-facility issue meeting the threshold becomes a route restriction,
  without management approval. Bench/other facility damage remains a map point but
  does not automatically close a road. Road types: path_surface, ramp, stairs, kerb,
  crossing, elevator, streetlight, drainage. Add genuinely road-related assets with
  the corresponding type; do not label a road obstruction as a bench issue.
- An existing verified repair audit event from SQL 007 closes the linked incident.
  Old counts are historical. Fresh damage after repair creates a new incident and
  starts at one; evidence from before the repair cannot reopen it. Directly changing
  a report's status without the verified repair audit is not a supported repair flow.
- Verification is checked when linking. A count records distinct verified reporters
  at submission time; it does not continuously delete evidence if a resident moves.

## Migration and privacy

Review/run `backend/sql/009_community_issue_points.sql` manually after SQL 007.
SQL 008 is not required by these routes; if already installed, leave its historical
tables alone. Its management confirmation API is retired and it has no effect on
the new map or route modes. Do not delete old migrations/data to install SQL 009.

SQL 009 adds three private, RLS-enabled tables: community_facilities,
community_issues, community_issue_reports. Browser roles cannot directly read/write
them or execute their RPCs. Existing report owner RLS, Auth, and teammate tables/code
are unchanged. The backend derives actor_id from JWT, checks membership in SQL, and
returns whitelisted public projections without report tickets, photos, descriptions,
reporter identities, or management notes. No new env variables are introduced.

Existing reports are not automatically matched to points. They stay private until
their owners explicitly link them. Existing photo uploads/S3/AI are unchanged.
Creating/linking an incident is atomic; the upload and the explicit link are two
separate API requests. Retry the link using the same ticket if the response is lost.

## Real Swagger flow on port 8001

Start the normal API and local engine. See NAVIGATION_TESTING.md for commands.
Authorize with a real active verified resident JWT, without the Bearer prefix.

1. GET `/api/v1/facilities` to reuse a registered point. If absent, POST that path:

   ```json
   {
     "name": "KL East walkway beside the crossing",
     "facility_type": "path_surface",
     "latitude": 3.22649,
     "longitude": 101.730755
   }
   ```

   This location is a test fixture, not a claimed live incident. For real use select
   the actual affected walkway point. Place road-related issue points on the affected
   path; MVP avoidance uses a conservative 10m-by-10m exclusion square around it.
   The initial model has no floor/bridge-level information and can over-exclude an
   adjacent path. It is not an exact engineered road closure polygon.

2. Submit a photo through existing POST `/api/v1/reports`, near the selected point.
   Retain its ticket_id. The evidence must be within 100m of the facility.
3. POST `/api/v1/community/issues`:

   ```json
   {
     "facility_id": "REPLACE_WITH_FACILITY_UUID",
     "fault_kind": "damage",
     "report_ticket_id": "REPLACE_WITH_YOUR_REPORT_TICKET"
   }
   ```

   The returned issue contains its UUID, reporter_count=1, and community_visible=false.
   An existing open incident at the same facility and fault_kind is reused. The API
   does not merge unrelated facilities simply because their coordinates are close.
4. The second resident signs in, submits their own photo report, and GETs
   `/api/v1/community/issues` to select the same issue (including one-reporter points).
   POST `/api/v1/community/issues/{issue_id}/reports`:

   ```json
   {"report_ticket_id": "SECOND_RESIDENTS_OWN_REPORT_TICKET"}
   ```

5. reporter_count becomes 2. GET `/api/v1/map/issues` now shows one GeoJSON marker,
   even while both maintenance reports are still pending/is_approved=false.
   Repeating the same resident's request returns deduplicated=true without increasing
   the count, even with another owned ticket. A report cannot count in multiple issues.

List/map endpoints support bbox=west,south,east,north, limit (1-200), and offset.
Follow pagination.has_more. Map include_resolved=true adds closed incidents that met
the threshold, never a current restriction. Facilities/issue choices are a separate
selection layer; do not present one-reporter choices as confirmed map issues.

## Three route choices

POST `/api/v1/navigation/routes`:

```json
{
  "origin": {"latitude": 3.225377, "longitude": 101.730331},
  "destination": {"latitude": 3.227217, "longitude": 101.731778},
  "profile": "walking",
  "language": "en",
  "route_mode": "avoid_damage"
}
```

| route_mode | Behavior |
|---|---|
| shortest | Distance-based permitted pedestrian routing; ignores incident damage and can include stairs. |
| avoid_damage | Distance-based routing excluding every current threshold-qualified road issue; includes ordinary paths/stairs otherwise. |
| accessible | Distance routing only on currently valid surveyed accessible connections, excluding the same community damage. Unknown paths and stairs are excluded. |

Shortest/avoid_damage use Valhalla pedestrian shortest=true. Shortest does not ignore
pedestrian access restrictions or allow arbitrary travel through buildings.
The deprecated avoid_confirmed_obstacles flag is a compatibility alias: false means
shortest, true means avoid_damage under the new two-resident rule, never SQL 008.
Do not combine it with a contradictory route_mode.

GET `/api/v1/navigation/obstacles` returns current incident IDs, facility IDs,
reporter counts, exclusion rings, and snapshot time. More than 100 active road
restrictions fails with 503 instead of silently truncating. Avoidance modes fail
with 503 when SQL 009/restriction data is unavailable; no ordinary-route fallback.
An endpoint inside a zone returns 409; no acceptable detour returns 422. Every
returned segment and endpoint snap connector is checked against all restriction
squares, including when an old engine ignores exclusions. A zone off the selected
route may leave its geometry unchanged even though obstacle_count includes it.

The response includes route_mode, routing_engine, geometry, maneuvers,
community_issue_avoidance (not_applied/applied/no_active_obstacles), obstacle_count,
obstacle_snapshot_at, and obstacle_source=community_reports. Conditions can change
after a snapshot; the frontend must refresh/recompute during a journey. GPS tracking,
voice playback, and push subscriptions are not implemented by this backend milestone.

## Accessibility data boundary

The supplied KL East OSM extract has 438 walking-related ways, 50 stairs, and no
wheelchair tags on those ways. Absence of a stairs tag does not prove accessibility.
No surveyed network has been invented. Real accessible requests currently return
422 with a missing verified network explanation; the UI should display no available
accessible route rather than an ordinary walking route.

The backend includes a separate distance-routing graph in
`backend/navigation/data/accessibility_network.json`. Its initial nodes/edges are
empty. Populate it only with assessed connections, including a genuine ramp/elevator
alternative as a separate edge where appropriate. Do not mark a stair edge accessible
just because there is a ramp somewhere nearby.

Each edge requires IDs/start/end/name/geometry, assessment accessible, has_steps=false,
step_free_connection=true, timezone-aware verified_at/valid_until, and an evidence
reference. Source must be field_survey for real assessments. Unknown, inaccessible,
unverified, expired, and stairs edges never participate. Nodes and geometry must
match within the pilot. The current strict MVP accepts start/end at surveyed nodes
within 0.5m; it does not invent an unsurveyed approach from a nearby GPS position.
Further deployment needs surveyed coverage and suitable endpoint/approach handling.

Accessible routing uses Dijkstra distance over those assessed edges, removing edges
whose geometry intersects incident zones. Instructions come from the selected
surveyed edge geometry/names, not Valhalla's unrestricted walking route. Duration
assumes 1m/s and is an estimate. When no step-free connected path survives, return
422. Synthetic graph tests are marked synthetic_demo/field_verified=false; never
display them as a real verified wheelchair route.

## Local sandbox, no SQL/cloud writes

Keep the real engine on 8002 running, then start:

```powershell
Set-Location "D:\Sime Darby hackathon"
& ".\.venv\Scripts\python.exe" -B -m backend.reports.community_demo
```

Open http://127.0.0.1:8006/docs. This uses synthetic resident accounts/private reports
and issue records. It reads no .env and makes no Supabase/AWS/email/AI calls. Walking
routes use the real loopback engine. Never deploy the sandbox. Data resets on restart.

1. Authorize demo-resident-token. GET community/issues shows issue
   `20000000-0000-4000-8000-000000000001`, count 1. GET map/issues is empty.
2. POST that issue's /reports with `{"report_ticket_id":"DEMO-A-002"}`. Count remains
   1, deduplicated=true; map remains empty.
3. Switch Authorize to demo-resident-2-token. POST the same issue's /reports with
   `{"report_ticket_id":"DEMO-B-001"}`. Count becomes 2 and map has one point.
4. Request the sample route with shortest, then avoid_damage. The current real HTTP
   test returned about 382m versus 445m, with the same unapproved fixture reports.
   The exact distance can change with engine/data settings.
5. Request accessible: 422 is expected until actual surveyed coverage is supplied.
   Offline tests separately prove that an assessed ramp detour wins over a stair
   shortcut, and damaged/unknown paths never become fallback routes.

These demo tokens cannot authenticate to the real port 8001 API.

## Validation and deployment

```powershell
python -B -m unittest -q backend.tests.test_map backend.tests.test_obstacles backend.tests.test_accessibility backend.tests.test_navigation backend.tests.test_navigation_native backend.tests.test_obstacle_detour_native
```

Native tests skip unless the local graph is prepared. test_community_postgres requires
an explicitly disposable loopback database named enclave_community_test, supplied
through a temporary test-process ENCLAVE_TEST_PG_DSN. Never use Supabase/shared data.
It verifies real permissions, ownership, unique resident counting, concurrency,
rollback, maintenance independence, repaired-cycle resets, and migration reruns.

Production needs manual SQL 009, the updated API and private engine, frontend point
selection/linking, three route choices, and surveyed accessibility coverage. Updating
Render code alone does not install SQL or operate a separate engine. The ten agreed
application env names remain unchanged. Teammate routers/services/frontend were not
modified and need their owners to integrate these contracts.
