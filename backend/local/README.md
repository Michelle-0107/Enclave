# Enclave Backend

FastAPI backend for Enclave, a community issue reporting and maintenance application.
Version **0.2.0** supports local authentication, report ownership, pagination, management review, maintenance status changes, and action history using SQLite.

## Requirements

- Python 3.12 or newer; the current implementation has been tested with Python 3.14.
- Dependencies listed in `requirements.txt`.
- No Supabase or AWS account is required for local development.

Run the following commands from the directory containing `main.py` and this README. In a shared repository, this is normally the `Backend` directory.

## Run locally

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m fastapi dev main.py
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m fastapi dev main.py
```

If you already have an activated virtual environment with these requirements, use it instead of creating another one.

- API: http://127.0.0.1:8000
- Swagger UI: http://127.0.0.1:8000/docs
- Live OpenAPI schema: http://127.0.0.1:8000/openapi.json

The server creates `enclave.db` beside `main.py` on startup. Existing local data is preserved by additive schema migrations. The database is excluded from Git.

## Features and access

- Public signup creates resident accounts only.
- Login returns an opaque bearer token valid for one hour.
- Residents can create reports and read only their own reports and history.
- Management can read all reports, approve or reject reports, and update maintenance status.
- Report lists support `limit`, `offset`, and an optional `status` filter.
- Status changes and their history events are stored together in a transaction.

The maintenance workflow is:

```text
pending_review -> approved -> in_progress -> resolved
pending_review -> rejected
```

Every status change requires a note. Resolving a report also requires `repair_verified: true`, recording management's confirmation that the repair was checked. The backend records this confirmation; it does not inspect the physical repair. Rejected and resolved reports are terminal in this version.

## API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API liveness |
| POST | `/auth/signup` | Register a resident |
| POST | `/auth/login` | Obtain a bearer token |
| GET | `/auth/me` | Read the current user |
| POST | `/auth/logout` | Revoke the current session |
| POST | `/reports` | Submit a report |
| GET | `/reports` | List visible reports |
| GET | `/reports/{ticket_id}` | Read a report |
| GET | `/reports/{ticket_id}/history` | Read a report's action history |
| GET | `/management/reports` | List all reports for management |
| PATCH | `/management/reports/{ticket_id}/status` | Review a report or update maintenance status |

For request fields, responses, error codes, and permissions, see [API_CONTRACT.md](API_CONTRACT.md).

## Create a management account

From the backend directory, with the virtual environment activated:

```bash
python create_manager.py
```

Enter a new username and a password of at least 12 characters, then confirm the password. Password input is hidden. Existing usernames are rejected and are not promoted to management.

Log in through Swagger, copy the returned `access_token`, and paste only the token into **Authorize**. For API clients, send `Authorization: Bearer <access_token>`.

## Test

```bash
python -B test_backend.py
```

The current suite contains 42 tests covering authentication, ownership, pagination, permissions, schema migration, workflow transitions, repair verification, history, concurrent reviews, rollback, and restart persistence. Tests use temporary databases and do not add test records to the local application database.

Manual walkthroughs:

- [Authentication and authorization](AUTH_PRACTICE.md)
- [Local maintenance workflow](LOCAL_WORKFLOW_PRACTICE.md)

## Update the OpenAPI snapshot

```bash
python -B export_openapi.py
```

This regenerates `openapi.json` from the code without starting the server or opening the database. Regenerate it whenever the API schema or documentation changes.

## Check the Supabase connection

The read-only probe checks the Enclave project's existing `public.reports` columns without requesting report rows. Follow [SUPABASE_CONNECTION_PRACTICE.md](SUPABASE_CONNECTION_PRACTICE.md), fill the local `.env` from `.env.example`, then run:

```bash
python -B check_supabase.py
```

To test the helper without network access or credentials:

```bash
python -B test_supabase_check.py
```

This is a connection check. The application continues to use SQLite and local authentication while the cloud schema and Auth integration are agreed upon.

## Repository contents

| File | Purpose |
| --- | --- |
| `main.py` | API models, authentication, SQLite persistence, and report workflows |
| `create_manager.py` | Interactive management account creation |
| `export_openapi.py` | OpenAPI snapshot export |
| `check_supabase.py` | Read-only Supabase Data API connection probe |
| `test_backend.py` | Automated backend tests |
| `test_supabase_check.py` | Mocked connection probe tests |
| `requirements.txt` | Runtime and test dependencies |
| `openapi.json` | Shareable API schema snapshot |
| `README.md` | Setup, commands, and project overview |
| `API_CONTRACT.md` | Frontend integration contract |
| `AUTH_PRACTICE.md` | Authentication testing guide |
| `LOCAL_WORKFLOW_PRACTICE.md` | Maintenance workflow testing guide |
| `SUPABASE_CONNECTION_PRACTICE.md` | Supabase connection setup and schema alignment notes |
| `.env.example` | Blank shareable Supabase configuration template |
| `.gitignore` | Excludes local environments, databases, configuration, and caches |

Commit the source, dependencies, schema, and documentation. Local databases contain account and session data and must stay outside the repository. The ignore rules cover `enclave.db`, SQLite sidecar files, virtual environments, `.env` files, caches, and backups.

## Planned integrations

Supabase Auth/PostgreSQL integration is pending. This version uses local accounts and opaque tokens rather than Supabase JWTs. Photo uploads, AI assessment, community maps, routing, push notifications, duplicate detection, and repair option comparisons are not implemented yet. CORS is not configured; agree on allowed origins before connecting a browser frontend. Mobile clients need a backend address reachable from their device because `127.0.0.1` refers to the device itself.
