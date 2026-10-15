"""Isolated synthetic map practice: no real email, credentials, AWS, or database."""

import re
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import httpx

from ..app import AuthenticatedUser, bearer, create_app, current_user
from ..core.config import Settings


DEMO_RESIDENT = UUID("00000000-0000-4000-8000-000000000001")


def create_map_demo_app():
    records = [
        {"id": 1, "ticket_id": "DEMO-MAP-001", "category": "Streetlight", "priority": "medium",
         "status": "approved", "is_approved": True, "latitude": 3.139, "longitude": 101.687,
         "created_at": "2026-10-15T01:00:00Z"},
        {"id": 2, "ticket_id": "DEMO-MAP-002", "category": "Blocked Path", "priority": "high",
         "status": "in_progress", "is_approved": True, "latitude": 3.142, "longitude": 101.690,
         "created_at": "2026-10-15T02:00:00Z"},
        {"id": 3, "ticket_id": "DEMO-MAP-003", "category": "Drainage", "priority": "low",
         "status": "resolved", "is_approved": True, "latitude": 3.144, "longitude": 101.700,
         "created_at": "2026-10-15T03:00:00Z"},
        {"id": 4, "ticket_id": "DEMO-PENDING", "category": "Waste", "priority": "low",
         "status": "pending", "is_approved": False, "latitude": 3.14, "longitude": 101.69},
    ]

    def maps(request):
        allowed = request.url.params["status"][4:-1].split(",")
        selected = [r for r in records if r["is_approved"] and r["status"] in allowed]
        for column, operator, value in re.findall(r"(longitude|latitude)\.(gte|lte)\.([^,)]+)",
                                                  request.url.params["and"]):
            number = float(value)
            selected = [r for r in selected if (r[column] >= number if operator == "gte" else r[column] <= number)]
        selected.sort(key=lambda r: (r.get("created_at", ""), r["id"]), reverse=True)
        offset, limit = int(request.url.params["offset"]), int(request.url.params["limit"])
        return httpx.Response(200, json=selected[offset:offset + limit])

    def residency(request):
        return httpx.Response(200, json=[{"profile_id": str(DEMO_RESIDENT), "status": "active",
                                         "verified_at": "2026-10-15T00:00:00Z"}])

    def unavailable(request):
        return httpx.Response(503, json={})

    settings = Settings("https://exampleproject.supabase.co", "sb_secret_map_demo_fixture_only")
    app = create_app(settings, auth_transport=httpx.MockTransport(unavailable),
                     reports_transport=httpx.MockTransport(unavailable),
                     residents_transport=httpx.MockTransport(residency),
                     map_transport=httpx.MockTransport(maps), workflow_transport=httpx.MockTransport(unavailable))

    def demo_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None or credentials.credentials != "demo-resident-token":
            raise HTTPException(401, "Use the local demo token", headers={"WWW-Authenticate": "Bearer"})
        return AuthenticatedUser(DEMO_RESIDENT, "resident@example.com", "demo-resident-token")

    app.dependency_overrides[current_user] = demo_user
    app.title = "Enclave LOCAL community map sandbox"
    app.description = ("Synthetic map points only. Authorize with demo-resident-token. "
                       "No real Supabase/AWS/AI/email calls. Demo points are not field-verified township data.")
    return app


if __name__ == "__main__":
    import uvicorn
    print("LOCAL MAP SANDBOX: http://127.0.0.1:8003/docs")
    print("Authorize with demo-resident-token. All points are synthetic.")
    uvicorn.run(create_map_demo_app(), host="127.0.0.1", port=8003)
