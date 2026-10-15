"""Check registration configuration, with an optional read-only database/RPC probe."""

import argparse
from dataclasses import dataclass
from pathlib import Path
import sys

import httpx

from ..config import ConfigurationError, ENV_FILE, _load_values, load_settings
from ..registration.settings import load_registration_settings


@dataclass(frozen=True)
class Readiness:
    ready: bool
    messages: tuple[str, ...]


def check_configuration(*, env_file: Path = ENV_FILE, environ=None):
    values = _load_values(env_file, environ)
    messages = []
    missing = []
    for name in ("SUPABASE_URL", "SUPABASE_KEY", "RESEND_API_KEY"):
        if not (values.get(name) or "").strip():
            missing.append(name)
    if missing:
        messages.append("Missing: " + ", ".join(missing))
        return Readiness(False, tuple(messages)), None
    try:
        cloud = load_settings(env_file=env_file, environ=environ)
        settings = load_registration_settings(cloud, env_file=env_file, environ=environ)
    except ConfigurationError:
        messages.append("Configuration format is invalid. Check project URL, backend key type, optional legacy JWT secret, and Resend key privately.")
        return Readiness(False, tuple(messages)), None
    messages.append("Registration configuration: valid. No provider/network checks performed.")
    return Readiness(True, tuple(messages)), settings


def check_database(settings, *, transport=None):
    """The unknown action returns normally without touching rows in the SQL 005 RPC."""
    try:
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False, transport=transport) as client:
            response = client.post(settings.cloud.project_url + "/rest/v1/rpc/enclave_registration_transition",
                                   headers={**settings.admin_headers(), "Content-Profile": "public"},
                                   json={"p_action": "__readiness_no_mutation__", "p_args": {}})
            if response.status_code == 200 and response.json() == {"state": "invalid"}:
                return Readiness(True, ("SQL 005 RPC is reachable with backend credentials; no rows changed.",))
            if response.status_code == 404:
                message = "RPC unavailable. Confirm SQL 005 and the project's Data API schema cache."
            elif response.status_code in (401, 403):
                message = "RPC authentication/access rejected. Confirm the Admin key belongs to this project."
            else:
                message = "RPC check failed. Review database configuration privately; no raw response displayed."
    except (httpx.HTTPError, ValueError):
        message = "RPC check could not complete. Check connectivity; no raw error displayed."
    return Readiness(False, (message,))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-database", action="store_true", help="Explicitly call the no-mutation SQL 005 RPC probe.")
    options = parser.parse_args()
    result, settings = check_configuration()
    for message in result.messages:
        print(message)
    if not result.ready:
        return 2
    if options.check_database:
        result = check_database(settings)
        for message in result.messages:
            print(message)
        if not result.ready:
            return 1
    print("Next: approved management account, resident record/invitation, then authorized live email/signup testing.")
    print("Resend sender verification, provider delivery, Auth signup, and deployed code are not proven by this check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
