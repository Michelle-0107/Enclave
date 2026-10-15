"""Check registration settings without editing the team's .env file."""

import argparse
from pathlib import Path
import sys

from dotenv import dotenv_values

from ..config import ConfigurationError, ENV_FILE


REQUIRED_REGISTRATION_FIELDS = ("SUPABASE_URL", "SUPABASE_KEY", "RESEND_API_KEY")


def prepare_env(path: Path = ENV_FILE) -> tuple[str, ...]:
    """Return missing canonical settings; never generate, rotate, or write secrets."""
    path = Path(path)
    if path.name != ".env" or path.is_symlink():
        raise ConfigurationError("Use the application's private .env file.")
    values = dotenv_values(path, interpolate=False, encoding="utf-8-sig") if path.is_file() else {}
    return tuple(name for name in REQUIRED_REGISTRATION_FIELDS if not (values.get(name) or "").strip())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ENV_FILE, help="Private application .env path.")
    options = parser.parse_args()
    try:
        missing = prepare_env(options.env_file)
    except (ConfigurationError, OSError, UnicodeError):
        print("Registration settings could not be read. Check the .env path and encoding privately.")
        return 2
    if missing:
        print("Fill these existing Enclave environment fields: " + ", ".join(missing))
        return 2
    print("Registration environment fields are present. Values were hidden; no file or provider was changed.")
    print("SUPABASE_KEY must be a backend-only secret/service-role key. SUPABASE_JWT_SECRET is optional for legacy HS256 tokens; Resend sender is configured in backend code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
