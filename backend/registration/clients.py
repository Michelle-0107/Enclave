"""Isolated Supabase Auth and transactional RPC clients, with generic failures."""

from uuid import UUID
import httpx
from pydantic import ValidationError
from .settings import RegistrationSettings
from .contracts import AuthSession


class RegistrationUnavailable(RuntimeError):
    pass


class AccountRejected(ValueError):
    pass


class RegistrationStore:
    def __init__(self, settings: RegistrationSettings, *, transport=None):
        self.settings = settings
        self.url = settings.cloud.project_url + "/rest/v1/rpc/enclave_registration_transition"
        self.management_url = settings.cloud.project_url + "/rest/v1/rpc/enclave_management_resident_directory"
        self.client = httpx.Client(timeout=10, follow_redirects=False, transport=transport, trust_env=False)

    def close(self):
        self.client.close()

    def call(self, action: str, **args):
        try:
            response = self.client.post(self.url, json={"p_action": action, "p_args": args},
                                        headers={**self.settings.admin_headers(), "Content-Profile": "public"})
            if response.status_code != 200:
                raise RegistrationUnavailable()
            payload = response.json()
            if payload is not None and not isinstance(payload, dict):
                raise RegistrationUnavailable()
            if payload is None and action not in ("lookup_invitation", "challenge", "residency"):
                raise RegistrationUnavailable()
            return payload
        except (httpx.HTTPError, ValueError):
            raise RegistrationUnavailable() from None

    def management_call(self, action: str, **args):
        try:
            response = self.client.post(
                self.management_url,
                json={"p_action": action, "p_args": args},
                headers={**self.settings.admin_headers(), "Content-Profile": "public"},
            )
            if response.status_code != 200:
                raise RegistrationUnavailable()
            payload = response.json()
            if not isinstance(payload, dict):
                raise RegistrationUnavailable()
            return payload
        except (httpx.HTTPError, ValueError):
            raise RegistrationUnavailable() from None


class SupabaseSignup:
    def __init__(self, settings: RegistrationSettings, *, transport=None):
        self.settings = settings
        self.base = settings.cloud.project_url + "/auth/v1"
        self.client = httpx.Client(timeout=10, follow_redirects=False, transport=transport, trust_env=False)

    def close(self):
        self.client.close()

    def login(self, email: str, password: str):
        try:
            response = self.client.post(self.base + "/token", params={"grant_type": "password"},
                                        json={"email": email, "password": password},
                                        headers={"apikey": self.settings.cloud.api_key})
            if response.status_code == 400:
                # Only ordinary credential rejection permits trying account creation.
                data = response.json()
                if isinstance(data, dict) and data.get("error_code") in ("invalid_credentials", "email_not_confirmed"):
                    return None
                raise AccountRejected()
            if response.status_code in (401, 403, 422):
                raise AccountRejected()
            if response.status_code != 200:
                raise RegistrationUnavailable()
            data = response.json()
            user = data["user"]
            identifier = UUID(user["id"])
            if not user.get("email_confirmed_at") or str(user.get("email", "")).strip().lower() != email:
                raise AccountRejected()
            session = AuthSession.model_validate(data)
            return identifier, session
        except AccountRejected:
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError, ValidationError):
            # Includes malformed upstream sessions; do not reveal response bodies/passwords.
            raise RegistrationUnavailable() from None

    def create(self, email: str, password: str, challenge_id: str):
        try:
            response = self.client.post(self.base + "/admin/users", headers=self.settings.admin_headers(), json={
                "email": email, "password": password, "email_confirm": True,
                "app_metadata": {"enclave_registration_challenge": challenge_id},
            })
            if response.status_code in (400, 409, 422):
                # May be an existing account or a competing create request. Authenticate; never reset it.
                return None
            if response.status_code not in (200, 201):
                raise RegistrationUnavailable()
            data = response.json()
            user = data.get("user", data)
            if str(user.get("email", "")).strip().lower() != email:
                raise RegistrationUnavailable()
            return UUID(user["id"])
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            raise RegistrationUnavailable() from None
