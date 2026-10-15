"""Verify Supabase user access tokens using the configured project's public keys."""

from dataclasses import dataclass
import threading
import time
from typing import Callable
from uuid import UUID

import httpx
import jwt

from ..config import Settings


JWKS_CACHE_SECONDS = 300
UNKNOWN_KEY_REFRESH_SECONDS = 30
MAX_TOKEN_LENGTH = 16384


class InvalidCredentials(ValueError):
    """The supplied token is not an acceptable Supabase user access token."""


class AuthUnavailable(RuntimeError):
    """The configured project's verification keys are temporarily unavailable."""


@dataclass(frozen=True)
class VerifiedUser:
    user_id: UUID
    email: str | None


class TokenVerifier:
    """Verify Supabase ES256 tokens with project JWKS and legacy HS256 tokens with its JWT secret."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.issuer = settings.project_url + "/auth/v1"
        self.jwks_url = self.issuer + "/.well-known/jwks.json"
        self.jwt_secret = settings.jwt_secret
        self.client = httpx.Client(timeout=5.0, follow_redirects=False, transport=transport)
        self.clock = clock
        self.lock = threading.Lock()
        self.keys: dict[str, jwt.PyJWK] = {}
        self.expires_at = 0.0
        self.refresh_after = 0.0

    def close(self) -> None:
        self.client.close()

    def _refresh_keys(self) -> None:
        # Only the configured URL is used. Token headers cannot choose a key URL.
        try:
            response = self.client.get(self.jwks_url, headers={"Accept": "application/json"})
            if response.status_code != 200:
                raise AuthUnavailable()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("keys"), list):
                raise AuthUnavailable()
            keys = {}
            for entry in payload["keys"]:
                if not isinstance(entry, dict):
                    continue
                kid = entry.get("kid")
                if (
                    not isinstance(kid, str) or not kid or len(kid) > 200
                    or entry.get("alg") != "ES256"
                    or entry.get("kty") != "EC" or entry.get("crv") != "P-256"
                    or entry.get("use", "sig") != "sig"
                    or "d" in entry
                    or ("key_ops" in entry and entry["key_ops"] != ["verify"])
                ):
                    continue
                if kid in keys:
                    raise AuthUnavailable()
                keys[kid] = jwt.PyJWK.from_dict(entry, algorithm="ES256")
            if not keys:
                raise AuthUnavailable()
        except (httpx.RequestError, ValueError, TypeError, KeyError, jwt.PyJWTError):
            # Do not expose upstream responses, URLs, keys, or exception details.
            raise AuthUnavailable() from None
        self.keys = keys
        now = self.clock()
        self.expires_at = now + JWKS_CACHE_SECONDS
        self.refresh_after = now + UNKNOWN_KEY_REFRESH_SECONDS

    def _get_key(self, kid: str) -> jwt.PyJWK:
        # Serialize cache refreshes to avoid duplicate requests during concurrent login.
        with self.lock:
            now = self.clock()
            if not self.keys or now >= self.expires_at:
                self._refresh_keys()
            elif kid not in self.keys and now >= self.refresh_after:
                # Allow rotation discovery, with a cooldown for arbitrary unknown kids.
                self._refresh_keys()
            key = self.keys.get(kid)
            if key is None:
                raise InvalidCredentials()
            return key

    def verify(self, token: str) -> VerifiedUser:
        if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LENGTH:
            raise InvalidCredentials()
        try:
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            algorithm = header.get("alg")
            if header.get("crit"):
                raise InvalidCredentials()
            if algorithm == "ES256":
                if not isinstance(kid, str) or not kid or len(kid) > 200:
                    raise InvalidCredentials()
                # Unverified headers select a public key only; identity comes from decode.
                key = self._get_key(kid)
            elif algorithm == "HS256" and self.jwt_secret:
                key = self.jwt_secret
            else:
                raise InvalidCredentials()
            claims = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                issuer=self.issuer,
                audience="authenticated",
                options={"require": ["exp", "iat", "iss", "aud", "sub", "role"]},
                leeway=0,
            )
            if (
                claims["role"] != "authenticated"
                or type(claims["exp"]) is not int
                or type(claims["iat"]) is not int
                or claims["exp"] <= claims["iat"]
            ):
                raise InvalidCredentials()
            user_id = UUID(claims["sub"])
            email = claims.get("email")
            if email is not None and not isinstance(email, str):
                raise InvalidCredentials()
            return VerifiedUser(user_id=user_id, email=email or None)
        except (jwt.PyJWTError, ValueError, TypeError, KeyError, AttributeError):
            raise InvalidCredentials() from None
