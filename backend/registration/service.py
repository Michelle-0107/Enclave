"""Email OTP orchestration; state transitions live in a backend-only PostgreSQL RPC."""

from dataclasses import dataclass, field
import hashlib
import hmac
import json
import secrets
from uuid import UUID, uuid4

from .clients import AccountRejected, RegistrationStore, RegistrationUnavailable, SupabaseSignup
from .settings import RegistrationSettings
from .contracts import (ManagementResidentList, OTPAccepted, SignupResult,
                        InvitationResult, Residency, ResidentUpdate, VerifySignup)
from ..services.email_service import EmailUnavailable, ResendDelivery


class RegistrationRejected(ValueError):
    def __init__(self, status=400, message="Invalid or expired registration proof"):
        self.status, self.message = status, message
        super().__init__(message)


@dataclass(frozen=True)
class PendingEmail:
    challenge_id: UUID
    email: str
    code: str = field(repr=False)


class RegistrationService:
    def __init__(self, settings: RegistrationSettings, store=None, delivery=None, accounts=None, *, otp_factory=None):
        self.settings = settings
        self.store = store or RegistrationStore(settings)
        self.delivery = delivery or ResendDelivery(settings)
        self.accounts = accounts or SupabaseSignup(settings)
        self.otp_factory = otp_factory or (lambda: f"{secrets.randbelow(1_000_000):06d}")

    def close(self):
        for dependency in (self.store, self.delivery, self.accounts):
            dependency.close()

    def _hmac(self, value: bytes):
        return hmac.new(self.settings.pepper, value, hashlib.sha256).hexdigest()

    def otp_digest(self, context, code):
        payload = {key: str(context[key]) for key in ("id", "invitation_id", "resident_id", "email")}
        payload.update(purpose="resident_signup", otp=code)
        return self._hmac(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode())

    def _rate(self, scope, subject):
        digest = self._hmac(("rate:" + scope + ":" + subject).encode())
        result = self.store.call("rate", scope=scope, digest=digest)
        if not isinstance(result, dict) or type(result.get("allowed")) is not bool:
            raise RegistrationUnavailable()
        return result["allowed"]

    def request_otp(self, data, peer: str):
        identifier = uuid4()
        accepted = OTPAccepted(challenge_id=identifier)
        if not self._rate("request-ip", peer) or not self._rate("request-email", str(data.email)):
            return accepted, None
        context = self.store.call("lookup_invitation", email=str(data.email))
        if context is None:
            return accepted, None
        try:
            context = {"id": str(identifier), "resident_id": str(UUID(context["resident_id"])),
                       "invitation_id": str(UUID(context["invitation_id"])), "email": context["email"]}
            if context["email"] != str(data.email):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise RegistrationUnavailable() from None
        code = self.otp_factory()
        result = self.store.call("create_challenge", **context, otp_digest=self.otp_digest(context, code),
                                  pepper_version=self.settings.pepper_version)
        if result.get("created") is not True:
            return accepted, None
        return accepted, PendingEmail(identifier, context["email"], code)

    def deliver(self, pending: PendingEmail):
        try:
            message_id = self.delivery.send_invite_email(pending.email, pending.code, str(pending.challenge_id))
            self.store.call("delivery", id=str(pending.challenge_id), status="accepted", message_id=message_id)
        except EmailUnavailable:
            try:
                self.store.call("delivery", id=str(pending.challenge_id), status="failed")
            except RegistrationUnavailable:
                pass
        except RegistrationUnavailable:
            # A pending row cannot verify. Resend/expiry recovery creates a new challenge.
            pass

    def verify_and_signup(self, data: VerifySignup, request_key: str, peer: str):
        if not self._rate("verify-ip", peer):
            raise RegistrationRejected(429, "Too many verification attempts")
        context = self.store.call("challenge", id=str(data.challenge_id))
        if context is None:
            raise RegistrationRejected()
        try:
            expected = context["otp_digest"]
            valid = context["pepper_version"] == self.settings.pepper_version and hmac.compare_digest(
                bytes.fromhex(expected), bytes.fromhex(self.otp_digest(context, data.otp)))
            email = context["email"]
        except (ValueError, TypeError, KeyError):
            raise RegistrationUnavailable() from None
        if not self._rate("verify-email", email):
            raise RegistrationRejected(429, "Too many verification attempts")
        lease = str(uuid4())
        identifier = str(data.challenge_id)
        acquired = self.store.call("acquire", id=identifier, expected_digest=expected, matches=valid,
                                   request_digest=hashlib.sha256(request_key.encode()).hexdigest(), lease=lease)
        state = acquired.get("state")
        if state == "busy":
            raise RegistrationRejected(409, "Registration is in progress; retry the same request")
        if state != "acquired":
            raise RegistrationRejected()
        try:
            if acquired.get("email") != email:
                raise RegistrationUnavailable()
            password = data.password.get_secret_value()
            authenticated = self.accounts.login(email, password)
            created_id = None
            if authenticated is None:
                if acquired.get("auth_user_id") is not None or acquired.get("completed"):
                    raise AccountRejected()
                created_id = self.accounts.create(email, password, identifier)
                authenticated = self.accounts.login(email, password)
            if authenticated is None:
                raise AccountRejected()
            user_id, session = authenticated
            previous = acquired.get("auth_user_id")
            if (previous is not None and UUID(previous) != user_id) or (created_id is not None and created_id != user_id):
                raise AccountRejected()
            remembered = self.store.call("remember_auth", id=identifier, lease=lease, user_id=str(user_id))
            if remembered.get("recorded") is not True:
                raise RegistrationRejected(409, "Registration could not complete; retry the same request")
            finished = self.store.call("finish", id=identifier, lease=lease, user_id=str(user_id))
            if finished.get("state") != "completed":
                raise RegistrationRejected(409, "Registration could not complete; retry the same request")
            return SignupResult(resident_id=UUID(finished["resident_id"]), user_id=user_id, session=session)
        except AccountRejected:
            raise RegistrationRejected(409, "Account could not be authenticated; use the existing password or account recovery") from None
        finally:
            try:
                self.store.call("release", id=identifier, lease=lease)
            except RegistrationUnavailable:
                pass

    def create_resident(self, user_id, data):
        result = self.store.call("create_resident", actor_id=str(user_id), **data.model_dump(mode="json"))
        self._management_result(result)
        return {"resident_id": UUID(result["resident_id"])}

    def issue_invitation(self, user_id, resident_id):
        token = secrets.token_urlsafe(32)
        result = self.store.call("issue_invitation", actor_id=str(user_id), resident_id=str(resident_id),
                                 id=str(uuid4()), token_digest=hashlib.sha256(token.encode()).hexdigest())
        self._management_result(result)
        return InvitationResult(invitation_id=result["invitation_id"], resident_id=resident_id,
                                invitation_token=token, expires_at=result["expires_at"])

    def management_residents(self, user_id):
        result = self.store.management_call("list", actor_id=str(user_id))
        if result.get("state") == "forbidden":
            raise RegistrationRejected(403, "Management access required")
        if result.get("state") != "listed" or not isinstance(result.get("residents"), list):
            raise RegistrationRejected(503, "Resident directory is unavailable")
        return ManagementResidentList.model_validate(result)

    def update_resident(self, user_id, resident_id, data: ResidentUpdate):
        result = self.store.management_call(
            "update",
            actor_id=str(user_id),
            resident_id=str(resident_id),
            **data.model_dump(mode="json"),
        )
        state = result.get("state")
        if state == "forbidden":
            raise RegistrationRejected(403, "Management access required")
        if state == "not_found":
            raise RegistrationRejected(404, "Resident not found")
        if state == "conflict":
            raise RegistrationRejected(409, "Resident email cannot be changed after account registration, or the record conflicts with an existing resident")
        if state != "updated":
            raise RegistrationRejected(503, "Resident record could not be updated")
        return {"resident_id": UUID(result["resident_id"])}

    def prepare_resident_deletion(self, user_id, resident_id):
        result = self.store.management_purge(
            "prepare", actor_id=str(user_id), resident_id=str(resident_id)
        )
        state = result.get("state")
        if state == "forbidden":
            raise RegistrationRejected(403, "Management access required")
        if state == "not_found":
            raise RegistrationRejected(404, "Resident not found")
        if state == "blocked":
            raise RegistrationRejected(409, "This resident has related records that prevent safe deletion")
        if state != "prepared":
            raise RegistrationRejected(503, "Resident deletion could not be prepared")
        try:
            auth_user_id = UUID(result["auth_user_id"]) if result.get("auth_user_id") else None
            image_urls = result["image_urls"]
            if not isinstance(image_urls, list) or not all(isinstance(url, str) for url in image_urls):
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise RegistrationRejected(503, "Resident deletion could not be prepared") from None
        return {"auth_user_id": auth_user_id, "image_urls": image_urls}

    def delete_auth_user(self, user_id):
        self.accounts.delete_user(user_id)

    def finalize_resident_deletion(self, user_id, resident_id):
        result = self.store.management_purge(
            "finalize", actor_id=str(user_id), resident_id=str(resident_id)
        )
        state = result.get("state")
        if state == "forbidden":
            raise RegistrationRejected(403, "Management access required")
        if state == "not_found":
            raise RegistrationRejected(404, "Resident deletion could not be finalized")
        if state == "blocked":
            raise RegistrationRejected(409, "Related database records prevent safe deletion")
        if state != "deleted":
            raise RegistrationRejected(503, "Resident deletion is still pending; retry it")

    @staticmethod
    def _management_result(result):
        if result.get("state") == "forbidden":
            raise RegistrationRejected(403, "Management access required")
        if result.get("state") == "not_found":
            raise RegistrationRejected(404, "Resident not found")
        if result.get("state") != "created":
            raise RegistrationRejected(409, "Resident or invitation conflicts with existing registration")

    def residency(self, user_id):
        result = self.store.call("residency", user_id=str(user_id))
        if result is None:
            raise RegistrationRejected(404, "No resident binding found")
        return Residency.model_validate(result)
