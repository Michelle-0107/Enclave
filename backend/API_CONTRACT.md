# Enclave cloud API contract — v0.4.0

The cloud application is `backend.main:app`. Run it from the repository root. The separate SQLite practice backend remains in `backend/local/`.

## Authentication

Invitation-bound signup uses the registration endpoints below and returns a Supabase session after binding. Frontend subsequent login/refresh/signout use Supabase Auth directly. Send its ES256 access token on every protected API request:

```http
Authorization: Bearer <supabase_access_token>
```

The API validates the signature against the configured project's public JWKS, issuer, audience, expiry, issued-at time, required claims, authenticated database role, and UUID user ID. Keys are cached for five minutes; unknown key IDs have a 30-second refresh cooldown. This checks issued tokens without querying session revocation on every request. Signout does not immediately invalidate an already issued unexpired JWT. Report submission and reads additionally require a matching resident row with `status = active` and non-null `verified_at`; `/auth/me` remains available to any valid authenticated account.

Normal Auth/report operations use `SUPABASE_PUBLISHABLE_KEY` and the individual user's JWT. Server-only registration clients separately require an Admin key; that key is never used for resident report requests. The old `SUPABASE_KEY` variable is no longer read by this application. Database report requests include the individual user's JWT in per-request headers, avoiding a shared mutable Supabase login session. Every report read also includes the verified owner filter, and mismatched upstream ownership is rejected.

## Operations

| Method | Path | Access | Success |
| --- | --- | --- | --- |
| GET | `/` | Public | 200 welcome message |
| GET | `/health` | Public | 200 `{"status":"ok"}` |
| GET | `/auth/me` | Authenticated | 200 user ID and email |
| POST | `/api/v1/reports` | Active verified resident | 201 report submission envelope |
| GET | `/api/v1/reports` | Active verified resident; own reports only | 200 paginated own reports |
| GET | `/api/v1/reports/{ticket_id}` | Active verified resident; own report only | 200 own report, or 404 |

Health is liveness only. Missing, malformed, invalid, or expired tokens return 401 with `WWW-Authenticate: Bearer`. Verification-key or resident-directory failures return 503. Accounts without an active, verified resident binding return 403 before report upload/AI work. Database policy/grant rejection also returns 403; other database failures return 503. Upstream error bodies and credentials are not echoed.

### GET /auth/me

```json
{
  "user_id": "00000000-0000-4000-8000-000000000001",
  "email": "resident@example.com"
}
```

The example is synthetic. Email can be null. The endpoint reads verified token claims, not the current Auth profile.

### POST /api/v1/reports

Content type: **multipart/form-data**. All four fields are required:

| Field | Type | Rules |
| --- | --- | --- |
| `description` | string | 1–1000 characters; whitespace-only text rejected; trimmed before processing |
| `latitude` | number | −90 to 90 |
| `longitude` | number | −180 to 180 |
| `file` | uploaded photo | Declared MIME type image/jpeg or image/png; nonempty; maximum 10 MiB |

Do not send `user_id`. Sending this form field returns 422 before S3/AI operations. The API assigns owner from the verified JWT.

The existing workflow is retained: photo upload to S3, Bedrock analysis, Gemini fallback, manual-review fallback, and insertion into Supabase. Blocking storage and AI SDK calls run in a worker thread. External clients initialize lazily, allowing Auth and report reads without AWS/Gemini credentials. Only validated category/priority/summary values are accepted from AI; malformed analysis uses the manual-review fallback.

The response retains `success`, `message`, `ticket_id`, `ai_analysis`, `image_url`, and `data`. `data` is an array containing exactly one created report. Owner is always the verified user, initial status is `pending`, and `is_approved` is false. New ticket IDs use `TICK-` followed by 32 hexadecimal characters, so the database column must support at least 37 characters. Treat IDs as opaque strings.

This milestone retains the team's current storage behavior: report `description` is the AI summary or fallback description. Separately preserving the original text and resident confirmation of suggestions require a subsequent schema/contract change. The local SQLite workflow's `pending_review` status is not migrated in this change.

An uploaded S3 object can remain if a later AI/database operation fails. S3 URL accessibility depends on the bucket's existing policy; report ownership rules do not establish private photo delivery. Photo content validation and private delivery can be refined with the storage owner.

Configure photo storage with `S3_BUCKET_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`; temporary credentials also need `AWS_SESSION_TOKEN`. The existing `AWS_ACCESS_KEY` alias is supported, and the deployment's normal IAM credential chain remains available when no explicit pair is set. Incomplete or conflicting explicit key settings fail the storage operation without displaying credential values. Run `python -B -m backend.check_storage` for a configuration-only check, or explicitly add `--upload-test` to upload/read/clean up one generated test PNG independently of Supabase and AI. This is a developer CLI, not a new API endpoint.

### GET /api/v1/reports

Query parameters: `limit` defaults to 10, range 1–100; `offset` defaults to 0, minimum 0. Ordered by `created_at DESC, ticket_id DESC`. No owner-selection parameter is supported; the owner filter always comes from the token.

```json
{
  "items": [],
  "limit": 10,
  "offset": 0
}
```

There is no total count in this version. A signed-in user cannot read another owner's reports, including reviewed reports. Legacy reports without an owner remain in the database and are not included in My Reports.

### GET /api/v1/reports/{ticket_id}

Ticket IDs contain 1–128 ASCII letters, digits, underscores, or hyphens. Unknown and inaccessible IDs both return `404 {"detail":"Report not found"}`. Successful records expose only declared response fields: ticket ID, owner, description, status, creation time, coordinates, photo URL, category, priority, and approval flag. Creation time can be null for legacy data.

## Database setup and validation

The existing `public.reports` must contain `ticket_id`, `user_id`, `description`, `status`, `created_at`, `latitude`, `longitude`, `image_url`, `category`, `priority`, and `is_approved`. Ownership SQL expects UUID `user_id` and boolean `is_approved`; defaults, types, ticket length, and foreign keys must be reviewed in the project. The migration stops if key types are incompatible.

Run [sql/inspect_feature_access.sql](sql/inspect_feature_access.sql) first and compare its output with the reviewed schema. Then review [sql/006_active_resident_feature_rls.sql](sql/006_active_resident_feature_rls.sql) with the project owner before applying it in Supabase SQL Editor. SQL 006 enables RLS and requires active, verified resident binding for report, notification, and category Data API access. Reports remain owner-only and can only be inserted as pending/unapproved; residents can read their own notifications and update only `is_read`; categories are read-only. Anonymous client access is revoked. It also adds restrictive guards against broader existing policies. It does not grant management report review or public map access; those need their own API and policy design. Run [sql/test_report_ownership.sql](sql/test_report_ownership.sql) after SQL 006 in staging to exercise two-user isolation, inactive/unbound denial, notification privacy, and forbidden writes. The older SQL 001 is superseded and should not be used for the resident launch. These scripts have not been applied automatically to your project.

## Resident registration (v0.4.0)

See [REGISTRATION_TESTING.md](REGISTRATION_TESTING.md) for the local sandbox, SQL 005, server settings, and full lifecycle.

| Method/path | Authentication | Contract |
| --- | --- | --- |
| POST `/api/v1/registration/request-otp` | Public, invitation-bound, rate limited | `email`, `invitation_token`; 202 generic message + `challenge_id`, no OTP/provider response. |
| POST `/api/v1/registration/verify-and-signup` | OTP + same-request proof + password | `challenge_id`, six-digit OTP string, password; `Idempotency-Key` header; session/resident/user IDs only after committed binding. |
| GET `/api/v1/me/residency` | Supabase JWT | Own resident ID, unit, active/inactive state, verification timestamp; 404 if unbound. |
| POST `/api/v1/management/residents` | JWT + trusted profile role management | Approved roster fields; 201 resident ID. |
| POST `/api/v1/management/residents/{id}/invitations` | JWT + trusted profile role management | 201 invitation token (once), ID, resident ID, expiry. |

POST `/api/send-verification-email` is a deprecated alias of request-OTP with the same invitation requirement. It never returns generated_code. Registration responses/errors containing proof/session data use Cache-Control no-store, and validation errors do not echo secret inputs. Registration is 503 when configuration/SQL is unavailable; invalid proof is 400, rate exhaustion 429, account/provisioning conflict 409, unauthorized management 403. The API never accepts a caller-selected role, user ID, approval flag, or email-confirmation flag.

## Existing report setup and tests

From repository root, in an activated virtual environment:

```bash
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload
python -B -m unittest -q backend.tests.test_cloud
python -B -m unittest -q backend.tests.test_storage
python -B -m backend.export_openapi
```

The 37 cloud API offline tests use ephemeral signing keys, synthetic residents, and mocked Supabase/S3/AI services. Real storage, AI provider availability, and live RLS are separate integration checks.

In another terminal, test an existing confirmed Supabase App account:

```bash
python -B -m backend.check_session
```

To explicitly display the verified access token for local Swagger Authorize:

```bash
python -B -m backend.check_session --show-token
```

Tokens are hidden by default; the optional output is a real credential and should stay out of shared screenshots and files. The helper creates one login session but no accounts or reports. Its API target is loopback only, with optional `--port 8001` or `--port 8002`.

The server reads the `.env` in the parent directory of the package, with explicit process environment values taking precedence. S3/Gemini secrets stay in local configuration. Docker continues to start `backend.main:app`.

References: [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL policy composition](https://www.postgresql.org/docs/current/sql-createpolicy.html).
