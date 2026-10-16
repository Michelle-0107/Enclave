> Updated community rule: approval here is for maintenance only. It does not
> control map visibility/avoidance. SQL 009 uses two residents; see
> [COMMUNITY_ROUTES_TESTING.md](COMMUNITY_ROUTES_TESTING.md). The maintenance-only
> sandbox on 8004 has no community map flow; use 8006 for that.

# Management report review and history

The review API lives in `backend/reports/moderation.py`. Existing teammate routers,
services, image analyzers, and the ten environment variable names are unchanged.

## Database prerequisite

Review and run `backend/sql/007_report_workflow.sql` manually in Supabase SQL Editor
before testing against the real database. No hosted migration is executed by the
application or by the unit tests. Existing report ownership/residency RLS remains
required; SQL 007 does not replace `fix_report_resident_access.sql` or SQL 006.

SQL 007 adds:

- A unique index on `reports.ticket_id`. Existing duplicate non-null IDs make
  the transaction fail; inspect those rows rather than deleting or renaming them.
- `report_status_events`, storing report ID, old/new status, management actor UUID,
  resident-visible note, repair-verification flag, and database-generated timestamp.
- A backend-only `enclave_report_workflow` RPC. `anon` and `authenticated` cannot
  execute it or read the audit table directly. The backend supplies the actor UUID
  from the verified Supabase access token and the RPC checks `profiles.role`.

Only the server uses `SUPABASE_KEY`. Do not put it in Swagger Authorize or frontend
code. No new environment variables, provider configuration, or OTP changes are needed.

## Contract

| Endpoint | Access | Behavior |
|---|---|---|
| `GET /api/v1/management/reports` | Management | Filter by optional `status`; `limit` 1–100, `offset` >= 0; returns `items`, `limit`, `offset`, `has_more`. |
| `PATCH /api/v1/management/reports/{ticket_id}/status` | Management | Atomically changes status/approval and inserts one audit event. |
| `GET /api/v1/reports/{ticket_id}/history` | Management or active verified owner | Chronological events with pagination. Other residents receive 404. |

Management accounts do not need a resident binding. Residents must have an active,
verified resident record to read their own history. Staff emails/names are never
included; the actor UUID is returned only to management. History notes are visible
to the owner, so do not write private staff information into them.

Allowed transitions:

```text
pending -> approved -> in_progress -> resolved
        -> rejected
```

`rejected` and `resolved` are terminal. Reopening/reassigning tasks, attachments for
repair proof, route graph updates, notifications, and frontend integration are not
part of this change. Resolution requires the manager to confirm `repair_verified=true`;
the backend cannot establish that physical repair was performed.

Approval body:

```json
{
  "expected_status": "pending",
  "status": "approved",
  "note": "Inspected and confirmed the issue.",
  "repair_verified": false
}
```

Then use `approved` -> `in_progress`, and finally:

```json
{
  "expected_status": "in_progress",
  "status": "resolved",
  "note": "Repair checked on site and confirmed complete.",
  "repair_verified": true
}
```

`expected_status` prevents stale updates: two competing approvals produce one success
and one 409, with one event. Retrying a completed PATCH returns 409; refresh the report
and history. Invalid transitions, blank notes, extra actor/role fields, and unverified
resolution return 422. Missing/invalid JWT returns 401; wrong role returns 403;
unknown/inaccessible ticket returns 404; unavailable RPC/database returns a generic 503.

The database locks the report row until the transaction ends. If audit insertion
fails, the report update rolls back too. Audit history is append-only for the service
role. Existing reports receive no invented historical events or approval timestamp.
Community points are labelled community_reported, not management-verified.

## Local maintenance practice

Run python -B -m backend.reports.workflow_demo and open port 8004/docs. Use
demo-management-token for review/status, demo-resident-token for owned history.
The demo has no cloud calls. Community map/route testing now uses port 8006 and
COMMUNITY_ROUTES_TESTING.md; approval does not publish map points.

## Real Swagger test

1. Apply SQL 007 and start the regular application with `python -m uvicorn main:app --reload --port 8001`.
2. Obtain real Supabase Auth access tokens for a management user and an active verified
   resident. Use `backend.tools.check_session` if needed; keep tokens private.
3. Follow the same flow at `http://127.0.0.1:8001/docs`, using a real ticket ID and real
   access tokens. Do not use sandbox tokens or the server Admin key here.
4. Check `report_status_events` in Supabase. Each successful transition has one row;
   the report's maintenance status and audit history agree. Old reports can legitimately have
   no events until their next status change.

## Automated validation

```powershell
python -B -m unittest -q backend.tests.test_report_workflow backend.tests.test_map backend.tests.test_cloud backend.tests.test_entrypoint backend.tests.test_registration backend.tests.test_registration_setup backend.tests.test_storage
```

`backend/tests/test_report_workflow_postgres.py` separately exercises the migration
against PostgreSQL 17: row locking, concurrent approvals, audit rollback, ownership,
terminal states, execution grants, duplicate IDs, and migration reruns. These tests
skip without an explicitly supplied test-only DSN and refuse anything except
`127.0.0.1` / database `enclave_workflow_test`. Never point them at an application DB.
The test DSN is a test-process setting, not a new application `.env` variable.

References: [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html),
[Supabase database functions](https://supabase.com/docs/guides/database/functions).
