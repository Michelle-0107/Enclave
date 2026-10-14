"""Authenticated Enclave cloud reports, preserving the S3 and AI submission pipeline."""

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Path, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import httpx
from pydantic import ValidationError

from .auth import AuthUnavailable, InvalidCredentials, TokenVerifier, VerifiedUser
from .config import ConfigurationError, Settings, load_settings
from .media import MediaServices, MediaUnavailable
from .models import AIAnalysis, CurrentUserResponse, ReportCreatedResponse, ReportListResponse, ReportResponse
from .reports import ReportAccessDenied, ReportsRepository, ReportsUnavailable


MAX_PHOTO_BYTES = 10 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png"}
bearer = HTTPBearer(scheme_name="SupabaseAccessToken", auto_error=False,
                    description="Paste the Supabase Auth access_token, without the Bearer prefix.")


@dataclass(frozen=True)
class AuthenticatedUser(VerifiedUser):
    access_token: str = field(repr=False)


def current_user(
    request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> AuthenticatedUser:
    unauthorized = HTTPException(401, "Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})
    if credentials is None:
        raise unauthorized
    try:
        verified = request.app.state.verifier.verify(credentials.credentials)
    except InvalidCredentials:
        raise unauthorized from None
    except AuthUnavailable:
        raise HTTPException(503, "Authentication service unavailable") from None
    return AuthenticatedUser(verified.user_id, verified.email, credentials.credentials)


def create_app(
    settings: Settings | None = None, *, auth_transport: httpx.BaseTransport | None = None,
    reports_transport: httpx.AsyncBaseTransport | None = None, media_services: MediaServices | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        try:
            configured = settings if settings is not None else load_settings()
        except ConfigurationError:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the root .env.") from None
        verifier = TokenVerifier(configured, transport=auth_transport)
        repository = ReportsRepository(configured, transport=reports_transport)
        application.state.verifier = verifier
        application.state.reports = repository
        application.state.media = media_services if media_services is not None else MediaServices(configured)
        try:
            yield
        finally:
            verifier.close()
            await repository.close()

    application = FastAPI(
        title="Enclave Backend API", version="0.3.0", lifespan=lifespan,
        description="Supabase JWT authentication, owner-only cloud reports, and S3/AI report submission.",
    )

    @application.exception_handler(ReportsUnavailable)
    async def unavailable_handler(request, error):
        return JSONResponse(status_code=503, content={"detail": "Reports service unavailable"})

    @application.exception_handler(ReportAccessDenied)
    async def denied_handler(request, error):
        return JSONResponse(status_code=403, content={"detail": "Report access denied by database policy"})

    @application.get("/", tags=["Health"])
    def root():
        return {"message": "Welcome to Enclave API"}

    @application.get("/health", tags=["Health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/auth/me", response_model=CurrentUserResponse, tags=["Authentication"], responses={
        401: {"description": "Missing, invalid, or expired access token."},
        503: {"description": "Verification keys are unavailable."},
    })
    def me(user: AuthenticatedUser = Depends(current_user)):
        return CurrentUserResponse(user_id=user.user_id, email=user.email)

    errors = {401: {"description": "Invalid credentials."}, 403: {"description": "Database policy denied access."},
              503: {"description": "Cloud service unavailable."}}

    @application.post("/api/v1/reports", response_model=ReportCreatedResponse, status_code=201,
                      tags=["Reports"], responses={**errors, 413: {"description": "Photo exceeds 10 MiB."},
                                                   415: {"description": "Unsupported photo type."}})
    async def submit_report(
        request: Request, user: AuthenticatedUser = Depends(current_user),
        description: str = Form(..., min_length=1, max_length=1000),
        latitude: float = Form(..., ge=-90, le=90), longitude: float = Form(..., ge=-180, le=180),
        file: UploadFile = File(...),
    ):
        description = description.strip()
        if not description:
            raise HTTPException(422, "Description must contain non-whitespace text")
        if "user_id" in await request.form():
            raise HTTPException(422, "user_id is assigned from the verified access token; omit this form field")
        extension = PHOTO_TYPES.get(file.content_type)
        if extension is None:
            raise HTTPException(415, "Use a JPEG or PNG photo")
        file_bytes = await file.read(MAX_PHOTO_BYTES + 1)
        if len(file_bytes) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "Photo exceeds the 10 MiB limit")
        if not file_bytes:
            raise HTTPException(422, "Photo must not be empty")
        media = request.app.state.media
        try:
            image_url = await run_in_threadpool(media.upload, "report_" + uuid4().hex + "." + extension,
                                                 file_bytes, file.content_type)
        except MediaUnavailable:
            raise HTTPException(503, "Photo storage unavailable") from None
        ai_result = await run_in_threadpool(media.analyze, file_bytes, description)
        try:
            analysis = AIAnalysis.model_validate(ai_result)
        except ValidationError:
            analysis = AIAnalysis(category="Damaged Facility", priority="medium", summary=description)
        ticket_id = "TICK-" + uuid4().hex
        row = {
            "ticket_id": ticket_id, "user_id": str(user.user_id), "description": analysis.summary,
            "status": "pending", "image_url": image_url, "category": analysis.category,
            "priority": analysis.priority, "latitude": latitude, "longitude": longitude, "is_approved": False,
        }
        record = await request.app.state.reports.create(row, user.access_token, user.user_id)
        return ReportCreatedResponse(ticket_id=ticket_id, ai_analysis=analysis, image_url=image_url, data=[record])

    @application.get("/api/v1/reports", response_model=ReportListResponse, tags=["Reports"], responses=errors)
    async def my_reports(
        request: Request, user: AuthenticatedUser = Depends(current_user),
        limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0),
    ):
        records = await request.app.state.reports.list_for_owner(user.access_token, user.user_id, limit=limit, offset=offset)
        return ReportListResponse(items=records, limit=limit, offset=offset)

    @application.get("/api/v1/reports/{ticket_id}", response_model=ReportResponse, tags=["Reports"],
                     responses={**errors, 404: {"description": "Unknown or inaccessible report."}})
    async def report_detail(
        request: Request, ticket_id: Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")],
        user: AuthenticatedUser = Depends(current_user),
    ):
        record = await request.app.state.reports.get_for_owner(user.access_token, user.user_id, ticket_id)
        if record is None:
            raise HTTPException(404, "Report not found")
        return record

    return application


app = create_app()
