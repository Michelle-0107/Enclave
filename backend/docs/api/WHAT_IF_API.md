# Management What-if: compare hypothetical repair plans

This read-only MVP compares management-designated journeys before and after a
selected set of hypothetical facility repairs. It does not change live reports,
community incidents, maintenance audits, resident navigation, or existing
`repair_scenarios` tables. Inputs and results are returned to the caller, not saved.

## Setup and access

- Run `backend/sql/010_management_what_if_snapshot.sql` after SQL 009, then
  `backend/sql/018_what_if_candidate_review.sql` for candidate approval links,
  then `backend/sql/028_repair_cost_history.sql` for suggested repair costs.
  SQL 028 creates a private cost source table and updates the same read-only snapshot RPC.
  Deploy SQL 018 before the updated API. Missing review metadata fails closed with 503.
- Use the normal `main:app` application and a working private routing engine.
- Send `Authorization: Bearer <Supabase access_token>` from an account whose trusted
  `profiles.role` is `management`. A resident binding is not required. A resident
  token returns 403. Do not send actor/user/role fields in the request.
- No new environment variables or keys are required.
- Responses use `Cache-Control: private, no-store`. Database/provider errors are generic.

## GET /api/v1/management/what-if/candidates

Reads one current snapshot. Returns `snapshot_at`, `issues`, `confirmation_threshold:2`,
`main_path_source:"management_defined"`, `currency:"MYR"`, and `persistence:"not_saved"`.

Each issue contains `id`, `facility_id`, `facility_name`, `facility_type`, `latitude`,
`longitude`, `fault_kind`, `status`, `reporter_count`, `affects_routes`, `created_at`,
`resolved_at`, and management-only `review_ticket_id`. Only open incidents reported
by at least two distinct residents, with a pending report and no approved linked report
(including approval history), are included. The ticket is the earliest pending linked
report by creation time/id. No reporter IDs, photos, descriptions, or staff notes are exposed.
Public community/map projections continue to omit report tickets.

Each issue also includes `estimated_cost_myr`, `cost_estimate_source` and
`cost_estimate_sample_count`. The same facility always receives the same estimate.
The backend first uses the median of verified, completed repairs of the same
`facility_type`. Until such rows exist it uses a clearly labelled provisional
reference amount. SQL 028 seeds ten provisional amounts (MYR 1,800–15,000),
one per facility type; these are planning assumptions, not historical invoices.
No source references or invoice details are returned to the browser.

Group candidates by `facility_id` for repair selection. A repair at one selected
facility hypothetically clears only its current unapproved qualified incidents.
Approved, unrepaired incidents still remain routing obstacles, including at that facility. The cost is
entered once per facility, not once per incident. Bench/other incidents may be
selected but do not remove road restrictions or manufacture route benefits.

More than 100 qualified incidents fails closed with 503, never a truncated comparison.
One-reporter/unlinked reports are not current routing restrictions or repair candidates
for this MVP. A facility removed from the current snapshot causes compare to return 409.

## POST /api/v1/management/what-if/compare

Up to ten named major paths, five independent repair plans, twenty facilities per
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
for each designated path/mode. In the resident-facility simulation, `accessible`
uses the same validated, fictional step-free graph as the app demo: simulated
crossings, ramps, lift-access bridges and building entrances. It excludes stairs
and unassessed links and retains the 20 m outdoor approach and barrier rules.
The result is hypothetical (`field_verified=false`), not a certified accessible
route. Provider-based comparisons continue to use the time-frozen surveyed
network and exclude invalid surveys.

Cost and budget fields accept nonnegative decimal amounts with at most two decimal
places. Prefer JSON strings to preserve decimal precision. A null or omitted cost
asks the backend to use the current source-backed estimate from the same snapshot.
If no source amount exists, cost remains unknown, never silently zero. An explicitly
entered zero is a zero management override.
Amounts in responses are decimal strings, e.g. `"1200.00"`, or null when unknown.
`include_geometry` defaults false; when true, returned geometries are capped at
50,000 total points, otherwise 422 asks the caller to retry without geometry.

To add a verified completed repair after SQL 028, insert its real paid amount and
unique invoice/work-order reference in Supabase SQL Editor:

```sql
INSERT INTO public.repair_cost_history
    (source_reference, facility_type, record_kind, cost_myr, completed_on)
VALUES
    ('YOUR-INVOICE-OR-WORK-ORDER', 'path_surface', 'completed_actual', 8000.00, '2026-01-15');
```

Only insert a completed actual expense; a vendor quote belongs in the editable
plan cost field. Future comparisons automatically prefer completed actuals over
the provisional seed of the same facility type. Historical records can be
reviewed or corrected by a database administrator; no resident-facing table
access is granted.

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
| `not_assessable` | No damage-free reference for those endpoints on the selected mode's graph |

Distance/time savings are signed before-minus-after values for comparable available
routes. An unavailable baseline is not infinity: restoration has null savings rather
than an invented distance. Summary distance totals include only comparable paths;
the same journey in different mode summaries must not be added as unique user demand.
No simulated step-free or verified accessible reference means unknown coverage,
not a claim that a physical accessible route cannot exist. Its intersecting-path
flag is null, not false.

## Consistency, privacy, and limits

The service validates management role and reads candidate data through one private
STABLE SQL function. It freezes that incident snapshot and, for provider-based
accessible comparisons, the surveyed document and its validity time. Baseline,
reference and all plans use the same routing graph and assumptions. Repairs remove only selected
facilities' incident restrictions; other obstacles stay active. Structural stairs and
unknown/inaccessible links are never converted into accessible ones by a repair.

Requests are bounded to at most 140 unique route calculations, four in flight and
120 seconds of calculation after the snapshot read. Equivalent route cases are reused.
The bundled routing caches must match the current algorithm signature; a stale
cache forces a full OSM graph rebuild and can exhaust this calculation budget.
One comparison runs per API process at a time; another receives 429. This is a local
process bound, not a distributed quota. Failure/timeout cancels outstanding work and
returns no misleading partial improvement. Engine/database failures are 503.
Returned route geometries retain the existing combined 50,000-coordinate limit.

The private engine receives coordinates and exclusions, never JWTs, admin keys,
management identity, names, cost, budget, or path labels. The application performs no
scenario writes. SQL 010 does not change notifications, existing repair_scenarios,
or resident/management policies outside this new RPC.

## Errors

401 invalid JWT; 403 trusted role not management; 409 stale/missing selected candidate;
422 invalid fields/bounds/limits/geometry output size; 429 comparison busy; 503 missing
SQL 010, invalid/oversized snapshot, too many candidates or provider outage; 504 timeout.
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
requests. `demo-resident-token` returns 403. This sandbox uses provider-based
comparison and its empty verified network returns accessible results as not assessable;
the resident-facility simulation uses the fictional step-free graph. Never deploy the sandbox.

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

## Fixed endpoints and explicit facility restrictions

Comparisons now use nearest-edge correlation (`radius: 0`, node snapping disabled)
for a no-damage reference, then freeze its matched origin and destination for all
before/after calculations of that journey and mode. A returned endpoint more than
1 m from its frozen anchor is not assessable and cannot be counted as a restored
route. The shared feasible-route pool also rejects candidates with different
endpoints. Public resident navigation requests retain their existing correlation
settings; this internal comparison option cannot be supplied by API callers.

The server-owned hypothetical walking graph selects access independently of
damage. Before/after searches therefore reuse the original selected coordinates
to preserve the same graph entrance, and validate their returned endpoints against
the frozen reference. Re-selecting a returned building-boundary coordinate can
otherwise associate it with an adjoining building and incorrectly hide a valid
detour as `comparison_endpoint_changed`. The provider-backed and surveyed modes
retain their existing fixed-correlation policy.

The hypothetical facility manifest also includes clear short public side-street
junction crossings that the earlier 20 m minimum road-segment sampler omitted.
They have explicit same-road anchors and simulated provenance; they do not enable
unmarked crossings in Live. Existing facility IDs, recorded-road priority, the
20 m outdoor-gap limit, and physical-obstacle checks are retained. Manifest updates
are generated geographically for both areas without using audit endpoints/results.

`baseline[].comparison_origin` and `comparison_destination` expose those anchors.
`plans[].paths[].explanation` explains unchanged results. `routing_restrictions`
contains the actual before-repair exclusion rings and facility IDs used in the
calculation. Match them against `plan.facility_impacts[].facility_id` to distinguish
simulated repairs from remaining restrictions. The map uses red for remaining
zones, green for cleared zones, and purple for authored road segments. Marker
popups identify each facility and its binding source.

The eight demo facility records retain their exact authored OSM source segment
in `affected_segment`. For matching IDs, types and coordinates, both resident
avoid-damage navigation and What-if cover that complete segment with local 5 m
half-width squares at most 5 m apart. No nearest-road guessing or database writes
are performed. Restriction and capacity counts remain bounded; road-issue summary
counts deduplicate the same issue's multiple squares.

Other facilities, including the older TEST-KL-East-Walkway-01 fixture, remain
`point_only`. Their existing local zone is explicitly shown and the UI warns that
no confirmed affected road segment is available. This change does not invent a
road association for those records. A future management-maintained binding is
still required to describe their intended full closure.

Unchanged can be correct: it does not mean the repair was ignored. The supplied
Path 3 coordinates (3.226307,101.730720) to (3.226325,101.729904) yield 157 m before
and after with frozen endpoints in the bundled real road graph. The selected
north pavement source segment is a different footpath from the viable reference
route. A separate native integration fixture still demonstrates a genuine repair
benefit (445 m to 382 m); regression tests cover both outcomes without manufacturing
shorter routes or hiding endpoint changes.

### Selected repairs stay visible during API rollout

Each plan map receives the candidate facility snapshot as well as comparison
restriction geometry. The plan's returned `facility_impacts` determine selection;
editing or refreshing inputs clears stale results. Selected facilities have green
R1, R2, ... markers and a matching name list with click-to-focus controls. Initial
bounds include both the route and every selected facility with known coordinates.
The reset control restores this combined view after zooming or focusing a marker.

Comparison restriction coordinates take precedence over candidate coordinates.
When an older API omits restriction geometry, markers still use available
candidate coordinates, and the UI clearly labels them as facility locations only.
No affected area is fabricated. Multiple incidents at one facility are deduplicated;
selected non-road facilities are still marked. A facility lacking coordinates is
listed as location unavailable, without creating a fake map position.


## Review recommended candidates

The AI summary offers one **Review candidates** button per calculated recommended
plan. Tied alternatives stay separate. The button rechecks current qualification
and opens the first pending report from that plan's exact `repaired_issue_ids`.
Approval still requires the ordinary resident-visible note and explicit Approve action.
After a successful approval, management sees a Yes/No dialog only if another candidate
in that plan is still qualified. Yes rechecks again and opens the next report; No stops
on the saved report. The last candidate ends the sequence without a dialog. Failed
approvals and rejected reports do not advance. Another manager's approvals are skipped;
new issues that were not in the compared plan are never appended to the sequence.
The queue is tab-local sessionStorage with a two-hour expiry; it stores only issue IDs,
the current ticket and plan label. It does not save simulations or bulk-approve reports.
