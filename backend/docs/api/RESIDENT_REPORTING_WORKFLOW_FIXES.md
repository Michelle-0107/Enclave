# Resident reporting and shared facility workflow fixes

Date: 2026-10-21 (Asia/Kuala_Lumpur).

## Database rollout

Apply these small migrations in order in the existing Enclave Supabase SQL Editor:

1. `022_resident_place_reporting.sql`
2. `023_shared_facility_report_workflow.sql`

They require the existing 017-021 migrations. They do not disable RLS, change account roles,
delete reports, or change the two-distinct-residents map threshold.

SQL 022 grants authenticated INSERT on the new `reports.location_id` column; existing
column-level INSERT grants predate SQL 020. This missing privilege reproduces the
reported submission error. Ownership, active verified residency, pending status and
the prohibition on self-approval still come from existing RLS policies. Existing
map places can become issue targets atomically by their canonical registry ID.

SQL 023 synchronizes approval, in-progress and verified resolution for the same
facility and category within the same incident. Each report retains its own owner,
photo, coordinates and audit history. The same staff review note and actor are
copied through valid status transitions. Reports in a different category or at a
different facility are not approved together; rejected reports stay rejected.
New evidence submitted while work is ongoing inherits the approved/current state.
A new incident after repair starts pending. Related reports use one maintenance
task, including assignment, progress, blockers, evidence, rework and verification.
Task lookup accepts every related ticket ID, so management sees the shared task.
Existing ownership and staff assignment checks remain in the original RPCs.

After applying SQL, deploy the backend and use the updated mobile/web code.
No production migration, commit, push, cloud build or deployment is implied by
these local test results. This task has no authenticated Supabase browser session.

## Resident UI

- Show the top three nearby facilities/sections by the existing relevance ordering.
  Expand the rest with Show more facilities; retain a selected extra item when folded.
- Use clean English labels and ordinary separators in report instructions.
- Explicit dark input text, muted placeholder and white search field background.
- Include nearby named shared places such as stations, malls and buildings as targets.
- Add confirmed resident reports to the current map's existing issue layer with the
  same style and labels. Require two distinct residents, retain backend pagination,
  ignore resolved/single-reporter/out-of-area points, and cancel stale responses.
- Keep the selected report's stable location ID and actual issue pin throughout upload/link retry.

## Local verification

Real PostgreSQL tests use newly initialized loopback-only disposable clusters, never
the hosted database. Tests reproduce the original column permission error, apply
SQL 022 and insert as authenticated residents, test place reporting and ownership,
then exercise shared review, one task, progress, evidence, rework, final verification,
late reports, a new incident, rerunnable migrations and transactional audit rollback.

Mobile checks cover folding and preserving selection, station reporting, input colors,
map visibility/pagination/cancellation and existing route/guidance behavior. Web checks
cover shared task lookup and the original maintenance API contracts.


Completed checks:

- 83 backend unit/HTTP regression tests passed.
- 4 real PostgreSQL report insert/place tests passed.
- 9 real PostgreSQL shared workflow tests passed, including concurrent approvals
  and keeping a different unresolved category open.
- 31 resident map screen checks, 10 report selection/search checks, 8 upload checks,
  4 report map gesture checks, 8 demo area and 6 Live area checks passed.
- 11 web maintenance API checks passed.
- Mobile and web TypeScript typechecks and relevant ESLint checks passed.
- OpenAPI exported; unrelated local files remain unchanged.

Production status: SQL 022/023 have not been applied by this task. No Supabase
session is available in the connected browsers. A Git push does not apply these SQL migrations or confirm production deployment.


Independent follow-up review found and reproduced an optional place-lookup outage
that previously hid the existing facility list. Fixed by staging named-place pages
separately, retaining registered facilities/road sections on lookup outages and
displaying a notice. Authentication denials still stop the operation; partial,
wrong-area and stale place results are not added. Added the failure regression.
Also checked simultaneous final verification of two categories in one incident.

Independent review also passed explicit 401/403 denial handling, partial-page area mismatch, and 7 What-if candidate-review navigation checks.
