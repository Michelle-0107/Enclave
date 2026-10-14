# Enclave

AI-powered community issue reporting and safety platform

## Requirements

- Python 3.11 or newer for the cloud API; Python 3.12 or newer for the SQLite practice backend.

## Backend implementations

- The cloud backend is `backend.main:app`, uses root `requirements.txt`, verifies Supabase JWTs, and exposes owner-only reports with the existing S3/AI submission pipeline. See its [API contract](backend/API_CONTRACT.md).
- The local workflow backend is in `backend/local/` and uses its own `requirements.txt`, local authentication, and SQLite. It supports report ownership, management review, maintenance status changes, and action history without a cloud account.

### Run the local workflow backend

From the repository root in Windows PowerShell:

```powershell
cd backend/local
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m fastapi dev main.py
```

Open http://127.0.0.1:8000/docs. For setup, account creation, automated tests, and manual walkthroughs, see the [local backend README](backend/local/README.md) and [API contract](backend/local/API_CONTRACT.md).

These are separate backend applications. The cloud implementation uses Supabase access tokens and `/api/v1/reports`; the local implementation uses opaque local tokens and `/reports`. SQLite management workflows are not yet migrated into the cloud API. Use different ports when running both.

## Supabase backend setup (Windows PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Run locally

```powershell
python -m uvicorn backend.main:app --reload
```

## Endpoints

- GET `/health`
- GET `/auth/me` — requires Supabase access token
- POST `/api/v1/reports` — authenticated photo submission; owner assigned by token
- GET `/api/v1/reports` — own reports with pagination
- GET `/api/v1/reports/{ticket_id}` — own report detail
- Swagger UI: `http://127.0.0.1:8000/docs`

Copy the blank root `.env.example` to `.env`, then set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_KEY` is no longer used by this application. JWT verification and report reads do not require AWS/Gemini settings; photo submission additionally requires configured S3 access and bucket settings.

Review the [ownership migration](backend/sql/001_report_ownership.sql) and [transactional RLS tests](backend/sql/test_report_ownership.sql) with the project owner. Anonymous report access and signed-in update/delete are disabled by this migration; management roles and public map access are a later integration.

```powershell
python -B -m unittest -q backend.tests.test_cloud
python -B -m backend.check_session
```

For local Swagger testing, explicitly request token output with `python -B -m backend.check_session --show-token`. The password stays hidden, and tokens are not printed by default.

## Run Docker

build and start container:
docker compose up --build -d

check runtime logs:
docker compose logs -f

stop container:
docker compose down
