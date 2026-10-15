"""Probe public.reports through Supabase's Data API without reading report rows."""

from dataclasses import dataclass, field
import os
from pathlib import Path
import re
import sys
from typing import Mapping
from urllib.parse import urlsplit

from dotenv import dotenv_values
import httpx
import jwt


ENV_FILE = Path(__file__).resolve().with_name(".env")
REPORT_COLUMNS = ("id", "ticket_id", "description", "status", "created_at")


class ConfigurationError(ValueError):
    """An incomplete or unsupported local configuration."""


@dataclass(frozen=True)
class Settings:
    project_url: str
    api_key: str = field(repr=False)

    def __post_init__(self):
        project_url = self.project_url.strip().rstrip("/")
        key = self.api_key.strip()
        if not project_url or not key:
            raise ConfigurationError(
                "Set SUPABASE_URL and SUPABASE_KEY in .env beside check_supabase.py."
            )
        try:
            parsed = urlsplit(project_url)
            valid_url = (
                parsed.scheme == "https"
                and re.fullmatch(r"[a-z0-9]+\.supabase\.co", parsed.hostname or "")
                and parsed.port in (None, 443)
                and parsed.username is None
                and parsed.password is None
                and not parsed.path
                and not parsed.query
                and not parsed.fragment
            )
        except ValueError:
            valid_url = False
        if not valid_url:
            raise ConfigurationError(
                "Use the hosted Project URL from Connect: https://<project-ref>.supabase.co."
            )
        admin_key = key.startswith("sb_secret_")
        if not admin_key:
            try:
                claims = jwt.decode(key, options={"verify_signature": False})
                admin_key = claims.get("role") == "service_role"
            except (ValueError, jwt.PyJWTError):
                admin_key = False
        if not admin_key or not key.isascii() or any(char.isspace() for char in key):
            raise ConfigurationError("Use a backend-only SUPABASE_KEY (secret or legacy service-role key) from the same project.")
        object.__setattr__(self, "project_url", project_url)
        object.__setattr__(self, "api_key", key)


def load_settings(*, env_file: Path = ENV_FILE, environ: Mapping[str, str] | None = None) -> Settings:
    # Read this file only; do not search parent directories or alter process variables.
    values = dotenv_values(env_file, interpolate=False, encoding="utf-8-sig") if env_file.is_file() else {}
    environment = os.environ if environ is None else environ
    return Settings(
        project_url=environment.get("SUPABASE_URL", values.get("SUPABASE_URL") or ""),
        api_key=environment.get(
            "SUPABASE_KEY", values.get("SUPABASE_KEY") or ""
        ),
    )


def probe_reports(settings: Settings, *, transport: httpx.BaseTransport | None = None) -> tuple[bool, str]:
    try:
        with httpx.Client(timeout=10.0, follow_redirects=False, transport=transport) as client:
            response = client.get(
                settings.project_url + "/rest/v1/reports",
                headers={
                    "apikey": settings.api_key,
                    "Accept": "application/json",
                    "Accept-Profile": "public",
                },
                params={"select": ",".join(REPORT_COLUMNS), "limit": "0"},
            )
    except httpx.TimeoutException:
        return False, "The Supabase request timed out. Check project availability and your connection."
    except httpx.RequestError:
        return False, "Could not reach Supabase. Check the Project URL, network, and TLS configuration."

    # Never print upstream bodies or exception details: they may contain sensitive values.
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if response.status_code == 200:
        if payload != []:
            return False, "Unexpected response: the zero-row JSON probe did not return an empty array."
        return True, (
            "Connected to Supabase Data API. public.reports accepted the expected columns. "
            "The query used limit=0; no report rows were requested or changed."
        )
    code = payload.get("code") if isinstance(payload, dict) else None
    if code == "42703":
        message = "A requested column is missing. Compare reports with the column list in the guide."
    elif code == "42501" or response.status_code == 403:
        message = "Access denied. Ask the project owner to check the Data API table grants."
    elif response.status_code == 401:
        message = "The API key was rejected. Check that the URL and SUPABASE_KEY belong to the same project."
    elif response.status_code == 404:
        message = "The reports route is unavailable. Check public.reports and its Data API exposure."
    elif 300 <= response.status_code < 400:
        message = "Supabase returned a redirect, which was not followed. Recheck the Project URL."
    elif response.status_code == 429:
        message = "Supabase rate-limited the probe. Try again later."
    else:
        message = "The Data API query failed. Check the project status and table configuration."
    return False, f"HTTP {response.status_code}: {message}"


def main() -> int:
    try:
        settings = load_settings()
    except ConfigurationError as error:
        print(f"Configuration required: {error}")
        return 2
    success, message = probe_reports(settings)
    print(message)
    if success:
        print("Checked columns: " + ", ".join(REPORT_COLUMNS))
        print("This does not test Supabase Auth, row visibility, or write permissions.")
        print("The application still uses SQLite. Cloud integration is a separate next step.")
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
