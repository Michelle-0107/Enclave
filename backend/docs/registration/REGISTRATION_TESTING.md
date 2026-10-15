# Resident OTP registration: local practice and hosted setup

The API is implemented in `backend.main:app` (v0.4.0). Real delivery/account creation is disabled when registration settings are incomplete. No real email or account was created while implementing this feature.

See [REGISTRATION_HANDOFF.md](REGISTRATION_HANDOFF.md) for the prepared private environment, teammate configuration, management bootstrap, and the first real signup. Run `python -m backend.tools.setup_registration` once to prepare a private secret without displaying it. The tool preserves existing secrets/settings; `python -m backend.tools.check_registration` then reports only missing names and configuration status.

## Local sandbox without cloud credentials

From the repository root, with the existing environment active:

```powershell
python -m backend.registration.demo
```

Open http://127.0.0.1:8002/docs. This separate app uses memory, fake email delivery, and fake Auth. It never reads the project's `.env`, connects to Supabase, or issues a Supabase JWT. It has one seeded resident record; restarting clears its state. Use synthetic passwords only.

1. Execute `POST /api/v1/registration/request-otp`:

```json
{
  "email": "resident@example.com",
  "invitation_token": "local-demo-invitation-token-000000000000000001"
}
```

2. Copy the returned `challenge_id`. Execute `POST /api/v1/registration/verify-and-signup`. Set the `Idempotency-Key` header to `local-demo-idempotency-key-000000000001` and send:

```json
{
  "challenge_id": "COPY_THE_RETURNED_UUID",
  "otp": "003482",
  "password": "local-demo-password"
}
```

The fixed OTP is a sandbox fixture. The request-OTP response still never returns a code. Production uses `secrets.randbelow` and email delivery.

3. The sandbox returns `demo-resident-token`. Use Swagger Authorize with that token, then execute `GET /api/v1/me/residency`. Demo tokens work only in the sandbox; the main API verifies real Supabase signatures.
4. Repeat the same signup request/key: it reuses the account/binding. A different key cannot consume that proof again. For another fresh scenario, restart the sandbox. Five wrong OTP submissions lock a challenge; the OTP expires after five minutes. Resend requires a 60-second wait and revokes the previous challenge.

The sandbox also accepts `demo-manager-token` for practicing management routes. Its roster simulation is intentionally limited; shared-unit, duplicate-record, profile protection, transaction, and concurrent-lease behavior need PostgreSQL tests.

## Hosted registration configuration

Keep the existing `SUPABASE_URL` and `SUPABASE_KEY`. Add these only to the server's `.env`/deployment secret settings:

```dotenv
SUPABASE_SECRET_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
OTP_HMAC_SECRET=
OTP_HMAC_VERSION=1
```

Use one Admin key name: `SUPABASE_SECRET_KEY` is preferred, or use legacy `SUPABASE_SERVICE_ROLE_KEY` instead. Never configure both or use a resident access token/publishable key as the Admin credential. Admin requests are isolated from resident report requests; modern API keys are sent only as `apikey`, and legacy service-role JWTs also use the Bearer header.

Generate at least 32 random bytes for the HMAC secret locally, for example with `python -c "import secrets; print(secrets.token_urlsafe(32))"`, and save the result privately. Use the same secret/version on all instances serving these challenges. Changing it invalidates unverified old codes; reconcile provisioning attempts before rotating/purging state. Do not include the output in shared screenshots or Git.

`RESEND_FROM_EMAIL` can include a display name, such as `Enclave <noreply@YOUR_VERIFIED_DOMAIN>`. Real resident delivery needs a verified sender domain. Resend's default `onboarding@resend.dev` is restricted to testing with the Resend account's own address. Sender configuration is required; the code does not silently use that default.

Apply [sql/005_registration_transitions.sql](../../sql/005_registration_transitions.sql) after the already-created 003 tables and 004 profile access. Do not rerun 003. SQL 005 adds one private infrastructure table, `registration_rate_limits`, and one service-role-only RPC for atomic transitions. It creates no accounts or resident rows. No database connection string/password is required by the HTTP RPC client.

Rerun [sql/inspect_registration_schema.sql](../../sql/inspect_registration_schema.sql) after installation. Expected: the RPC has no PUBLIC/anon/authenticated EXECUTE privilege; the rate table and invitation/challenge tables have no client grants; ordinary users have only own-resident SELECT and own-profile SELECT/full_name UPDATE.

## Management register and invitations

Management must first have a trusted existing Supabase App account and profile with role exactly `management`. Project administration creates/approves that profile; ordinary signup cannot assign this role. Existing accounts are not automatically added to the resident register.

- `POST /api/v1/management/residents` requires a verified manager JWT and `resident_reference`, `full_name`, `unit_number`, `registered_email`. Create one row per person, with an approved individual email. The unit can be shared; references/emails must be unique.
- `POST /api/v1/management/residents/{resident_id}/invitations` returns a high-entropy invitation token once to the authorized manager. Only its digest is stored. Management delivers it through the agreed channel; this endpoint does not send an email. Replacement revokes the old unused invitation and unverified challenges. A verified/provisioning attempt blocks replacement pending reconciliation.
- Residents use that invitation plus the matching email in request-OTP. The optional legacy URL `/api/send-verification-email` now requires this same body and returns only generic acceptance/challenge ID. Email-only clients must update their contract.

The verification endpoint accepts a six-character OTP string, password, challenge ID, and a random per-submit `Idempotency-Key` (at least 32 random bytes encoded base64url). Reuse the key and original password on transport retries. It confirms OTP, reserves a two-minute processing lease, authenticates or creates an Auth account, signs in, and atomically creates a missing profile with fixed `resident` role, binds the resident, consumes the invitation, and completes the challenge. It returns the Supabase session only after binding commits.

An existing account must authenticate with its own password and confirmed matching email. Its password/role are never overwritten. Unknown Auth creation results are reconciled through password sign-in, not email lookup alone. Signup recovery lasts ten minutes after verification; after that, an unfinished Auth/application state needs management reconciliation. Stale lease holders cannot finalize a binding. Sessions/passwords/plain OTPs are not persisted in application tables.

## Tests and rate limits

```powershell
python -B -m unittest -q backend.tests.test_registration backend.tests.test_cloud backend.tests.test_storage backend.tests.test_entrypoint
python -B -m unittest -q backend.tests.test_registration_setup
python -B -m backend.tools.export_openapi
```

These tests mock external providers and the state protocol. Separate [test_registration_postgres.py](../../tests/test_registration_postgres.py) executes the real 003/004/005 DDL and checks counters, concurrent claims, lease fencing, final binding, and role/RPC access in a dedicated loopback database. It runs only when `ENCLAVE_TEST_PG_DSN` points to host `127.0.0.1`, database `enclave_otp_test`; it must not point to a hosted or existing application database. The local test Auth schema is a fixture, not a real Supabase Auth service.

Shared counters use server-side HMACs for IP/email subjects. Fixed windows permit 20 requests per IP per minute, three send requests per email per 15-minute bucket, and ten verification requests per email per 15-minute bucket. Five failed OTP checks per challenge remain the tighter per-code limit. Fixed-window boundaries can permit adjacent-window bursts; do not describe these counters as rolling windows. Configure the server's trusted proxy handling so `request.client` reflects the intended peer; arbitrary request forwarding headers are not trusted by registration code.

Provider acceptance does not establish email verification or delivery. If delivery/acceptance recording fails, the challenge cannot verify; resend creates a new challenge after cooldown. Background delivery is in-process and is not a durable queue. Restarting can lose a pending send; an expired/pending challenge can be replaced. Plain OTPs are never placed in a database outbox.

An administrator can purge expired rate buckets after the operational retention window; the backend has no DELETE grants. Preserve invitation/binding/provisioning audit state until recovery and duplicate-account controls no longer depend on it.

## Remaining rollout work

Live Resend/Supabase Auth delivery, credentials, and account creation require separate authorized integration testing. Report API active-resident checks are implemented locally. Before live rollout, compare `sql/inspect_feature_access.sql` with the current hosted schema, review/apply `sql/006_active_resident_feature_rls.sql`, and run `sql/test_report_ownership.sql` in staging. Live hosted RLS behavior still needs integration testing. Frontend integration must install the returned real session with the Supabase SDK.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [Resend test-domain limits](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
