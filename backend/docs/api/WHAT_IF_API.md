# Management What-if: compare hypothetical repair plans

This read-only MVP compares management-designated journeys before and after a
selected set of hypothetical facility repairs. It does not change live reports,
community incidents, maintenance audits, resident navigation, or existing
`repair_scenarios` tables. Inputs and results are returned to the caller, not saved.

## Setup and access

- Review and run `backend/sql/010_management_what_if_snapshot.sql` manually after SQL 009.
  It adds one private read-only RPC and its execute grant. It creates no tables.
- Use the normal `main:app` application and a working private routing engine.
- Send `Authorization: Bearer <Supabase access_token>` from an account whose trusted
  `profiles.role` is `management`. A resident binding is not required. A resident
  token returns 403. Do not send actor/user/role fields in the request.
- No environment variables, keys, teammate routers/services, or frontend code change.
- Responses use `Cache-Control: private, no-store`. Database/provider errors are generic.

## GET /api/v1/management/what-if/candidates

Reads one current snapshot. Returns `snapshot_at`, `issues`, `confirmation_threshold:2`,
`main_path_source:"management_defined"`, `currency:"MYR"`, and `persistence:"not_saved"`.

Each issue contains `id`, `facility_id`, `facility_name`, `facility_type`, `latitude`,
`longitude`, `fault_kind`, `status`, `reporter_count`, `affects_routes`, `created_at`,
`resolved_at`. Only open incidents with at least two distinct resident reporters are
included. No reporter IDs, report tickets/photos/descriptions, or staff notes are exposed.

Group candidates by `facility_id` for repair selection. A repair at one selected
facility hypothetically clears all its current qualified incidents. The cost is
entered once per facility, not once per incident. Bench/other incidents may be
selected but do not remove road restrictions or manufacture route benefits.

More than 100 qualified incidents fails closed with 503, never a truncated comparison.
One-reporter/unlinked reports are not current routing restrictions or repair candidates
for this MVP. A facility removed from the current snapshot causes compare to return 409.

## POST /api/v1/management/what-if/compare

Up to five named major paths, three independent repair plans, twenty facilities per
plan, and both supported comparison modes. Major paths are management-defined
origin/destination pairs inside the KL East pilot, at least 5 m apart. IDs must be
unique in their lists; duplicate ordered coordinate pairs, modes, and plan facilities
are rejected. Reverse-direction journeys may be defined separately when needed.

All IDs below are synthetic; replace facility IDs with current candidates. Path names
are management labels, not official or measured popular routes.

```json
{
  "paths": [
    {
      "id": "mall-walk",
      "name": "Management-designated entrance to destination",
      "origin": {"latitude": 3.225377, "longitude": 101.730331},
      "destination": {"latitude": 3.227217, "longitude": 101.731778}
    }
  ],
  "plans": [
    {
      "id": "repair-walkway",
      "name": "Repair selected walkway",
      "repairs": [
        {
          "facility_id": "10000000-0000-4000-8000-000000000001",
          "estimated_cost_myr": "1200.00"
        }
      ]
    }
  ],
  "route_modes": ["avoid_damage", "accessible"],
  "budget_myr": "1500.00",
  "include_geometry": false
}
```

`route_modes` defaults to both `avoid_damage` and `accessible`. `shortest` is not a
repair-comparison mode: it ignores damage already, so removing damage constraints
would not model that repair's benefit. A separate damage-free reference is computed
for each designated path/mode. Accessible reference paths still exclude stairs,
unknown/inaccessible links, and invalid surveys.

Cost and budget fields accept nonnegative decimal amounts with at most two decimal
places. Prefer JSON strings to preserve decimal precision. Cost may be omitted/null;
it is unknown, never silently zero. An explicitly entered zero is a zero estimate.
Amounts in responses are decimal strings, e.g. `"1200.00"`, or null when unknown.
`include_geometry` defaults false; when true, returned geometries are capped at
50,000 total points, otherwise 422 asks the caller to retry without geometry.

## Response and metric definitions

Top level:

| Field | Meaning |
|---|---|
| `simulation_id`, `generated_at` | Identity/time of this transient calculation, not a saved database scenario |
| `snapshot_at` | One database incident snapshot used by every plan |
| `simulation_only` | Always true; never use hypothetical routes as live navigation |
| `main_path_source` | `management_defined`; no user journey tracking/traffic weighting is implemented |
| `currency`, `budget_myr` | MYR and optional entered budget |
| `baseline_road_obstacle_count` | All current qualified road-incident zones, including unselected ones |
| `baseline` | Per designated path/mode: `current` and `reference_without_damage` |
| `plans` | Independent per-plan comparisons, costs, facility impacts and mode summaries |
| `warnings` | Data, metric and simulation limitations |

Each plan includes:

- `id`, `name`: echoed plan labels.
- `total_estimated_cost_myr`: complete sum, or null if any selected facility lacks a cost.
- `known_estimated_subtotal_myr`, `missing_cost_facility_ids`: partial cost information.
- `budget_status`: `within_budget`, `over_budget`, `unknown_cost`, or `not_set`.
- `repaired_issue_count`: qualified incidents hypothetically removed, including nonroad ones.
- `remaining_road_obstacle_count`: retained unselected road restrictions.
- `affected_major_path_count`: distinct designated path IDs whose damage-free reference
  intersects at least one selected road-facility zone, across the requested modes.
- `improved_major_path_count`: distinct path IDs that actually become available or
  shorten by at least 1 m under this plan, across the requested modes.
- `facility_impacts`: selected facility ID/name, incident IDs, affects_routes and
  `reference_intersecting_major_path_ids`. These are reference intersections, not
  independently attributable benefits of each repair in a multi-repair plan.
- `summaries`: the same counts per route mode, including restored/shortened/improved,
  longer/lost-route, not-assessable, before/after available, designated and reference-
  assessable path counts, and distance saved on comparable paths.
- `paths`: per path/mode, `after`, `effect`, distance/time savings,
  `reference_intersects_selected_repairs` and intersecting facility IDs.

**Affected does not mean improved.** A reference may cross a selected facility even
though repairing it alone changes nothing because another nearby obstruction remains.
Benefits of joint repairs are calculated for the combination, not added from separate
plans. Overall counts deduplicate path IDs across modes. They do not count physical
road segments, residents, trips per day or observed traffic. No percentage or automatic
best-plan ranking is inferred without management priorities and adequate data.

Route outcome `state` is `available`, `no_route`, or `not_assessable`. Available
outcomes include distance_meters, duration_seconds, data_source, field_verified and
optional GeoJSON LineString geometry in `[longitude, latitude]` order. Other outcomes
have null metrics and a reason. Duration estimates retain the existing routing assumptions.

Path effects:

| effect | Meaning |
|---|---|
| `restored` | Current supported route unavailable; route becomes available after selected repairs |
| `shortened` | Both available; distance decreases by at least 1 m |
| `unchanged` | Both available; distance difference under 1 m |
| `longer` | Both available; calculated distance increases by at least 1 m |
| `lost_route` | Previously available supported route is unavailable in the simulated result |
| `still_unavailable` | No supported route in either current or simulated result |
| `not_assessable` | No verified accessible damage-free reference for those endpoints |

Distance/time savings are signed before-minus-after values for comparable available
routes. An unavailable baseline is not infinity: restoration has null savings rather
than an invented distance. Summary distance totals include only comparable paths;
the same journey in different mode summaries must not be added as unique user demand.
No verified accessible reference means unknown coverage, not a claim that a physical
accessible route cannot exist. Its intersecting-path flag is null, not false.

## Consistency, privacy, and limits

The service validates management role and reads candidate data through one private
STABLE SQL function. It freezes that incident snapshot and, when requested, the
accessible survey document and its validity time. Baseline, reference and all plans
use the same routing provider and assumptions. Repairs remove only selected
facilities' incident restrictions; other obstacles stay active. Structural stairs and
unknown/inaccessible links are never converted into accessible ones by a repair.

Requests are bounded to at most 50 unique route calculations, four in flight and
45 seconds of calculation after the snapshot read. Equivalent route cases are reused.
One comparison runs per API process at a time; another receives 429. This is a local
process bound, not a distributed quota. Failure/timeout cancels outstanding work and
returns no misleading partial improvement. Engine/database failures are 503.

The private engine receives coordinates and exclusions, never JWTs, admin keys,
management identity, names, cost, budget, or path labels. The application performs no
scenario writes. SQL 010 does not change notifications, existing repair_scenarios,
or resident/management policies outside this new RPC.

## Errors

401 invalid JWT; 403 trusted role not management; 409 stale/missing selected candidate;
422 invalid fields/bounds/limits/geometry output size; 429 comparison busy; 503 missing
SQL 010, invalid/oversized snapshot, too many candidates, provider outage or timeout.
Individual supported-route absence is an outcome in a successful comparison, not a
global 422. Validation responses omit sensitive input values.

## Local sandbox and tests

From repository root, use the project's virtual environment:

```powershell
python -B -m backend.navigation.engine
```

In another terminal:

```powershell
python -B -m backend.what_if.demo
```

Open `http://127.0.0.1:8007/docs`, Authorize `demo-management-token`, GET candidates,
then execute the complete POST example. It uses synthetic management/damage/cost
data with the real local KL East engine on 8002. There are no cloud writes or email
requests. `demo-resident-token` returns 403. Real accessibility coverage is empty;
the accessible results are explicitly not assessable. Never deploy the sandbox.

```powershell
python -B -m unittest -q backend.tests.test_what_if
python -B -m unittest -q backend.tests.test_what_if_native
```

`test_what_if_postgres` requires a dedicated disposable loopback-only PostgreSQL
database named `enclave_what_if_test`. It refuses hosted/existing project databases.
The test-only DSN follows the existing test harness; it is not an application env key.

## Remaining product work

Frontend scenario forms/charts, saving management path templates/scenarios, surveyed
accessible coverage, quote/catalog management and future consent-based aggregate
user-journey weighting are separate follow-ups. Current comparisons already work
with management-supplied paths and optional cost estimates without those additions.

## Repair-plan route maps and walking references

Request `include_geometry: true` to render before/after maps. Match each plan path
with `baseline` by both `path_id` and `route_mode`. Before geometry and distance
come from `baseline[].current`; after values come from `plans[].paths[].after`.
Each plan map supports selecting a path/mode. Orange dashed lines mean before
repairs; teal solid lines mean after repairs. Distance labels use the corresponding
route distance returned by the API. Missing geometry must not be replaced with a
straight origin-to-destination line.

The comparison reuses validated candidate routes for the same journey and mode,
after checking their complete geometry against every remaining obstacle. Removing
restrictions therefore does not discard a shorter route that is still feasible.
The selected route retains its real geometry, distance and duration; distances are
not clamped to hide a longer engine result.

When an accessible before/after outcome is unavailable, it may contain `fallback`:

```json
{
  "state": "not_assessable",
  "fallback": {
    "state": "available",
    "route_mode": "avoid_damage",
    "reference_only": true,
    "accessibility_verified": false,
    "warning": "Walking reference only; accessibility has not been verified.",
    "distance_meters": 192,
    "duration_seconds": 145,
    "geometry": null,
    "data_source": "routing engine"
  }
}
```

`geometry` above is illustrative; it contains the actual LineString when requested
and available. The walking reference may include stairs. Display it as an
unverified Avoid damage reference, never as an accessible route. The accessible
state, effect, available/restored/shortened counts and savings remain based on the
actual accessible result. Accessible-only requests can also receive this reference
without adding walking rows to their summaries. If walking is unavailable too,
`fallback` is null.
