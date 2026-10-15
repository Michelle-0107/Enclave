# Enclave

AI-powered community issue reporting and safety platform

The cloud API implements [single-community resident registration](backend/RESIDENT_REGISTRATION_MVP.md) with FastAPI-generated email OTPs and Resend delivery. After invitation-bound OTP verification, it authenticates or creates a Supabase account, signs in, and atomically binds the resident before returning the session. Start with the credential-free [local sandbox and setup guide](backend/REGISTRATION_TESTING.md).

For server setup, run `python -m backend.setup_registration` to prepare the private OTP secret, then `python -m backend.check_registration` to check configuration without sending email or creating accounts. The [registration handoff](backend/REGISTRATION_HANDOFF.md) covers the three remaining key/sender fields, trusted management initialization, and first real signup. Add `--check-database` to explicitly probe the installed RPC without changing rows.

The supplied post-application schema metadata was reviewed in [REGISTRATION_SCHEMA_REVIEW.md](backend/REGISTRATION_SCHEMA_REVIEW.md). The user has applied the registration table/profile SQL and reports applying SQL 005; anonymous transition-RPC denial is verified. Hosted registration requires server-only credentials and the approved management register. Local PostgreSQL registration tests pass; live Resend/Supabase Auth integration and SQL 006 feature-table RLS still require staging validation.

## Requirements

- Python 3.11 or newer for the cloud API; Python 3.12 or newer for the SQLite practice backend.

## Backend implementations

- The cloud backend is `backend.main:app`, uses root `requirements.txt`, verifies Supabase JWTs, and restricts report routes to active verified residents while retaining owner-only report access and the S3/AI submission pipeline. See its [API contract](backend/API_CONTRACT.md).
- Root `main:app` re-exports that same application for the team's Render/Docker startup command. The older standalone report router is retained as source history and is not mounted; it must not be registered alongside the protected routes.
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
- POST `/api/v1/registration/request-otp` — invitation-bound email OTP request
- POST `/api/v1/registration/verify-and-signup` — OTP verification, resident binding, and Supabase session
- GET `/api/v1/me/residency` — authenticated resident binding
- POST `/api/v1/management/residents` — management-only resident register
- POST `/api/v1/management/residents/{resident_id}/invitations` — management-only invitation issuance
- POST `/api/v1/reports` — authenticated photo submission; owner assigned by token
- GET `/api/v1/reports` — own reports with pagination
- GET `/api/v1/reports/{ticket_id}` — own report detail
- Swagger UI: `http://127.0.0.1:8000/docs`

Copy the blank root `.env.example` to `.env`, then set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_KEY` is no longer used by this application. JWT verification and report reads do not require AWS/Gemini settings; photo submission additionally requires configured S3 access and bucket settings.

Before resident-only feature access is enabled in Supabase, ask the project owner to run the [read-only feature access inspection](backend/sql/inspect_feature_access.sql) in the Enclave project's SQL Editor and compare the result with the current schema. Review [SQL 006](backend/sql/006_active_resident_feature_rls.sql) before applying it in staging, then run its [transactional RLS tests](backend/sql/test_report_ownership.sql). The earlier SQL 001 is superseded. SQL 006 blocks direct client access for unbound/inactive residents, makes reports owner-only, and limits notification updates to `is_read`; it does not add management review or public map APIs.

```powershell
python -B -m unittest -q backend.tests.test_cloud
python -B -m backend.check_session
```

For registration practice without cloud credentials, run `python -m backend.registration_demo` and open http://127.0.0.1:8002/docs. See the [registration testing guide](backend/REGISTRATION_TESTING.md) for synthetic inputs, real server configuration, and SQL installation. The sandbox uses fake tokens; the main app requires real Supabase JWTs.

For local Swagger testing, explicitly request token output with `python -B -m backend.check_session --show-token`. The password stays hidden, and tokens are not printed by default.

### Test photo storage independently

Set `S3_BUCKET_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in the root `.env`. Add `AWS_SESSION_TOKEN` only when using temporary credentials. The existing `AWS_ACCESS_KEY` alias remains supported; do not configure different IDs under both names. Keep keys out of Git.

```powershell
python -B -m backend.check_storage
python -B -m backend.check_storage --upload-test
python -B -m unittest -q backend.tests.test_cloud backend.tests.test_storage
```

The first command validates configuration without contacting AWS. The explicit upload test writes one generated 2x2 PNG with a new `report_storage_check_<uuid>.png` key, verifies its bytes using authenticated S3 download, and attempts to delete only that test object. Versioned buckets use the exact version created by the test. No Supabase, Bedrock, Gemini, bucket-policy changes, bucket listing, or other-object operations are involved.

The test needs `s3:PutObject` and `s3:GetObject` for its test key, plus `s3:DeleteObject` for cleanup in an unversioned bucket. Versioned buckets require `s3:GetObjectVersion` and `s3:DeleteObjectVersion` for the created version. Bucket encryption can require additional KMS permissions. If cleanup is denied, the command reports the remaining key for the bucket owner. A successful authenticated download does not establish public URL accessibility or report-level authorization.

## Run Docker

build and start container:
docker compose up --build -d

check runtime logs:
docker compose logs -f

stop container:
docker compose down
