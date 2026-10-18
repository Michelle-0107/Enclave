# Maintenance backend and staff authentication

Implemented in SQL 017 and `backend/maintenance`. No hosted database is modified
by starting the server. The web maintenance task screens now use authenticated
APIs for tasks, progress, blockers, evidence, history, notifications and account
identity. Management report details include real assignment, reassignment,
verification and rework controls. No production page falls back to sample tasks
or notifications. Web sign-in uses the real staff role endpoint for both portals.

## Install order

1. Review and run `backend/sql/017_maintenance_workflow.sql` in the same Supabase
   project used by the backend. SQL 007 and 009 must already be installed.
   Apply 017 after any later reapplication of 007, so its legacy-update guard
   remains installed. Reapplying 017 itself preserves tasks and audit records.
2. Deploy/restart the backend containing the maintenance routes.
3. Release the web authentication changes. Releasing the web first makes staff
   sign-in fail closed until `/api/v1/auth/role` and SQL 017 are available.
4. Provision a maintenance account as described below and assign an approved
   report. Do not create resident bindings for staff accounts.

Existing backend Supabase and S3 configuration is reused. There is no new public
secret, hardcoded staff password, automatic account creation, or invitation email.
Keep the Supabase admin/service key exclusively on the backend.

## Identity and account provisioning

Supabase Auth still validates passwords and issues/refreshes JWTs. All routes
require `Authorization: Bearer <Supabase access token>`; the existing verifier
checks signature, issuer, audience, expiry and the authenticated token role.

`GET /api/v1/auth/role` returns the database-authorized staff identity:

```json
{"user_id":"<uuid>","role":"maintenance","display_name":"Civil staff","team_id":null}
```

Management is identified by the existing `profiles.role = 'management'`.
Maintenance is identified by an active, admin-managed `maintenance_staff` row and
no `residents` binding. The staff registry is authoritative: neither JWT metadata
nor a 403 from the management API grants maintenance access. Disabled staff are
denied on their next request even with an unexpired JWT.

For compatibility with existing `profiles.role` CHECK constraints, staff profiles
may retain the legacy value `resident`. That value alone grants no staff or
verified-resident access. Staff must not be enrolled via resident registration.
Browser roles cannot read/write the registry directly.

To provision staff:

1. Create/confirm a dedicated account through the existing Supabase Auth admin
   workflow. Use its actual UUID and confirmed email, not a resident account.
   No password is supplied to Enclave maintenance APIs.
2. As a signed-in manager, optionally create a team:
   `POST /api/v1/management/maintenance/teams` with `{"name":"Civil repairs"}`.
3. `POST /api/v1/management/maintenance/staff`:

```json
{"profile_id":"<auth-user-uuid>","email":"staff@example.com","display_name":"Civil staff","team_id":null}
```

The email must match the confirmed Auth account. Registered residents, managers,
duplicate staff and conflicting profile emails are rejected. A missing profile is
created without changing existing accounts. A worker belongs to at most one team.

`PATCH /api/v1/management/maintenance/staff/{profile_id}` accepts any nonempty
combination of `display_name`, `team_id` (null clears it), and `active`.
`{"active":false}` revokes access; this does not delete the Auth account or audit.

## Management endpoints

| Method | Path after `/api/v1/management/maintenance` | Purpose |
| --- | --- | --- |
| GET / POST | `/teams` | List / create teams |
| GET / POST | `/staff` | List / provision staff |
| PATCH | `/staff/{profile_id}` | Rename, move team, enable or disable |
| GET / POST | `/tasks` | List / assign tasks |
| GET | `/tasks/{task_id}` | Detail with authorized photo URLs |
| GET | `/tasks/{task_id}/history` | Internal task audit |
| PATCH | `/tasks/{task_id}/assignment` | Reassign with version and note |
| POST | `/tasks/{task_id}/review` | Verify completion or request rework |

Create a task from an approved/in-progress report:

```json
{
  "ticket_id":"TICK-example",
  "title":"Repair damaged walkway",
  "instructions":"Repair the surface and inspect the walking route.",
  "priority":"high",
  "target_date":"2026-10-25",
  "assigned_staff_id":"<staff-uuid>",
  "assigned_team_id":null
}
```

Exactly one assignee is required: a staff UUID or a team UUID with active members.
One report has at most one task; a pending/rejected/resolved report cannot create a
new task. Approval itself does not automatically assign work.

All task mutations except creation require `expected_version` equal to the current
task version. Stale/concurrent changes return 409; refresh and inspect before
retrying. Reassignment is allowed in assigned, in-progress and rework states.

Review approval:

```json
{"expected_version":4,"decision":"approve","note":"Internal inspection record.","public_note":"Walkway repaired and inspected.","repair_verified":true}
```

Review rework:

```json
{"expected_version":4,"decision":"rework","note":"Upload clearer completion evidence.","repair_verified":false}
```

`note` is internal; `public_note` is resident-visible and required for approval.
Rework requires another evidence submission before approval. Legacy report status
PATCH cannot bypass task evidence/review for a report with a maintenance task.
Reports without maintenance tasks retain their existing management workflow.

## Worker endpoints

| Method | Path after `/api/v1/maintenance` | Purpose |
| --- | --- | --- |
| GET | `/tasks` | Only own/current-team tasks |
| GET | `/tasks/{task_id}` | Assigned task detail |
| GET | `/tasks/{task_id}/history` | Assigned task's internal audit |
| POST | `/tasks/{task_id}/start` | Start/restart work |
| PATCH | `/tasks/{task_id}/progress` | Save work notes |
| POST | `/tasks/{task_id}/blockers` | Report parts/access/safety/other blocker |
| POST | `/tasks/{task_id}/evidence` | Upload completion photo for review |
| GET | `/notifications` | Own staff notifications (also available to managers) |
| POST | `/notifications/{notification_id}/read` | Mark own notification read, 204 |

Start body: `{"expected_version":1}`.
Progress body: `{"expected_version":2,"notes":"Surface preparation complete."}`.
Blocker body: `{"expected_version":3,"notes":"Replacement panels needed.","blocker_type":"parts"}`.

Evidence uses multipart form fields `expected_version`, `notes`, `checked_on_site`
(`true`) and `file`. It accepts verified JPEG/PNG up to 10 MiB and 25 megapixels.
The on-site check is a staff attestation, not GPS/photo-forensic verification.
Access and version are checked before storage and again at database commit.
Known rejected commits clean up the new object; ambiguous transport failures retain
it because the transaction may have committed. Refresh before resubmitting.
Task history and evidence records are append-only. Only current authorized task
readers receive signed before/after photo URLs; use GET to refresh expired links.

## Workflow and privacy

```text
assigned -> in_progress -> awaiting_verification -> resolved
                             |
                             +-> changes_requested -> new evidence -> awaiting_verification
```

Starting work moves an approved report to `in_progress`. Submitting evidence keeps
the report in progress. Only management verification resolves it and invokes the
existing SQL 009 repair-closure rule for a linked community issue. Task, report,
audit events, staff notifications and eligible issue closure commit atomically.
A report need not have a linked map issue; no new issue is invented on resolution.

Resident report history contains sanitized start/resolution notes and staff role,
with staff UUIDs redacted. Internal work/review notes, evidence and staff
notifications stay outside resident feeds. Staff detail contains no resident
contact or owner identity. Reassignment/team changes remove former task access.

The web fetches all pages (up to 5,000 records), maps underscore API status names
to the existing hyphenated UI labels, and submits the version the worker saw.
HTTP 409 refreshes the task state and asks the worker to review before retrying;
it never silently replays a write. File uploads use native multipart FormData
with the browser-generated boundary and the same refreshed access token as JSON
requests. Focus/manual refresh updates review decisions and signed photo links.
Maintenance staff provisioning remains the management API/admin setup workflow;
it is not a public staff signup form.

List/history endpoints accept `limit` (1–100, default 20) and `offset` (>=0);
responses contain `items`, `limit`, `offset`, `has_more`. Task lists also accept a
`status`: `assigned`, `in_progress`, `awaiting_verification`, `changes_requested`,
or `resolved`.

Errors: 401 invalid/missing token; 403 wrong/inactive role; 404 missing/unassigned;
409 version/state conflict; 413 oversized photo; 415 invalid image; 422 invalid
input; 503 database/storage unavailable. All staff responses use no-store caching.

## Verification

`backend/tests/test_maintenance_postgres.py` exercises the actual migration through
HTTP and service-role SQL using a disposable loopback PostgreSQL database named
`enclave_maintenance_test`; it refuses hosted/other databases. JWT cryptography is
covered by the existing cloud authentication tests. Tests use synthetic tokens,
emails and storage, never real account credentials or production repair records.
Web `tests/staff-auth.test.cjs` checks sign-in/restoration, role matching and denial.
