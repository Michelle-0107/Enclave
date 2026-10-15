# Enclave Supabase Connection Practice

Use this read-only probe to confirm that the local backend environment can reach the Enclave project's Data API and query the existing `public.reports` table. The probe requests zero rows and does not change Supabase tables or data.

The FastAPI application continues to use SQLite and local authentication. This step does not migrate storage or enable Supabase Auth. No new Swagger endpoint is added.

## 1. Prepare the environment

Run commands from the directory containing `main.py`, with your virtual environment activated:

```powershell
python -m pip install -r requirements.txt
```

The helper uses HTTPX and python-dotenv; both are declared explicitly in `requirements.txt`.

If `.env` does not exist, create it from the blank example:

```powershell
Copy-Item .env.example .env
```

If `.env` already exists, keep it and fill the two relevant variables from the agreed environment format. The helper reads only `.env` beside `check_supabase.py`; it does not search parent folders or update process environment variables. Explicit process variables take precedence. The example contains the same ten approved names used by the backend; this probe reads only `SUPABASE_URL` and `SUPABASE_KEY`.

## 2. Add the project configuration

Open the **Enclave** project in the [Supabase Dashboard](https://supabase.com/dashboard). Open its **Connect** dialog to obtain the Project URL and API key. **Settings > API Keys** also lists available keys.

Edit the local `.env`:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=sb_secret_<your-backend-secret-key>
```

Replace the placeholders with values from the same project. Use a backend-only secret key (or a legacy `service_role` key), not a Publishable key. Keep `.env` private and out of Git.

The probe sends `SUPABASE_KEY` in the `apikey` header. No user access token is required for this initial anonymous-access probe.

## 3. Run the connection probe

```powershell
python -B check_supabase.py
```

Expected success:

```text
Connected to Supabase Data API. public.reports accepted the expected columns. The query used limit=0; no report rows were requested or changed.
Checked columns: id, ticket_id, description, status, created_at
This does not test Supabase Auth, row visibility, or write permissions.
The application still uses SQLite. Cloud integration is a separate next step.
```

The helper sends one `GET /rest/v1/reports` request with:

```text
select=id,ticket_id,description,status,created_at
limit=0
```

It uses the `public` schema, a 10-second timeout per network phase, and does not follow redirects. It does not print keys, report rows, upstream bodies, or raw exception details. There are no insert, update, delete, or migration requests.

Exit codes are `0` for a successful probe, `1` for a connection/query failure, and `2` for missing or unsupported configuration.

An empty successful result confirms this request is permitted; it does not demonstrate that a signed-in resident can read their own reports. Row Level Security policies, user authentication, and write permissions require separate integration tests.

## 4. Troubleshooting

| Result | Next action |
| --- | --- |
| Configuration required | Fill both variables, use the hosted Project URL, and copy the project's backend-only secret/service-role key into `SUPABASE_KEY`. |
| HTTP 401 | Check that the key and URL belong to the same Enclave project. |
| HTTP 403 or permission denied | Ask the project owner to check table grants for Data API access. |
| HTTP 404 | Check that `reports` is in `public` and available through the Data API. |
| Missing column | Compare the actual columns with `id, ticket_id, description, status, created_at`. |
| Redirect | Recopy the Project URL from Connect. |
| Timeout or network error | Check the network and project availability, then retry. |


The probe uses a backend-only key and requests zero rows. Keep this key private; do not put it in frontend configuration. Keep RLS enabled and review the team's Auth and resident/management policies separately.

## 5. Test the helper without cloud access

```powershell
python -B test_supabase_check.py
```

These tests use mocked HTTP responses and temporary configuration files. They do not connect to Supabase or require real credentials.

## 6. Next integration work

The reported Supabase columns are `id`, `ticket_id`, `description`, `status`, and `created_at`.
The local report contract also needs `user_id`, `latitude`, and `longitude`. Confirm their types, nullability, ownership relationship, and how existing reports should be handled before changing the cloud schema.

The current Supabase prototype writes status `pending`; the local workflow uses `pending_review`, `approved`, `rejected`, `in_progress`, and `resolved`. Align these values and add action history together with the Auth and permission design. A successful connection probe does not complete that migration.

References: [Supabase API routes](https://supabase.com/docs/guides/api/creating-routes), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), and [Data API security](https://supabase.com/docs/guides/api/securing-your-api).
