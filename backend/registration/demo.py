"""Loopback-only registration sandbox. No real email, Auth account, or Supabase JWT."""

from datetime import datetime, timezone
import hashlib
import threading
from uuid import UUID, uuid4

from ..core.auth import VerifiedUser, InvalidCredentials
from ..core.config import Settings
from .service import RegistrationService
from .settings import RegistrationSettings
from .contracts import AuthSession


MANAGER = UUID("00000000-0000-4000-8000-000000000101")
RESIDENT = UUID("00000000-0000-4000-8000-000000000102")
DEMO_INVITATION = "local-demo-invitation-token-000000000000000001"
DEMO_PASSWORD = "local-demo-password"


class MemoryStore:
    """Protocol fake for local API practice; not a replacement for PostgreSQL transitions."""
    def __init__(self):
        self.lock = threading.RLock()
        self.clock = 0
        self.resident_id = str(uuid4())
        self.invitation_id = str(uuid4())
        self.invitation_digest = hashlib.sha256(DEMO_INVITATION.encode()).hexdigest()
        self.email = "resident@example.com"
        self.challenges = {}
        self.rates = {}
        self.profile_id = None
        self.fail_finish_once = False
        self.active = True

    def close(self):
        pass

    def call(self, action, **a):
        with self.lock:
            if action == "rate":
                scope = a["scope"]
                window, limit = (60, 20) if scope.endswith("ip") else (900, 3 if scope == "request-email" else 10)
                key = (scope, a["digest"], self.clock // window)
                self.rates[key] = self.rates.get(key, 0) + 1
                return {"allowed": self.rates[key] <= limit}
            if action == "lookup_invitation":
                if a["token_digest"] != self.invitation_digest or a["email"] != self.email or self.profile_id or not self.active:
                    return None
                return {"resident_id": self.resident_id, "invitation_id": self.invitation_id, "email": self.email}
            if action == "create_challenge":
                pending = [c for c in self.challenges.values() if not c["revoked"] and not c["completed"]]
                if self.profile_id or any(c["verified"] or self.clock - c["created"] < 60 for c in pending):
                    return {"created": False}
                for c in pending:
                    c["revoked"] = True
                self.challenges[a["id"]] = {**a, "created": self.clock, "attempts": 0, "accepted": False,
                                             "revoked": False, "verified": False, "completed": False,
                                             "auth_user_id": None, "lease": None, "lease_end": 0}
                return {"created": True}
            if action == "challenge":
                c = self.challenges.get(a["id"])
                return None if c is None else {key: c[key] for key in
                                              ("id", "resident_id", "invitation_id", "email", "otp_digest", "pepper_version")}
            if action == "delivery":
                c = self.challenges[a["id"]]
                if not c["revoked"]:
                    c["accepted"] = a["status"] == "accepted"
                    c["revoked"] = not c["accepted"]
                return {"state": "recorded"}
            if action == "acquire":
                c = self.challenges[a["id"]]
                if c["revoked"] or not self.active:
                    return {"state": "invalid"}
                if not c["verified"]:
                    if not c["accepted"] or self.clock - c["created"] >= 300 or c["attempts"] >= 5:
                        return {"state": "invalid"}
                    if not a["matches"]:
                        c["attempts"] += 1
                        return {"state": "invalid"}
                    c.update(verified=True, request_digest=a["request_digest"], deadline=self.clock + 600)
                elif c["request_digest"] != a["request_digest"] or self.clock >= c["deadline"]:
                    return {"state": "invalid"}
                if c["lease"] and c["lease_end"] > self.clock:
                    return {"state": "busy"}
                c.update(lease=a["lease"], lease_end=self.clock + 120)
                return {"state": "acquired", "email": c["email"], "auth_user_id": c["auth_user_id"],
                        "resident_id": self.resident_id, "completed": c["completed"]}
            if action == "remember_auth":
                c = self.challenges[a["id"]]
                if c["lease"] != a["lease"] or c["lease_end"] <= self.clock:
                    return {"recorded": False}
                c["auth_user_id"] = a["user_id"]
                return {"recorded": True}
            if action == "finish":
                c = self.challenges[a["id"]]
                if self.fail_finish_once:
                    self.fail_finish_once = False
                    return {"state": "conflict"}
                if c["lease"] != a["lease"] or c["lease_end"] <= self.clock:
                    return {"state": "invalid"}
                self.profile_id = a["user_id"]
                c["completed"] = True
                return {"state": "completed", "resident_id": self.resident_id}
            if action == "release":
                c = self.challenges[a["id"]]
                if c["lease"] == a["lease"]:
                    c["lease"] = None
                return {"state": "released"}
            if action == "residency":
                if self.profile_id != a["user_id"]:
                    return None
                return {"resident_id": self.resident_id, "unit_number": "DEMO-101",
                        "status": "active" if self.active else "inactive",
                        "verified_at": datetime.now(timezone.utc).isoformat()}
            if action in ("create_resident", "issue_invitation"):
                if a["actor_id"] != str(MANAGER):
                    return {"state": "forbidden"}
                if action == "create_resident":
                    if self.profile_id:
                        return {"state": "conflict"}
                    self.email = a["registered_email"]
                    return {"state": "created", "resident_id": self.resident_id}
                self.invitation_digest = a["token_digest"]
                return {"state": "created", "invitation_id": self.invitation_id,
                        "expires_at": datetime.now(timezone.utc).isoformat()}
            raise AssertionError("Unexpected fake action")


class FakeDelivery:
    def __init__(self):
        self.sent = []
        self.fail = False

    def close(self):
        pass

    def send_invite_email(self, email, code, challenge_id):
        from ..services.email_service import EmailUnavailable
        if self.fail:
            raise EmailUnavailable()
        self.sent.append((email, code, challenge_id))
        return "local-test-message"


class FakeAccounts:
    def __init__(self):
        self.password = None
        self.created = 0
        self.logged_in = 0

    def close(self):
        pass

    def create(self, email, password, challenge_id):
        if self.password is None:
            self.password = password
            self.created += 1
            return RESIDENT
        return None

    def login(self, email, password):
        self.logged_in += 1
        if self.password is None or password != self.password:
            return None
        return RESIDENT, AuthSession(access_token="demo-resident-token", refresh_token="demo-refresh-token", expires_in=3600)


class DemoVerifier:
    def close(self):
        pass

    def verify(self, token):
        if token == "demo-manager-token":
            return VerifiedUser(MANAGER, "manager@example.com")
        if token == "demo-resident-token":
            return VerifiedUser(RESIDENT, "resident@example.com")
        raise InvalidCredentials()


def demo_components():
    cloud = Settings("https://exampleproject.supabase.co", "sb_secret_local_fixture_for_demo")
    config = RegistrationSettings(cloud, "sb_secret_local_fixture", "re_local_fixture", "Enclave <test@example.com>", b"x" * 32)
    store, delivery, accounts = MemoryStore(), FakeDelivery(), FakeAccounts()
    registration = RegistrationService(config, store, delivery, accounts, otp_factory=lambda: "003482")
    return cloud, registration, store, delivery, accounts


def create_demo_app():
    from contextlib import asynccontextmanager
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    from fastapi.exceptions import RequestValidationError
    from ..routers.email import router
    from .service import RegistrationRejected
    from .clients import RegistrationUnavailable
    _, registration, _, _, _ = demo_components()

    @asynccontextmanager
    async def lifespan(app):
        app.state.registration = registration
        app.state.verifier = DemoVerifier()
        yield
        registration.close()

    app = FastAPI(title="Enclave LOCAL registration sandbox", lifespan=lifespan,
                  description="Memory-only sandbox: no real email, account, database, or Supabase JWT. Test OTP: 003482.")
    app.include_router(router)

    @app.exception_handler(RegistrationRejected)
    async def rejected(request, error):
        return JSONResponse(status_code=error.status, content={"detail": error.message}, headers={"Cache-Control": "no-store"})

    @app.exception_handler(RegistrationUnavailable)
    async def unavailable(request, error):
        return JSONResponse(status_code=503, content={"detail": "Registration service unavailable"})

    @app.exception_handler(RequestValidationError)
    async def validation(request, error):
        return JSONResponse(status_code=422, content={"detail": "Invalid request fields"}, headers={"Cache-Control": "no-store"})

    return app


if __name__ == "__main__":
    import uvicorn
    print("LOCAL SANDBOX ONLY: http://127.0.0.1:8002/docs")
    print("Email: resident@example.com; invitation: " + DEMO_INVITATION)
    print("Test OTP: 003482; use a synthetic password; demo tokens are not Supabase JWTs.")
    uvicorn.run(create_demo_app(), host="127.0.0.1", port=8002)
