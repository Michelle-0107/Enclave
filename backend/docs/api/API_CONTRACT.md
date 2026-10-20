# Enclave cloud API contract — v0.4.0

The cloud application is `main:app`. Run it from the repository root. The separate SQLite practice backend remains in `backend/local/`.

## Authentication

Invitation-bound signup uses the registration endpoints below and returns a Supabase session after binding. Frontend subsequent login/refresh/signout use Supabase Auth directly. Send its ES256 access token on every protected API request:

```http
Authorization: Bearer <supabase_access_token>
```

The API validates ES256 signatures against the configured project's public JWKS, or legacy HS256 signatures with `SUPABASE_JWT_SECRET`, then checks issuer, audience, expiry, issued-at time, required claims, authenticated database role, and UUID user ID. JWKS keys are cached for five minutes; unknown key IDs have a 30-second refresh cooldown. This checks issued tokens without querying session revocation on every request. Signout does not immediately invalidate an already issued unexpired JWT. Report submission and reads additionally require a matching resident row with `status = active` and non-null `verified_at`; `/auth/me` remains available to any valid authenticated account.

The application uses the exact names from the root `.env.example`. Every Data API request sends `SUPABASE_KEY` as `apikey` and the signed-in resident's access token as `Authorization: Bearer`; the user JWT remains the database identity for RLS. Registration uses the same `SUPABASE_KEY` for its privileged Auth Admin and transition RPC calls, so it must be a backend-only Supabase secret/service-role key. `SUPABASE_JWT_SECRET` is optional and only verifies legacy HS256 tokens; ES256 uses the project's public JWKS. Never put backend keys in frontend configuration. Database report requests include the individual user's JWT in per-request headers, avoiding a shared mutable Supabase login session. Every report read also includes the verified owner filter, and mismatched upstream ownership is rejected.

## Operations

| Method | Path                          | Access                                     | Success                        |
| ------ | ----------------------------- | ------------------------------------------ | ------------------------------ |
| GET    | `/`                           | Public                                     | 200 welcome message            |
| GET    | `/health`                     | Public                                     | 200 `{"status":"ok"}`          |
| GET    | `/auth/me`                    | Authenticated                              | 200 user ID and email          |
| POST   | `/api/v1/reports`             | Active verified resident                   | 201 report submission envelope |
| GET    | `/api/v1/reports`             | Active verified resident; own reports only | 200 paginated own reports      |
| GET    | `/api/v1/reports/{ticket_id}` | Active verified resident; own report only  | 200 own report, or 404         |

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

For mobile/web handoff, request examples, response fields, and deployment availability, see [REPORT_FRONTEND_INTEGRATION.md](REPORT_FRONTEND_INTEGRATION.md).

Content type: **multipart/form-data**. All four fields are required:

| Field         | Type           | Rules                                                                       |
| ------------- | -------------- | --------------------------------------------------------------------------- |
| `description` | string         | 1–1000 characters; whitespace-only text rejected; trimmed before processing |
| `latitude`    | number         | −90 to 90                                                                   |
| `longitude`   | number         | −180 to 180                                                                 |
| `file`        | uploaded photo | Declared MIME type image/jpeg or image/png; nonempty; maximum 10 MiB        |

Do not send `user_id`. Sending this form field returns 422 before S3/AI operations. The API assigns owner from the verified JWT.

The existing workflow is retained: photo upload to S3, Bedrock analysis, Gemini fallback, manual-review fallback, and insertion into Supabase. Blocking storage and AI SDK calls run in a worker thread. External clients initialize lazily, allowing Auth and report reads without AWS/Gemini credentials. Only validated category/priority/summary values are accepted from AI; malformed analysis uses the manual-review fallback.

The response retains `success`, `message`, `ticket_id`, `ai_analysis`, `image_url`, and `data`. `data` is an array containing exactly one created report. Owner is always the verified user, initial status is `pending`, and `is_approved` is false. New ticket IDs use `TICK-` followed by 32 hexadecimal characters, so the database column must support at least 37 characters. Treat IDs as opaque strings.

This milestone retains the team's current storage behavior: report `description` is the AI summary or fallback description. Separately preserving the original text and resident confirmation of suggestions require a subsequent schema/contract change. The local SQLite workflow's `pending_review` status is not migrated in this change.

An uploaded S3 object can remain if a later AI/database operation fails. S3 URL accessibility depends on the bucket's existing policy; report ownership rules do not establish private photo delivery. Photo content validation and private delivery can be refined with the storage owner.

Configure photo storage with `S3_BUCKET_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY`, and `AWS_SECRET_ACCESS_KEY`; these are the environment names in the root example. The deployment's normal IAM credential chain remains available when no explicit key pair is set. `BEDROCK_MODEL_ID` selects the Bedrock model and defaults to the code's Nova Lite model when blank; `GEMINI_API_KEY` enables the fallback provider. Incomplete key pairs fail the storage operation without displaying credential values. Run `python -B -m backend.tools.check_storage` for a configuration-only check, or explicitly add `--upload-test` to upload/read/clean up one generated test PNG independently of Supabase and AI. This is a developer CLI, not a new API endpoint.

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

Run [sql/inspect_feature_access.sql](../../sql/inspect_feature_access.sql) first and compare its output with the reviewed schema. Then review [sql/006_active_resident_feature_rls.sql](../../sql/006_active_resident_feature_rls.sql) with the project owner before applying it in Supabase SQL Editor. SQL 006 enables RLS and requires active, verified resident binding for report, notification, and category Data API access. Reports remain owner-only and can only be inserted as pending/unapproved; residents can read their own notifications and update only `is_read`; categories are read-only. Anonymous client access is revoked. It also adds restrictive guards against broader existing policies. It does not grant management report review or public map access; those need their own API and policy design. Run [sql/test_report_ownership.sql](../../sql/test_report_ownership.sql) after SQL 006 in staging to exercise two-user isolation, inactive/unbound denial, notification privacy, and forbidden writes. The older SQL 001 is superseded and should not be used for the resident launch. These scripts have not been applied automatically to your project.

## Resident registration (v0.4.0)

See [REGISTRATION_TESTING.md](../registration/REGISTRATION_TESTING.md) for the local sandbox, SQL 005, server settings, and full lifecycle.

| Method/path                                          | Authentication                         | Contract                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/v1/registration/request-otp`              | Public, invitation-bound, rate limited | `email`; 202 generic message + `challenge_id`, no OTP/provider response. The active invitation is looked up by registered email; no invitation token is entered by the resident. |
| POST `/api/v1/registration/verify-and-signup`        | OTP + same-request proof + password    | `challenge_id`, six-digit OTP string, password; `Idempotency-Key` header; session/resident/user IDs only after committed binding. |
| GET `/api/v1/me/residency`                           | Supabase JWT                           | Own resident ID, unit, active/inactive state, verification timestamp; 404 if unbound.                                             |
| POST `/api/v1/management/residents`                  | JWT + trusted profile role management  | Approved roster fields; 201 resident ID.                                                                                          |
| POST `/api/v1/management/residents/{id}/invitations` | JWT + trusted profile role management  | 201 server-side invitation record ID, resident ID, and expiry; no plaintext token is returned.                                    |

POST `/api/send-verification-email` is a deprecated alias of request-OTP with the same invitation requirement. It never returns generated_code. Registration responses/errors containing proof/session data use Cache-Control no-store, and validation errors do not echo secret inputs. Registration is 503 when configuration/SQL is unavailable; invalid proof is 400, rate exhaustion 429, account/provisioning conflict 409, unauthorized management 403. The API never accepts a caller-selected role, user ID, approval flag, or email-confirmation flag.

## Existing report setup and tests

From repository root, in an activated virtual environment:

```bash
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
python -B -m unittest -q backend.tests.test_cloud
python -B -m unittest -q backend.tests.test_storage
python -B -m backend.tools.export_openapi
```

The 37 cloud API offline tests use ephemeral signing keys, synthetic residents, and mocked Supabase/S3/AI services. Real storage, AI provider availability, and live RLS are separate integration checks.

In another terminal, test an existing confirmed Supabase App account:

```bash
python -B -m backend.tools.check_session
```

To explicitly display the verified access token for local Swagger Authorize:

```bash
python -B -m backend.tools.check_session --show-token
```

Tokens are hidden by default; the optional output is a real credential and should stay out of shared screenshots and files. The helper creates one login session but no accounts or reports. Its API target is loopback only, with optional `--port 8001` or `--port 8002`.

The server reads the `.env` in the parent directory of the package, with explicit process environment values taking precedence. S3/Gemini secrets stay in local configuration. Docker continues to start `main:app`.

References: [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL policy composition](https://www.postgresql.org/docs/current/sql-createpolicy.html).


## Community issues and route choices

The current map is independent of maintenance approval: one marker per explicit
facility incident after two distinct verified residents link their own report tickets.
Photo reports remain private. Unlinked legacy reports are not guessed into groups.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/v1/facilities` | Select/create a facility point |
| GET/POST | `/api/v1/community/issues` | Discover points (including count 1) or open/reuse a facility incident |
| POST | `/api/v1/community/issues/{issue_id}/reports` | Link an owned report ticket, one vote per resident |
| GET | `/api/v1/map/issues` | GeoJSON points with at least two reporters |
| GET | `/api/v1/navigation/obstacles` | Current threshold-qualified road incident zones |
| GET | `/api/v1/navigation/area` | Pilot and accessibility coverage metadata |
| POST | `/api/v1/navigation/routes` | shortest / avoid_damage / accessible |

All these endpoints require active verified residency. SQL 009 is required for
community data/damage modes; SQL 007 remains the maintenance workflow. Management
approval/rejection does not publish/remove an incident. A verified repair audit closes
it; the next fresh incident resets the count. SQL 008 is historical, with its old
management routing-impact endpoints retired. No hosted SQL is applied automatically.

Shortest ignores incident damage while respecting walking access. Avoid_damage excludes
two-resident road issues without approval. Accessible excludes those issues and uses
only assessed, unexpired step-free connections. Current real accessible coverage is
empty: return 422/no verified route, never an ordinary route labelled accessible.
Routing responses expose snapshot counts/time and source, not reporter identity or
private evidence. No new application environment variables are required.

See [COMMUNITY_ROUTES_TESTING.md](COMMUNITY_ROUTES_TESTING.md) for request/response
fields, errors, lifecycle, the sandbox, migration order, and accessible graph schema.

## Maintenance review (unchanged)

SQL 007 supports GET `/api/v1/management/reports`, PATCH
`/api/v1/management/reports/{ticket_id}/status`, and GET
`/api/v1/reports/{ticket_id}/history`. Management reviews atomically append audit
events; residents can read their own history. pending -> approved/rejected;
approved -> in_progress; in_progress -> resolved requires repair_verified=true.
Service-team features are outside this change. See REPORT_WORKFLOW_TESTING.md.


## Management What-if repair comparison

GET `/api/v1/management/what-if/candidates` and POST
`/api/v1/management/what-if/compare` require a verified JWT and trusted management
profile role, with no resident binding. SQL 010 supplies a read-only candidate
snapshot. Plans hypothetically remove selected facilities' current two-resident
incident restrictions and retain all other obstacles. Management supplies major
origin/destination journeys and optional MYR cost estimates/budget. Responses
separate reference-intersecting path counts from actual restored/shortened paths.
Accessible paths without a verified reference are not assessable. No live
report/issue mutations, new env names, scenario persistence or user tracking.
See [WHAT_IF_API.md](WHAT_IF_API.md) for the exact bounded contract and sandbox.
