# Portal activity history

Apply `backend/sql/027_portal_activity_logs.sql` after migrations 025 and 026, then deploy the backend and web app together. SQL 027 can be rerun safely. It adds no browser table or RPC access and imports existing report/task events once with their original timestamps. Until installed, the API returns 503 with a migration hint rather than an empty history.

Authenticated endpoints:

- `GET /api/v1/management/activity-logs`: management actions, readable only by management.
- `GET /api/v1/maintenance/activity-logs`: the signed-in active maintenance worker's own actions only.

Both accept `search`, `role`, `result`, `from`, `to`, `limit` (1–100, default 20), and `offset`. Dates are inclusive Malaysia calendar dates. Results sort by timestamp and ID descending. `has_more` supports the shared UI's Previous/Next buttons. The verified JWT supplies the actor ID; the route supplies the portal. Query parameters cannot override either.

Recorded actions include report status changes (including synchronized reports), task assignment/reassignment, start, progress, blocker, management blocker feedback/due-date changes, evidence submission, review/rework/completion, and staff/team registry changes. Successful report/task changes are captured by database event triggers in the same transaction as the original action. Historical staff/team changes cannot be reconstructed and start recording when this migration is installed.

The workflow RPC wrappers also record explicit rejected mutation attempts by recognized staff as `failed`. An invalid or inactive identity cannot read logs. Authentication/HTTP validation failures, transport outages and database exceptions do not have a confirmed persistent outcome and are not fabricated as audit entries. Reading logs does not generate further activity. This is workflow history, not a general HTTP access log; navigation, what-if simulations and notification reads are not included.

The audit table stores actor names/roles as snapshots, action descriptions and target identifiers, with no request bodies, tokens, credentials or photo URLs. Browser roles cannot read/write it directly; the backend service role has SELECT/INSERT only. The read RPC independently verifies the staff role and limits maintenance to the actor's own records.

Validation: `python -m unittest backend.tests.test_activity_logs`; run `backend.tests.test_activity_logs_postgres.ActivityLogTests` only against a disposable loopback `enclave_maintenance_test` database through `ENCLAVE_TEST_PG_DSN`. Web validation: TypeScript, targeted ESLint and `node --test tests/activity-logs.test.cjs`.
