"""Load only the repository-root .env and explicit environment overrides."""

from dataclasses import dataclass, field
import os
from pathlib import Path
import re
from typing import Mapping
from urllib.parse import urlsplit

from dotenv import dotenv_values
import jwt


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
SERVICE_NAMES = ("AWS_REGION", "AWS_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET_NAME",
                 "BEDROCK_MODEL_ID", "GEMINI_API_KEY")


class ConfigurationError(ValueError):
    """Required cloud configuration is missing or unsupported."""


@dataclass(frozen=True)
class Settings:
    project_url: str
    api_key: str = field(repr=False)
    service_values: Mapping[str, str] = field(default_factory=dict, repr=False)
    jwt_secret: str = field(default="", repr=False)

    def __post_init__(self):
        url = self.project_url.strip().rstrip("/")
        key = self.api_key.strip()
        try:
            parsed = urlsplit(url)
            valid = (
                parsed.scheme == "https" and re.fullmatch(r"[a-z0-9]+\.supabase\.co", parsed.hostname or "")
                and parsed.port in (None, 443) and parsed.username is None and parsed.password is None
                and not parsed.path and not parsed.query and not parsed.fragment
            )
        except ValueError:
            valid = False
        admin_key = key.startswith("sb_secret_")
        if not admin_key:
            try:
                claims = jwt.decode(key, options={"verify_signature": False})
                admin_key = claims.get("role") == "service_role"
            except (ValueError, jwt.PyJWTError):
                admin_key = False
        if not valid or not admin_key or not key.isascii() or any(c.isspace() for c in key):
            raise ConfigurationError("Set a hosted SUPABASE_URL and a backend-only Admin SUPABASE_KEY in the root .env.")
        object.__setattr__(self, "project_url", url)
        object.__setattr__(self, "api_key", key)
        jwt_secret = self.jwt_secret.strip()
        if jwt_secret and len(jwt_secret.encode("utf-8")) < 32:
            raise ConfigurationError("SUPABASE_JWT_SECRET must contain at least 32 bytes.")
        object.__setattr__(self, "jwt_secret", jwt_secret)


def _load_values(env_file: Path, environ: Mapping[str, str] | None) -> dict[str, str]:
    file_values = dotenv_values(env_file, interpolate=False, encoding="utf-8-sig") if env_file.is_file() else {}
    environment = os.environ if environ is None else environ
    values = {name: value for name, value in file_values.items() if isinstance(value, str)}
    values.update(environment)
    return values


def load_service_values(*, env_file: Path = ENV_FILE, environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Load storage/AI configuration without requiring a Supabase account or settings."""
    values = _load_values(env_file, environ)
    return {name: values[name] for name in SERVICE_NAMES if name in values}


def load_settings(*, env_file: Path = ENV_FILE, environ: Mapping[str, str] | None = None) -> Settings:
    values = _load_values(env_file, environ)
    services = {name: values[name] for name in SERVICE_NAMES if name in values}
    return Settings(values.get("SUPABASE_URL", ""), values.get("SUPABASE_KEY", ""), services,
                    values.get("SUPABASE_JWT_SECRET", ""))
