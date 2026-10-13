# Enclave

AI-powered community issue reporting and safety platform

## Requirements

- Python 3.12 or a compatible Python version

## Backend implementations

- The Supabase backend is in `backend/main.py` and uses the root `requirements.txt` and Supabase configuration.
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

These are separate backend applications. The Supabase implementation exposes `POST /api/reports`; the local implementation exposes `POST /reports` and the authentication/management endpoints in its contract. Their routes, request fields, authentication, and storage need to be aligned before cloud integration. Stop one server before running the other on port 8000.

## Supabase backend setup (Windows PowerShell)

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r ../requirements.txt
```

## Run locally

```powershell
python -m uvicorn main:app --reload
```

## Endpoints

- GET /health
- GET /docs
