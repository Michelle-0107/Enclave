# Registration handoff: server configuration and first real signup

The registration backend is implemented in v0.4.0. SQL 003/004/005 have been applied by the project owner. Application deployment and real provider checks remain separate from local automated tests. All source/templates are English; real secrets belong only in private environment files or deployment secret settings.

## Prepared private configuration

`python -m backend.tools.setup_registration` checks that the existing registration fields are present; it never edits `.env`, generates or rotates secrets, or calls providers. Keep the root `.env.example` exactly as provided and use only its listed names.

For the shared local project, copy the root `.env.example` to the private root `.env` and fill the existing fields. Registration requires `SUPABASE_URL`, `SUPABASE_KEY`, and `RESEND_API_KEY`; `SUPABASE_JWT_SECRET` is optional for legacy HS256 tokens. It adds no variables.

Use one project's URL and backend-only Supabase secret/service-role key. Do not expose `SUPABASE_KEY` or `SUPABASE_JWT_SECRET` to the frontend. The OTP HMAC key is derived with purpose separation from `SUPABASE_KEY`; keep the key stable across app instances sharing challenges. Rotating it makes outstanding OTP digests unverifiable.

The Resend sender is a code-level constant in `backend/registration/settings.py`, currently `Enclave <onboarding@resend.dev>`. Resend's test sender is limited to the account's own address; resident delivery requires updating that constant to an address on a verified domain. No sender environment variable is added to the template.

## Check and start locally

From the repository root:

```powershell
python -m backend.tools.check_registration
python -m backend.tools.check_registration --check-database
python -m uvicorn main:app --reload --port 8001
```

The first command checks formats and missing fields offline. The explicit database check calls the SQL 005 RPC with an unsupported action that changes no rows; success proves backend RPC access only. Neither command sends email, creates an account, or proves Resend sender verification. Keep the startup app on v0.4.0; an older deployed app does not gain these routes by receiving new variables.

For the local mirrored package, use:

```powershell
cd "D:\Sime Darby hackathon\Backend"
& "..\.venv\Scripts\python.exe" -m cloud.check_registration
& "..\.venv\Scripts\python.exe" -m cloud.check_registration --check-database
& "..\.venv\Scripts\python.exe" -m uvicorn cloud.main:app --reload --port 8001
```

Open http://127.0.0.1:8001/docs. The port 8002 sandbox is a separate fake app; use 8001 for real email/Auth tests. Stop and restart the real server after editing `.env`.

## Management account and the first resident

1. Project administration creates and confirms the intended management **App account** in Supabase Authentication > Users. Dashboard login credentials are a separate account.
2. Administration reviews [sql/bootstrap_management.sql](../../sql/bootstrap_management.sql), fills the intended Auth UUID and exact email, and runs it in this project's SQL Editor. It refuses unchanged placeholders, unconfirmed/mismatched accounts, resident registration history, and conflicting profile email. This is trusted manual role assignment, not a client signup capability.
3. Management signs in with its App credentials. Use `python -m backend.tools.check_session --port 8001 --show-token` locally, then paste its access token into Swagger Authorize. The helper displays a token only with the explicit flag; keep it private.
4. Execute `POST /api/v1/management/residents` with the real approved person's details:

```json
{
  "resident_reference": "REPLACE_WITH_APPROVED_REFERENCE",
  "full_name": "REPLACE_WITH_APPROVED_NAME",
  "unit_number": "REPLACE_WITH_UNIT",
  "registered_email": "REPLACE_WITH_APPROVED_EMAIL"
}
```

5. Add the resident through the management frontend. It creates the resident record and then creates the server-side invitation record; no plaintext invitation token is returned or shared.
6. The resident submits their approved email only to `POST /api/v1/registration/request-otp`; copy the returned `challenge_id`. A generic 202 alone does not prove eligibility/delivery. Read the real email for the OTP.
7. Generate a random `Idempotency-Key` privately, submit the challenge ID, six-digit OTP string, and password to `POST /api/v1/registration/verify-and-signup`. Reuse the same key/password on retries. Success returns the resident binding and real Supabase access/refresh session.
8. Authorize with the resident's access token and call `GET /api/v1/me/residency`; confirm the expected resident/unit. The frontend installs the returned session with its Supabase SDK. Existing confirmed accounts use their own password; signup does not reset their credentials.

The implementation does not invent resident records or automatically approve existing accounts. Management and resident business data are being prepared by the team. First real testing should use an explicitly approved test resident/email and account; it sends an email and can create an Auth account/binding.

## Hosted use

The reviewed implementation is in the repository branch. The repository owner must merge/review and deploy that code before the Render URL exposes it. Configure the listed environment fields privately; confirm `/openapi.json` reports version 0.4.0 and the registration routes, then perform the authorized real signup steps above.

Report/notification/category policies and active-resident authorization remain separate feature work. This handoff prepares the registration flow, not a claim that every Enclave feature is production-ready. See [REGISTRATION_TESTING.md](../registration/REGISTRATION_TESTING.md) for expiry, attempts, recovery, and background-delivery limits.
