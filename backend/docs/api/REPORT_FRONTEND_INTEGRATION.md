# Report API: frontend integration

Checked on 2026-10-16 against the current backend code, local port 8001, and Render OpenAPI. This document describes the existing resident report contract. It does not introduce a second report endpoint.

## Availability

| Environment | Base URL | Resident report APIs | New facility/incident linking APIs |
|---|---|---|---|
| Local backend | `http://127.0.0.1:8001` | Available | Available; SQL 009 required |
| Render | `https://enclave-6085.onrender.com` | Available; schemas match local | Not deployed at the time of this check |

Swagger: append `/docs`. Machine-readable schema: append `/openapi.json`. The version-controlled snapshot is [openapi.json](openapi.json).

On a physical phone, `127.0.0.1` refers to the phone. Use the Render base URL for the deployed report APIs, or your computer's reachable LAN address and port for local testing. An APK may have platform/network restrictions for plain HTTP; use the team's supported development setup. Do not add backend secrets to the mobile app.

## Authentication

Use the current Supabase Auth session's **access_token**, issued by the same project configured in the backend:

```http
Authorization: Bearer <access_token>
```

A confirmed Auth user alone is insufficient: resident submission/list/detail require an active resident record linked to the user, with non-null `verified_at`. A management account without residency cannot submit a resident report. `GET /auth/me` verifies the token; `GET /api/v1/me/residency` checks the binding.

Never send `user_id`, a role, a Supabase Admin key, AWS credentials, or AI keys. The backend derives report ownership from the JWT. On 401, use the existing Supabase session refresh/login flow before retrying.

## API summary

| Method | Path | Success | Purpose |
|---|---|---|---|
| POST | `/api/v1/reports` | 201 | Upload photo, run analysis/fallback, save a pending report |
| GET | `/api/v1/reports?limit=10&offset=0` | 200 | Current resident's reports |
| GET | `/api/v1/reports/{ticket_id}` | 200 | Current resident's report details |
| GET | `/api/v1/reports/{ticket_id}/history?limit=20&offset=0` | 200 | Current resident's review/repair history; management may read any report |

Treat `ticket_id` as an opaque string. Use it in report URLs; do not substitute a database integer ID or a resident UUID.

## Submit: multipart/form-data

All four fields are required:

| Field | Format | Validation |
|---|---|---|
| `description` | Text | 1-1000 characters; whitespace-only rejected |
| `latitude` | Numeric text | -90 through 90 |
| `longitude` | Numeric text | -180 through 180 |
| `file` | JPEG/PNG file | Nonempty, declared MIME `image/jpeg` or `image/png`, at most 10 MiB |

Select or convert the photo to JPEG/PNG before upload; HEIC is not supported by this contract. Do not send JSON or base64 for this endpoint. Do not set `Content-Type` manually: fetch must supply the multipart boundary.

React Native example (place in the team's existing API layer; `supabase` is the existing configured frontend client):

```typescript
type ReportPhoto = {
  uri: string;
  name: string;
  type: 'image/jpeg' | 'image/png';
};

async function submitReport(
  apiBaseUrl: string,
  description: string,
  latitude: number,
  longitude: number,
  photo: ReportPhoto,
) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Please sign in again.');

  const form = new FormData();
  form.append('description', description.trim());
  form.append('latitude', String(latitude));
  form.append('longitude', String(longitude));
  // React Native accepts the local file descriptor at runtime.
  // Its TypeScript FormData definition may still expect a browser Blob.
  form.append('file', photo as unknown as Blob);

  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/reports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    body: form,
  });
  const body = await response.json();
  if (!response.ok) {
    // Render string details directly; map validation arrays to friendly field messages.
    throw new Error(typeof body.detail === 'string' ? body.detail : `Report failed (${response.status}).`);
  }
  return body; // body.ticket_id, body.ai_analysis, body.image_url, body.data[0]
}
```

For a browser frontend, append the actual browser `File` instead of a React Native URI descriptor. Browser CORS needs separate correction: the current `create_app` replaces the FastAPI instance after adding CORS middleware, so that middleware is absent from the final app. This handoff does not modify that code. Native mobile fetch is not governed by browser CORS.

Example 201 body (all values synthetic):

```json
{
  "success": true,
  "message": "Report successfully created, analyzed by AI, and stored.",
  "ticket_id": "TICK-11111111111111111111111111111111",
  "ai_analysis": {
    "category": "Blocked Path",
    "priority": "medium",
    "summary": "A fallen branch blocks the walkway."
  },
  "image_url": "https://example.invalid/report-photo.jpg",
  "data": [{
    "ticket_id": "TICK-11111111111111111111111111111111",
    "user_id": "00000000-0000-4000-8000-000000000001",
    "description": "A fallen branch blocks the walkway.",
    "status": "pending",
    "created_at": "2026-10-16T08:00:00Z",
    "latitude": 3.22649,
    "longitude": 101.730755,
    "image_url": "https://example.invalid/report-photo.jpg",
    "category": "Blocked Path",
    "priority": "medium",
    "is_approved": false
  }]
}
```

Read the created report from `data[0]`, not `report`. Valid AI categories are `Streetlight`, `Damaged Facility`, `Blocked Path`, `Drainage`, `Waste`; priority is `high`, `medium`, or `low`.

Disable duplicate taps while submitting. Submission has **no idempotency-key support**; automatic retries after an ambiguous network failure can create duplicate reports. Refresh My Reports first and let the user decide whether a retry is needed. The signup endpoint's Idempotency-Key contract does not apply here.

## List, details, and history

All GET requests need the same Authorization header. My Reports defaults to `limit=10`, maximum 100; `offset` starts at zero. Response:

```json
{"items": [], "limit": 10, "offset": 0}
```

Reports are ordered by newest creation time and then ticket ID. This endpoint has no `total` or `has_more`. A page smaller than `limit` ends pagination; a full page may need one further request. The details endpoint returns a single report object with the fields shown inside `data[0]` above. `created_at`, `image_url`, `category`, and `priority` can be null for legacy data; provide UI fallbacks.

History defaults to `limit=20`, maximum 100, with `offset>=0`:

```json
{
  "ticket_id": "TICK-11111111111111111111111111111111",
  "items": [{
    "id": 1,
    "from_status": "pending",
    "to_status": "approved",
    "note": "Reviewed for maintenance.",
    "repair_verified": false,
    "created_at": "2026-10-16T08:10:00Z",
    "actor_role": "management"
  }],
  "limit": 20,
  "offset": 0,
  "has_more": false
}
```

Staff UUIDs are omitted from resident history. Older reports may have no history. Maintenance statuses are `pending`, `approved`, `rejected`, `in_progress`, `resolved`. These are separate from community issue `open`/`resolved` status and reporter counts. Do not let residents PATCH maintenance status.

## Link the report to a facility incident (local now; deploy before cloud use)

Photo submission alone does not publish a community marker. For the two-resident rule, the frontend also needs explicit facility/incident selection:

1. Load `GET /api/v1/facilities` and `GET /api/v1/community/issues`. The incident list includes one-reporter incidents so another resident can select the exact same problem. Both support `bbox=west,south,east,north`, `limit` (default 100, maximum 200), and `offset`. Both return `items` and `pagination` containing `limit`, `offset`, and `has_more`.
2. Reuse the selected facility. If there is genuinely no matching point, `POST /api/v1/facilities` accepts `name`, `facility_type`, `latitude`, `longitude` and returns a facility object with `id`. Current pilot bounds are latitude 3.2171-3.2349 and longitude 101.7211-101.7409. Types: `path_surface`, `ramp`, `stairs`, `kerb`, `crossing`, `elevator`, `streetlight`, `drainage`, `bench`, `other`.
3. Submit the photo report and retain its returned `ticket_id`. Report coordinates must be within 100 m of the selected facility for linking.
4. If selecting an existing issue, POST `/api/v1/community/issues/{issue_id}/reports`:

```json
{"report_ticket_id": "TICK-11111111111111111111111111111111"}
```

Otherwise POST `/api/v1/community/issues` to open/reuse the selected facility's incident:

```json
{
  "facility_id": "10000000-0000-4000-8000-000000000001",
  "fault_kind": "damage",
  "report_ticket_id": "TICK-11111111111111111111111111111111"
}
```

`fault_kind` is `damage` or `obstruction`. Both linking endpoints return `issue` (including `id`, `reporter_count`, `status`, `affects_routes`), `deduplicated`, and `community_visible`. One resident counts once; two distinct verified residents make an open incident map-visible. Management approval is not required. The same report ticket cannot be used for multiple incidents.

If photo creation succeeded but linking failed, retain the ticket and show a separate linking error. Retry the linking step after fixing the cause; do not upload another photo report automatically. A repeat link by the same resident does not add a second vote.

Finally refresh `GET /api/v1/map/issues`. Render currently exposes an older map contract; wait for the new community deployment before relying on the two-resident map fields there. The current local map returns one GeoJSON point per threshold-qualified incident, with coordinate order `[longitude, latitude]`. It does not disclose report photos or reporter identity. Route avoidance applies only to supported road-related facility types; benches and `other` are not automatically avoided. See [COMMUNITY_ROUTES_TESTING.md](COMMUNITY_ROUTES_TESTING.md).

## Error handling

| HTTP | Meaning / frontend action |
|---|---|
| 401 | Token missing/invalid/expired; refresh the session or ask the user to sign in |
| 403 | Active verified residency missing, or database policy denied access; inspect residency/setup |
| 404 | Unknown/inaccessible report or incident; don't display another resident's private data |
| 409 | Incident/evidence conflict, or stale maintenance status; refresh state before retrying |
| 413 | Photo exceeds 10 MiB; resize/compress it |
| 415 | Unsupported declared photo MIME; use JPEG/PNG |
| 422 | Invalid fields, empty photo/text, or invalid incident link; display actionable validation |
| 503 | Auth, database, storage, or workflow dependency unavailable; preserve entered data |

Do not log Authorization headers, session tokens, photo content, or backend keys. Show a friendly message for non-JSON proxy/network failures as well as API JSON errors.

## Completion and limits

Implemented: JWT and active-resident checks; S3 photo upload; Bedrock -> Gemini -> manual-review fallback; database persistence; owner-only list/detail; management maintenance transitions and resident-visible history. Current cloud exposes the four resident report APIs with the same response models as local.

The saved report description is the AI summary or manual fallback, not a separately retained original description. The resident cannot currently edit/confirm the AI classification through a dedicated API. A successful report does not prove which AI provider was used; the response does not expose that distinction. Photo MIME/size checks do not guarantee content authenticity. The S3 direct URL's readability depends on the bucket policy, and a failed database write can leave an uploaded object. Push notifications, resident report editing/deletion, and teammate image-analyzer integration are not included in this handoff.

Verification for this handoff uses offline report/storage/workflow/community tests and read-only local/Render schema/auth checks. It does not create a fresh live report, inspect a resident's credentials, mutate hosted SQL, or change deployment configuration.
