# Community issue map API

The first map milestone provides approved issue points for a frontend map. It
does not change routing, image analysis, report approval, database schema, or RLS.
The frontend map is not connected by this backend change.

## API contract

`GET /api/v1/map/issues` requires a valid Supabase access token and an active,
verified resident binding, matching report-feature access checks.

| Parameter | Default | Rule |
| --- | --- | --- |
| `bbox` | Whole geographic range | `west,south,east,north`; finite longitude/latitude degrees; west <= east and south <= north; antimeridian crossing is not supported |
| `include_resolved` | `false` | Include approved resolved issues as historical points |
| `limit` | `100` | Integer from 1 to 200 |
| `offset` | `0` | Non-negative integer |

The response is a GeoJSON `FeatureCollection` with an additional `pagination`
member. Each Point uses `[longitude, latitude]`. Map clients must request the
next page while `pagination.has_more` is true; one response is not necessarily
the full community issue set. Ordering is creation time descending, then numeric
report ID descending; offset pagination can shift as reports are approved or changed.

Only `is_approved = true` issues with status `approved` or `in_progress` appear
by default. Resolved issues appear only when explicitly requested and must not
be styled as active barriers. Pending and rejected reports are excluded.

Properties contain only ticket ID, category, priority, status, `reported_at`, and
`verified_at`. `verified_at` is currently null because the report table does not
have a reliable verification-time column. Creation time is not verification time.
Missing/invalid coordinates do not qualify for display. Approved location pins
are issue locations, not resident live-location tracking.

Reporter identity, email, original description, and image URLs are not returned.
The map is intentionally community-wide: approved points may belong to other
residents. Private report-detail endpoints remain owner-only, so a map ticket
does not grant access to another resident's private report or evidence.

The server-only map reader uses the existing Admin `SUPABASE_KEY` and a column
allowlist, applies approval/status/bbox filters, and validates eligibility again
before projecting fields. It never forwards that key to the frontend. No new
environment variables or broader client database policies are required.

| Result | Meaning |
| --- | --- |
| 200 with features | Matching approved issues |
| 200 with an empty list | No matching issues; a valid map result |
| 401 | Missing, invalid, or expired access token |
| 403 | Account has no active verified resident binding |
| 422 | Invalid bounds, limit, offset, or query value |
| 503 | Residency service failed, or map data could not be read/validated safely |

Responses use `Cache-Control: private, no-store`. Provider bodies and keys are
not included in errors. Suspicious upstream rows fail closed rather than exposing
pending/unapproved records or silently widening the requested map bounds.

## Local practice without provider access

From the repository root with the project virtual environment active:

```powershell
python -B -m backend.reports.map_demo
```

Open `http://127.0.0.1:8003/docs`. This separate app uses synthetic points and
mock transports; it does not load the private `.env`, create accounts, send email,
upload images, or connect to Supabase/AWS/AI. Its points are demonstration data,
not a field-checked township network.

1. Authorize with `demo-resident-token` (without the Bearer prefix).
2. Execute `GET /api/v1/map/issues`: expect two points, one approved and one in progress.
3. Set `include_resolved=true`: expect three points.
4. Use `bbox=101.686,3.138,101.688,3.140`: expect only `DEMO-MAP-001`.
5. Use `limit=1`: expect one point with `has_more=true`; use `offset=1` for the next page.
6. Use an invalid bbox, such as `2,0,1,1`: expect 422.
7. Log out in Authorize and repeat: expect 401.

The synthetic pending issue must never appear. Demo tokens are accepted only in
this isolated sandbox and are invalid on the real API. Other production routes
shown in this demo's Swagger are not backed by live providers.

## Real local backend

Use the normal `http://127.0.0.1:8001/docs` with a real resident access token.
No token from the demo works here. Execute the same endpoint. If there are no
approved matching reports, `features: []` is expected. Do not bypass approval
checks or alter real records merely to make the map non-empty.

This read path does not implement management review actions or timestamps. Human
approval, accurate issue locations, and future expiry/verification metadata must
be handled by the management workflow before relying on markers operationally.

## Regression tests

```powershell
python -B -m unittest -q backend.tests.test_map backend.tests.test_cloud backend.tests.test_entrypoint backend.tests.test_registration backend.tests.test_registration_setup backend.tests.test_storage
```

Tests use synthetic JWT signatures and mocked services. They cover authentication,
resident eligibility, the disclosure boundary, status/bbox filtering, pagination,
provider failures, malformed results, and the isolated demo.

References: [GeoJSON RFC 7946](https://www.rfc-editor.org/rfc/rfc7946),
[PostgREST filtering](https://docs.postgrest.org/en/stable/references/api/tables_views.html).
