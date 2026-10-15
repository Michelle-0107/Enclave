"""Registration settings derived from the team's fixed environment contract."""

import hashlib
import hmac
from dataclasses import dataclass, field
from email.utils import parseaddr
from pathlib import Path
from typing import Mapping
import jwt

from ..config import ConfigurationError, ENV_FILE, Settings, _load_values


OTP_PEPPER_VERSION = 1
OTP_KEY_CONTEXT = b"Enclave resident OTP HMAC key v1"
RESEND_SENDER = "Enclave <noreply@enclavehomes.app>"


def derive_otp_pepper(supabase_key: str) -> bytes:
    """Derive a purpose-specific OTP key from the backend-only key."""
    secret = supabase_key.strip().encode("utf-8")
    if len(secret) < 32:
        raise ConfigurationError("SUPABASE_KEY is too short to derive the OTP HMAC key.")
    return hmac.new(secret, OTP_KEY_CONTEXT, hashlib.sha256).digest()


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
            raise ConfigurationError("Set SUPABASE_KEY to a backend-only Supabase secret or service-role key.")
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
            raise ConfigurationError("The code-level Resend sender must be a valid approved address.")
        if not isinstance(self.pepper, bytes) or len(self.pepper) != 32 or self.pepper_version != OTP_PEPPER_VERSION:
            raise ConfigurationError("OTP key derivation failed; check SUPABASE_KEY privately.")

    def admin_headers(self):
        headers = {"apikey": self.admin_key}
        if not self.admin_key.startswith("sb_secret_"):
            headers["Authorization"] = "Bearer " + self.admin_key
        return headers


def load_registration_settings(cloud: Settings, *, env_file: Path = ENV_FILE,
                               environ: Mapping[str, str] | None = None):
    values = _load_values(env_file, environ)
    pepper = derive_otp_pepper(cloud.api_key)
    return RegistrationSettings(cloud, cloud.api_key, values.get("RESEND_API_KEY", "").strip(),
                                RESEND_SENDER, pepper, OTP_PEPPER_VERSION)
