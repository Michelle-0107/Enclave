"""Sign in interactively and test the integrated API; tokens are hidden by default."""

import argparse
from dataclasses import dataclass, field
from getpass import getpass
import sys
from uuid import UUID

import httpx

from ..config import ConfigurationError, Settings, load_settings


@dataclass(frozen=True)
class SessionResult:
    success: bool
    message: str
    access_token: str | None = field(default=None, repr=False)


def check_session(settings: Settings, email: str, password: str, *, port: int = 8000,
                  transport: httpx.BaseTransport | None = None) -> SessionResult:
    if port not in (8000, 8001, 8002):
        return SessionResult(False, "Use local port 8000, 8001, or 8002.")
    try:
        with httpx.Client(timeout=10.0, follow_redirects=False, transport=transport) as client:
            login = client.post(settings.project_url + "/auth/v1/token", params={"grant_type": "password"},
                                headers={"apikey": settings.api_key}, json={"email": email, "password": password})
            if login.status_code != 200:
                code = None
                try:
                    error = login.json()
                    if isinstance(error, dict):
                        code = error.get("code") or error.get("error_code")
                except ValueError:
                    pass
                if code == "email_not_confirmed":
                    message = "Confirm the App user's email before signing in."
                elif code == "invalid_credentials":
                    message = "Use the Enclave Authentication > Users account, not Dashboard or SQLite credentials."
                else:
                    message = "Check the App account, project configuration, and Auth availability."
                return SessionResult(False, f"Login failed (HTTP {login.status_code}). " + message)
            payload = login.json()
            token = payload.get("access_token")
            if not isinstance(token, str) or not token:
                return SessionResult(False, "Login did not return an access token.")
            response = client.get(f"http://127.0.0.1:{port}/auth/me", headers={"Authorization": "Bearer " + token})
            if response.status_code != 200:
                return SessionResult(False, f"Current-user verification failed (HTTP {response.status_code}). Check the API and project JWT settings.")
            user_id = str(UUID(response.json()["user_id"]))
            if payload.get("user", {}).get("id") != user_id:
                return SessionResult(False, "Verified user does not match the login account.")
            return SessionResult(True, "JWT verification succeeded. Verified user_id: " + user_id, token)
    except (httpx.RequestError, ValueError, TypeError, KeyError, AttributeError):
        return SessionResult(False, "Could not complete the test. Check connectivity and start the integrated API.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, choices=(8000, 8001, 8002), default=8000)
    parser.add_argument("--show-token", action="store_true", help="Explicitly display the verified access token for local Swagger testing.")
    options = parser.parse_args()
    try:
        settings = load_settings()
    except ConfigurationError:
        print("Set SUPABASE_URL and SUPABASE_KEY in the root .env first.")
        return 2
    print("Use an existing confirmed Enclave App user from Authentication > Users.")
    try:
        email = input("Email: ").strip()
        password = getpass("Password (hidden): ")
    except (EOFError, KeyboardInterrupt):
        print("\nTest cancelled.")
        return 1
    if not email or not password:
        print("Email and password are required.")
        return 2
    result = check_session(settings, email, password, port=options.port)
    print(result.message)
    if options.show_token and result.success:
        print("Local Swagger access token (keep private):")
        print(result.access_token)
    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
