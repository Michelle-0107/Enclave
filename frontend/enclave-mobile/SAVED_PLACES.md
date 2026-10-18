# Personal map presets

Residents can save named coordinates (Home, Office, Gym, or a custom name), choose them for either endpoint, rename them, move an existing preset to the currently selected point, and delete them. The default list is empty. Saving never changes the route or auto-selects an endpoint. Choosing a preset invalidates the old route and uses its numeric coordinates.

## Database setup (required once)

Run `backend/sql/012_user_saved_places.sql` in the **same Supabase project's SQL Editor** used by the mobile app. The script is transactional and can be reapplied without removing saved data. It does not need the unrelated notification migration 011. Reload the list after applying it; no Python server restart is required.

Table `public.user_saved_places`:

| Column | Meaning |
| --- | --- |
| id | Database-generated UUID |
| user_id | Owner's Supabase Auth user ID; defaults to the caller, references auth.users with cascade delete |
| name | Trimmed name, 1–60 characters; case-insensitively unique per account |
| latitude / longitude | Numeric coordinates, stored separately to avoid axis confusion |
| created_at | Database timestamp |

The existing authenticated Supabase client accesses this table directly with the user's JWT and the existing public key. Row-level security limits SELECT, INSERT, UPDATE, and DELETE to the owner. Ownership, IDs and creation timestamps cannot be changed through client updates. Presets are private; they are not community facilities, reports, repaired assets, or evidence that a path is accessible. No service key is used in the app and no new FastAPI endpoint or environment variable is needed.

## Resident flow

1. Open Map. Choose a starting point or destination by map tap, place search (demo map), or current location (demo map).
2. Beside that endpoint, tap **Save this place**, enter a name, and save. Save is disabled until a real coordinate is selected.
3. At either endpoint, tap **Saved places**, then choose a saved row. The same list works for both starting point and destination, and across the live and demo maps.
4. To rename a preset, open Saved places and tap **Edit**. To move it, first select the new map point for that endpoint, then edit the preset and tap **Use currently selected map point**. Save the change. Re-select the preset to use its edited coordinates in a route.
5. Delete asks for confirmation. It removes the preset only; it does not delete a report or alter a route already selected.
6. Choose a route as usual. Existing pilot bounds, routing modes, access checks and explicit nearby-start approval still apply. A preset does not imply a connected or step-free route.

The live map passes selected coordinates into RouteOptionsScreen via App.tsx. Typing over a selected label clears that endpoint's coordinate so an unrelated old coordinate cannot be reused. Both map views keep manual selection available. Empty lists, offline/server errors, expired sessions, duplicate names, and a missing migration are shown explicitly. No local fallback reports an unsuccessful save as synced. Changing accounts closes the picker and clears its displayed data.

## Verification

From `frontend/enclave-mobile`:

```sh
npx tsc --noEmit
node tests/saved-places.test.cjs
```

`backend/tests/test_saved_places_postgres.py` exercises the actual migration, including cross-account isolation and spoofed ownership. It requires a **disposable local PostgreSQL cluster** with `ENCLAVE_TEST_PG_DSN` set to a loopback-only database named `enclave_saved_places_test`. It refuses hosted/existing app databases and creates its own fixture roles/auth schema. Do not run it against production.

Phone acceptance test after database setup:

- Save Home and Gym from two distinct map points; select them as opposite endpoints and calculate a route. Check S/D markers and route endpoints.
- Swap the same presets, then replace one endpoint; old route results must clear.
- Close/reopen the map, or sign in as the same account on another device; saved rows should reload from Supabase.
- Rename/move/delete a preset; refresh the other endpoint's picker to see the current list.
- Sign in as another account; none of the first account's places should appear. The second account can create its own Home.
- Disconnect the network and attempt a save; an error must appear and no success confirmation should be shown.

These code changes do not build, publish an EAS Update, push Git commits, or apply the hosted migration automatically. Use the configured development build/Metro workflow to test when ready.
