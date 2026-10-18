"""Resident registration replaces the former plaintext-code email demo route."""

from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from ..core.auth import AuthUnavailable, InvalidCredentials
from ..registration import RegistrationRejected
from ..registration.contracts import (InvitationResult, OTPAccepted, RequestOTP, ResidentInput,
                                    ManagementResidentList, Residency, ResidentUpdate, SignupResult, VerifySignup)

router = APIRouter(tags=["Registration"])
bearer = HTTPBearer(scheme_name="SupabaseAccessToken", auto_error=False,
                    description="Paste the Supabase Auth access_token, without the Bearer prefix.")


def service(request: Request):
    result = request.app.state.registration
    if result is None:
        raise HTTPException(503, "Registration is not configured; set backend registration secrets and apply SQL 005")
    return result


def user(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(401, "Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})
    try:
        return request.app.state.verifier.verify(credentials.credentials)
    except InvalidCredentials:
        raise HTTPException(401, "Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"}) from None
    except AuthUnavailable:
        raise HTTPException(503, "Authentication service unavailable") from None


def peer(request):
    # Use the server's resolved peer. Do not trust arbitrary client-supplied forwarding headers.
    return request.client.host if request.client else "unknown"


@router.post("/api/v1/registration/request-otp", response_model=OTPAccepted, status_code=202)
def request_otp(data: RequestOTP, request: Request, response: Response,
                background_tasks: BackgroundTasks, registration=Depends(service)):
    response.headers["Cache-Control"] = "no-store"
    accepted, pending = registration.request_otp(data, peer(request))
    if pending is not None:
        background_tasks.add_task(registration.deliver, pending)
    return accepted


# Keep the team's URL, but require the same invitation-bound contract and never return generated_code.
router.add_api_route("/api/send-verification-email", request_otp, methods=["POST"],
                     response_model=OTPAccepted, status_code=202, deprecated=True)


@router.post("/api/v1/registration/verify-and-signup", response_model=SignupResult)
def verify_signup(data: VerifySignup, request: Request, response: Response,
                  idempotency_key: str = Header(min_length=32, max_length=128,
                                               pattern=r"^[A-Za-z0-9_-]+$", alias="Idempotency-Key"),
                  registration=Depends(service)):
    response.headers["Cache-Control"] = "no-store"
    return registration.verify_and_signup(data, idempotency_key, peer(request))


@router.get("/api/v1/me/residency", response_model=Residency)
def my_residency(response: Response, identity=Depends(user), registration=Depends(service)):
    response.headers["Cache-Control"] = "no-store"
    return registration.residency(identity.user_id)


@router.post("/api/v1/management/residents", status_code=201, tags=["Management"])
def create_resident(data: ResidentInput, identity=Depends(user), registration=Depends(service)):
    return registration.create_resident(identity.user_id, data)


@router.get("/api/v1/management/residents", response_model=ManagementResidentList, tags=["Management"])
def management_residents(response: Response, identity=Depends(user), registration=Depends(service)):
    response.headers["Cache-Control"] = "no-store"
    return registration.management_residents(identity.user_id)


@router.patch("/api/v1/management/residents/{resident_id}", tags=["Management"])
def update_resident(resident_id: UUID, data: ResidentUpdate,
                    identity=Depends(user), registration=Depends(service)):
    return registration.update_resident(identity.user_id, resident_id, data)


@router.delete("/api/v1/management/residents/{resident_id}", status_code=204, tags=["Management"])
def delete_resident(resident_id: UUID, request: Request, response: Response,
                    identity=Depends(user), registration=Depends(service)):
    response.headers["Cache-Control"] = "no-store"
    deletion = registration.prepare_resident_deletion(identity.user_id, resident_id)
    if deletion["auth_user_id"] is not None:
        registration.delete_auth_user(deletion["auth_user_id"])
    if deletion["image_urls"]:
        media = getattr(request.app.state, "media", None)
        if media is None or not media.delete_report_images(deletion["image_urls"]):
            raise RegistrationRejected(503, "Account and report records are removed; photo cleanup is pending. Retry deletion to finish cleanup")
    registration.finalize_resident_deletion(identity.user_id, resident_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("/api/v1/management/residents/{resident_id}/invitations", response_model=InvitationResult,
             status_code=201, tags=["Management"])
def issue_invitation(resident_id: UUID, response: Response, identity=Depends(user), registration=Depends(service)):
    response.headers["Cache-Control"] = "no-store"
    return registration.issue_invitation(identity.user_id, resident_id)
