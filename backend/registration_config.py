"""Server-only registration settings, isolated from per-user report credentials."""

import base64
from dataclasses import dataclass, field
from email.utils import parseaddr
from pathlib import Path
from typing import Mapping
import jwt

from .config import ConfigurationError, ENV_FILE, Settings, _load_values


@dataclass(frozen=True)
class RegistrationSettings:
    cloud: Settings
    admin_key: str = field(repr=False)
    resend_key: str = field(repr=False)
    sender: str
    pepper: bytes = field(repr=False)
    pepper_version: int = 1

    def __post_init__(self):
        if not self.admin_key or any(c.isspace() for c in self.admin_key):
            raise ConfigurationError("Set a backend-only Supabase secret or service-role key.")
        if not self.admin_key.startswith("sb_secret_"):
            try:
                claims = jwt.decode(self.admin_key, options={"verify_signature": False})
                if claims.get("role") != "service_role":
                    raise ValueError()
            except (ValueError, jwt.PyJWTError):
                raise ConfigurationError("Registration requires a backend-only Supabase Admin key.") from None
        if not self.resend_key.startswith("re_") or any(c.isspace() for c in self.resend_key):
            raise ConfigurationError("Set RESEND_API_KEY.")
        _, address = parseaddr(self.sender)
        if "@" not in address or "\r" in self.sender or "\n" in self.sender:
            raise ConfigurationError("Set RESEND_FROM_EMAIL to an approved sender address.")
        if not isinstance(self.pepper, bytes) or len(self.pepper) < 32 or self.pepper_version < 1:
            raise ConfigurationError("Set a base64url OTP_HMAC_SECRET containing at least 32 random bytes.")

    def admin_headers(self):
        headers = {"apikey": self.admin_key}
        if not self.admin_key.startswith("sb_secret_"):
            headers["Authorization"] = "Bearer " + self.admin_key
        return headers


def load_registration_settings(cloud: Settings, *, env_file: Path = ENV_FILE,
                               environ: Mapping[str, str] | None = None):
    values = _load_values(env_file, environ)
    secret = values.get("SUPABASE_SECRET_KEY", "").strip()
    legacy = values.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if secret and legacy:
        raise ConfigurationError("Configure one Supabase Admin key name, not both.")
    try:
        encoded = values.get("OTP_HMAC_SECRET", "").strip()
        pepper = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
        version = int(values.get("OTP_HMAC_VERSION", "1"))
    except (ValueError, TypeError):
        raise ConfigurationError("Invalid OTP secret configuration.") from None
    return RegistrationSettings(cloud, secret or legacy, values.get("RESEND_API_KEY", "").strip(),
                                values.get("RESEND_FROM_EMAIL", "").strip(), pepper, version)
