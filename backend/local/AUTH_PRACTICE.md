# Enclave Local Authentication and Authorization Practice

Use Swagger to test signup, login, bearer tokens, and report ownership with the local FastAPI and SQLite backend. No frontend or cloud account is required. Supabase Auth integration is planned separately.

All terminal commands below run from the backend directory with its virtual environment activated. See [README.md](README.md) for installation.

## Start the server

```bash
python -m fastapi dev main.py
```

If another server is already using port 8000, stop it with Ctrl+C before starting a replacement. Open http://127.0.0.1:8000/docs.

## Test a resident account

1. Clear Swagger authorization and call `GET /reports`. Expect `401`.
2. Call `POST /auth/signup` with:

```json
{
  "username": "alice",
  "password": "EnclaveTest123!"
}
```

Expect `201` with role `resident`. If the username exists, log in with the existing account or choose a new username. New usernames normalize to lowercase and must contain 3-32 ASCII letters, digits, or underscores. Signup passwords require 12-128 characters; whitespace is preserved.

3. Call `POST /auth/login` with the same JSON. Expect `200` and copy the real `access_token`.
4. Click **Authorize** and paste only the token, without quotes or the `Bearer ` prefix. Confirm and close the dialog.
5. Call `GET /auth/me`. Expect `200` with your user ID, username, and role.
6. Call `POST /reports` with:

```json
{
  "description": "The street light at the community park entrance is not working",
  "latitude": 3.139,
  "longitude": 101.687
}
```

Expect `201`. Save the returned `ticket_id`. The backend assigns the owner from your token; do not add `user_id` or `status` to the request.

7. Call `GET /reports` and `GET /reports/{ticket_id}`. Expect `200`; a resident can see only their own reports. Use `limit` and `offset` for pagination. `total` counts visible reports matching any status filter.
8. Call `POST /auth/logout`. Expect `204` with no body. Reuse the token for `GET /auth/me`; expect `401`.

The **Logout** button in Swagger's authorization dialog clears the browser's saved token. The `POST /auth/logout` endpoint revokes the actual server session.

## Test isolation between residents

Register a second resident, such as `bob`, then log in. Replace Alice's token in **Authorize** with Bob's token.

- `GET /reports`: Bob cannot see Alice's reports.
- `GET /reports/{alice_ticket_id}`: expect `404`.
- `GET /reports/{alice_ticket_id}/history`: expect `404`.
- `GET /management/reports`: expect `403`.

## Test a management account

Create an account using the local command:

```bash
python create_manager.py
```

Enter a new username, such as `manager`, and a password of at least 12 characters, then confirm the password. Password input is hidden. Existing usernames are rejected and are not promoted to management.

Log in through `POST /auth/login` and put the management token into **Authorize**.

- `GET /auth/me`: role is `management`.
- `GET /management/reports`: expect `200`, with all visible reports and pagination.
- `GET /reports`: management can also read all reports here.
- `GET /reports/{ticket_id}` and its `/history`: management can read resident and legacy reports.

Public signup always creates a resident. Adding `role` to its request body returns `422`.
For review and maintenance actions, follow [LOCAL_WORKFLOW_PRACTICE.md](LOCAL_WORKFLOW_PRACTICE.md).

## Automated tests

```bash
python -B test_backend.py
```

Tests use temporary databases and accounts. They do not insert test data into `enclave.db`. Coverage includes password hashing, signup/login/logout, token expiry, report ownership, pagination, management permissions, migration, maintenance workflows, history, and restart persistence.

## How the code works

- **Authentication:** `get_current_user` checks the bearer token and identifies the current user.
- **Authorization:** `require_management` checks the role; report queries also check ownership.
- **Passwords:** `pwdlib` uses Argon2 hashes. Responses do not contain passwords or hashes.
- **Tokens:** login generates a random opaque token. SQLite stores its SHA-256 digest, not the raw token.
- **Sessions:** tokens last one hour; logout deletes the current session.
- **Ownership:** the submitting user's ID is assigned automatically. Residents cannot choose another owner or initial status.
- **Migration:** additive schema changes preserve legacy reports. Reports with a null owner are visible only to management.

A useful reading order in `main.py` is models, signup/login, `get_current_user`, report endpoints, and management workflows.

References: [FastAPI Security](https://fastapi.tiangolo.com/reference/security/), [Password Hashing](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/), and [pwdlib](https://frankie567.github.io/pwdlib/reference/pwdlib/).
