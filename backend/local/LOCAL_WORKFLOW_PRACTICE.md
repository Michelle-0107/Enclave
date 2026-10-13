# Enclave Local Maintenance Workflow Practice

Test the existing SQLite backend and local authentication without Supabase, AWS, or a frontend. The goal is to submit a resident report, review it as management, start maintenance, confirm the repair, and read its history as the resident.

Run terminal commands from the backend directory with its virtual environment activated. See [README.md](README.md) for setup.

## 1. Start the backend

```bash
python -m fastapi dev main.py
```

A running development server normally reloads code changes. Refresh http://127.0.0.1:8000/docs and confirm version `0.2.0`.
Startup creates the `report_status_events` table if needed and preserves existing reports, accounts, and sessions.

## 2. Create a resident report

Call `POST /auth/signup`:

```json
{
  "username": "workflow_resident",
  "password": "EnclaveTest123!"
}
```

If the username exists, log in with its existing password or choose another username. Call `POST /auth/login`, copy the real `access_token`, and paste only that token into Swagger **Authorize**. Call `GET /auth/me` to confirm role `resident`.

Call `POST /reports`:

```json
{
  "description": "The street light at the community park entrance is not working",
  "latitude": 3.139,
  "longitude": 101.687
}
```

Expect `201` with status `pending_review`. Save the actual `ticket_id`; use it for all following requests.
Call `GET /reports/{ticket_id}/history`. A new report has one creation event with `to_status: pending_review`.

## 3. Create or log in to management

Use a second terminal:

```bash
python create_manager.py
```

Enter a new username such as `workflow_manager`, then enter and confirm a password of at least 12 characters. You can use an existing management account instead. Public signup cannot create management accounts.

In Swagger, log in to the management account. Clear the resident token in **Authorize** and replace it with the management token. Call `GET /auth/me` to confirm role `management`.
Call `GET /management/reports` with `status=pending_review` to find the new report.

## 4. Approve the report

Call `PATCH /management/reports/{ticket_id}/status` using the actual ticket ID:

```json
{
  "status": "approved",
  "note": "The faulty street light has been confirmed and needs repair"
}
```

Expect `200` with status `approved`. Repeating the same update returns `409` without adding another approved event.

## 5. Start maintenance

Use the same PATCH endpoint:

```json
{
  "status": "in_progress",
  "note": "A maintenance worker has been assigned and inspection has started"
}
```

Expect `200` with status `in_progress`.

## 6. Confirm the completed repair

Use the same PATCH endpoint:

```json
{
  "status": "resolved",
  "note": "The street light has been repaired and checked on site",
  "repair_verified": true
}
```

Expect `200` with status `resolved`. This field records management's human confirmation. In this practice, it simulates that confirmation; the backend does not inspect the physical repair.

## 7. Check progress as the resident

Log in to the original resident again and replace the management token in **Authorize**.

- `GET /reports/{ticket_id}`: status is `resolved`.
- `GET /reports/{ticket_id}/history`: four events in this order:

```text
pending_review -> approved -> in_progress -> resolved
```

History records the actor's user ID, note, and action time. Only the resolved event has `repair_verified: true`.
Call `GET /reports` with `status=resolved` to find the report in the resident's list.

## 8. Negative tests

Create new reports when testing rejection or skipped steps. Resolved reports are terminal.

| Test | Action | Expected |
| --- | --- | --- |
| Missing authentication | Clear authorization and call PATCH | `401` |
| Resident changes status | Call PATCH with a resident token | `403`; no status/history change |
| Unknown report | Management uses an unknown ticket ID | `404` |
| Skip review | Set a new pending report to in_progress | `409` |
| Skip maintenance | Set a pending or approved report to resolved with verification true | `409` |
| Missing repair confirmation | Resolve an in_progress report without repair_verified | `422` |
| Wrong verification type | Use `"true"` or `1` instead of boolean true | `422` |
| Missing explanation | Omit note or send empty/whitespace-only text | `422` |
| Duplicate action | Set approved to approved again | `409`; no additional history |
| Reject a report | Set pending_review to rejected with a note | `200` |
| Reopen a terminal report | Change rejected or resolved to another status | `409` |
| Read another resident's report | A second resident reads the first resident's report/history | `404` |
| Invalid filter | List reports with status=unknown | `422` |

A transition conflict returns:

```json
{
  "detail": "Cannot change report status from pending_review to resolved"
}
```

## 9. Restart and automated tests

After restarting the server, report statuses and history should remain available. Legacy reports may have no creation event or an empty history; new management actions are recorded normally.

```bash
python -B test_backend.py
```

Tests use temporary databases and cover permissions, transitions, repair verification, concurrent reviews, rollback, and restart persistence. They do not add accounts, reports, or events to the actual application database.

This version implements human review, maintenance status updates, and history. Photo uploads, AI assessment, maps, routing, push notifications, duplicate detection, and repair option comparisons remain future work.
