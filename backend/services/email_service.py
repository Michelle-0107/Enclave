"""Adapt the team's invitation-email template for five-minute, server-verified OTPs."""

import re
import httpx
from ..registration_config import RegistrationSettings


class EmailUnavailable(RuntimeError):
    pass


class ResendDelivery:
    def __init__(self, settings: RegistrationSettings, *, transport=None):
        self.settings = settings
        self.client = httpx.Client(timeout=10, follow_redirects=False, transport=transport, trust_env=False)

    def close(self):
        self.client.close()

    def send_invite_email(self, to_email: str, code: str, challenge_id: str) -> str:
        if re.fullmatch(r"[0-9]{6}", code) is None:
            raise EmailUnavailable()
        # Only the transient send payload contains the code. Never return/log the provider response.
        params = {
            "from": self.settings.sender, "to": [to_email],
            "subject": "Enclave: verify your email",
            "html": ("<div style='font-family:Arial,sans-serif;padding:20px'>"
                     "<h2>Enclave resident registration</h2><p>Your email verification code is:</p>"
                     f"<h1 style='letter-spacing:2px'>{code}</h1>"
                     "<p>This code expires in 5 minutes. Your resident invitation is a separate code.</p>"
                     "<p>If you did not request this email, please ignore it.</p></div>"),
        }
        try:
            response = self.client.post("https://api.resend.com/emails", json=params, headers={
                "Authorization": "Bearer " + self.settings.resend_key,
                "Idempotency-Key": "enclave-otp/" + challenge_id,
            })
            payload = response.json()
            identifier = payload.get("id") if isinstance(payload, dict) else None
            if response.status_code not in (200, 201) or not isinstance(identifier, str) or not identifier or len(identifier) > 256:
                raise EmailUnavailable()
            return identifier
        except (httpx.HTTPError, ValueError):
            raise EmailUnavailable() from None
