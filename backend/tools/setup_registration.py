"""Prepare a private registration .env without displaying or replacing existing secrets."""

import argparse
import base64
import codecs
from io import StringIO
import os
from pathlib import Path
import re
import secrets
import sys
from uuid import uuid4

from dotenv import dotenv_values

from ..config import ConfigurationError, ENV_FILE


FIELDS = ("SUPABASE_SECRET_KEY", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "OTP_HMAC_SECRET", "OTP_HMAC_VERSION")


def validate_secret(encoded, version):
    try:
        decoded = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
        number = int(version)
        if len(decoded) < 32 or not 1 <= number <= 32767:
            raise ValueError()
    except (ValueError, TypeError):
        raise ConfigurationError("Existing OTP configuration is invalid; review it privately before proceeding.") from None


def prepare_env(path: Path = ENV_FILE):
    path = Path(path)
    if path.name != ".env" or path.is_symlink():
        raise ConfigurationError("Use the application's private .env file, not a shared template or link.")
    raw = path.read_bytes() if path.exists() else b""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError:
        raise ConfigurationError("The private .env must use UTF-8 encoding.") from None
    assignments = re.findall(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", text, re.MULTILINE)
    if len(assignments) != len(set(assignments)):
        raise ConfigurationError("Duplicate .env settings found; resolve them privately before setup.")
    values = dotenv_values(stream=StringIO(text), interpolate=False)
    secret = (values.get("OTP_HMAC_SECRET") or "").strip()
    version = (values.get("OTP_HMAC_VERSION") or "").strip() or "1"
    initialized = not bool(secret)
    # Validate before writing, and never silently rotate an existing key/version.
    if secret:
        validate_secret(secret, version)
    else:
        secret = secrets.token_urlsafe(32)
        validate_secret(secret, version)
    newline = "\r\n" if "\r\n" in text else "\n"
    original = text
    for name in FIELDS:
        desired = secret if name == "OTP_HMAC_SECRET" else version if name == "OTP_HMAC_VERSION" else ""
        if name in values:
            if name.startswith("OTP_") and not (values.get(name) or "").strip():
                pattern = r"^\s*(?:export\s+)?" + name + r"\s*=[^\r\n]*"
                text = re.sub(pattern, name + "=" + desired, text, count=1, flags=re.MULTILINE)
        else:
            if text and not text.endswith(("\n", "\r")):
                text += newline
            text += name + "=" + desired + newline
    after = dotenv_values(stream=StringIO(text), interpolate=False)
    for name, value in values.items():
        if name not in ("OTP_HMAC_SECRET", "OTP_HMAC_VERSION") and after.get(name) != value:
            raise ConfigurationError("An existing setting would change; no update made.")
    backup = None
    if text != original:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            backup = path.with_name(".env.registration-backup-" + uuid4().hex)
            with backup.open("xb") as handle:
                handle.write(raw)
        temporary = path.with_name(".env.setup-" + uuid4().hex + ".tmp")
        payload = (codecs.BOM_UTF8 if raw.startswith(codecs.BOM_UTF8) else b"") + text.encode("utf-8")
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
            os.replace(temporary, path)
        finally:
            if temporary.exists():
                temporary.unlink()
    return initialized, backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ENV_FILE, help="Private application .env path.")
    options = parser.parse_args()
    try:
        initialized, backup = prepare_env(options.env_file)
    except (ConfigurationError, OSError):
        print("Setup could not complete. Check file access, UTF-8, duplicate settings, and existing OTP configuration privately.")
        return 2
    print("Private registration fields prepared. OTP secret " + ("generated and saved." if initialized else "preserved."))
    if backup:
        print("Existing .env backed up privately beside the original. Keep both files out of Git.")
    print("Fill SUPABASE_SECRET_KEY (or existing legacy service-role key), RESEND_API_KEY, and RESEND_FROM_EMAIL.")
    print("Use this same OTP secret/version for every instance connected to the project's challenges.")
    print("No network calls, email delivery, or account/database creation were performed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
