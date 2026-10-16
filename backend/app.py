"""Authenticated Enclave cloud reports, preserving the S3 and AI submission pipeline."""

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Path, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
import httpx
from pydantic import ValidationError

from .core.auth import AuthUnavailable, InvalidCredentials, TokenVerifier, VerifiedUser
from .core.config import ConfigurationError, Settings, load_settings
from .reports.media import MediaServices, MediaUnavailable
from .reports.models import AIAnalysis, CurrentUserResponse, ReportCreatedResponse, ReportListResponse, ReportResponse
from .reports.repository import ReportAccessDenied, ReportsRepository, ReportsUnavailable
from .reports.moderation import (ReportWorkflow, ReportStatus, StatusUpdate, StatusUpdated,
                                 ManagementReportList, ReportHistory, WorkflowUnavailable, WorkflowRejected)
from .reports.map import MapBounds
from .navigation.config import NavigationSettings, PILOT_BBOX, MAP_CENTER
from .navigation.contracts import NavigationArea, WalkingRouteRequest, RouteResponse
from .navigation.provider import ValhallaProvider, NavigationRejected, NavigationUnavailable
from .navigation.service import NavigationService
from .reports.issues import (CommunityIssues,FacilityCreate,Facility,FacilityList,OpenIssue,JoinIssue,
                             IssueLinked,IssueList,IssueMapResponse,CommunityObstacleSnapshot,IssueUnavailable,IssueRejected)
from .navigation.accessibility import VerifiedNetwork
from .registration.residents import ResidentAccessRepository, ResidentDirectoryUnavailable
from .registration import RegistrationRejected, RegistrationService
from .registration.clients import RegistrationUnavailable
from .registration.settings import load_registration_settings
from .routers.email import router as registration_router
from fastapi.middleware.cors import CORSMiddleware


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


async def active_resident(
    request: Request, user: AuthenticatedUser = Depends(current_user),
) -> AuthenticatedUser:
    try:
        eligible = await request.app.state.residents.is_active_verified_resident(user.access_token, user.user_id)
    except ResidentDirectoryUnavailable:
        raise HTTPException(503, "Resident verification service unavailable") from None
    if not eligible:
        raise HTTPException(403, "An active verified resident account is required")
    return user


def create_app(
    settings: Settings | None = None, *, auth_transport: httpx.BaseTransport | None = None,
    reports_transport: httpx.AsyncBaseTransport | None = None,
    residents_transport: httpx.AsyncBaseTransport | None = None, media_services: MediaServices | None = None,
    map_transport: httpx.AsyncBaseTransport | None = None,
    workflow_transport: httpx.AsyncBaseTransport | None = None,
    navigation_settings: NavigationSettings | None = None,
    navigation_transport: httpx.AsyncBaseTransport | None = None,
    obstacles_transport: httpx.AsyncBaseTransport | None = None,  # Legacy injection; no longer used.
    community_transport: httpx.AsyncBaseTransport | None = None,
    accessibility_network: VerifiedNetwork | None = None,
    registration_service: RegistrationService | None = None,
) -> FastAPI:

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        try:
            configured = settings if settings is not None else load_settings()
        except ConfigurationError:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_KEY in the root .env.") from None
        verifier = TokenVerifier(configured, transport=auth_transport)
        repository = ReportsRepository(configured, transport=reports_transport)
        residents = ResidentAccessRepository(configured, transport=residents_transport)
        application.state.verifier = verifier
        application.state.reports = repository
        application.state.residents = residents
        application.state.community_issues = CommunityIssues(configured,transport=community_transport if community_transport is not None else map_transport)
        application.state.report_workflow = ReportWorkflow(configured, transport=workflow_transport)
        routing_provider = ValhallaProvider(navigation_settings or NavigationSettings(), transport=navigation_transport)
        application.state.accessibility = accessibility_network or VerifiedNetwork()
        application.state.navigation = NavigationService(routing_provider,application.state.community_issues,application.state.accessibility)
        application.state.media = media_services if media_services is not None else MediaServices(configured)
        application.state.registration = registration_service
        if registration_service is None and settings is None:
            try:
                application.state.registration = RegistrationService(load_registration_settings(configured))
            except ConfigurationError:
                # Existing health/report/auth routes do not depend on optional signup settings.
                application.state.registration = None
        try:
            yield
        finally:
            verifier.close()
            await repository.close()
            await residents.close()
            await application.state.community_issues.close()
            await application.state.report_workflow.close()
            await routing_provider.close()
            if application.state.registration is not None:
                application.state.registration.close()

    application = FastAPI(
            title="Enclave Backend API",
            version="0.4.0",
            lifespan=lifespan,
        )
    
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application = FastAPI(
        title="Enclave Backend API", version="0.4.0", lifespan=lifespan,
        description="Supabase JWT authentication, resident OTP registration, active-resident report access, and S3/AI submission.",
    )
    application.include_router(registration_router)

    @application.exception_handler(RegistrationRejected)
    async def registration_rejected(request, error):
        return JSONResponse(status_code=error.status, content={"detail": error.message},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(RegistrationUnavailable)
    async def registration_unavailable(request, error):
        return JSONResponse(status_code=503, content={"detail": "Registration service unavailable"},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(RequestValidationError)
    async def sanitized_registration_validation(request, error):
        if request.url.path.startswith(("/api/v1/registration/", "/api/v1/management/", "/api/v1/navigation/", "/api/v1/community/", "/api/v1/facilities")) or request.url.path == "/api/send-verification-email":
            # FastAPI's default validation output includes input values, including passwords/OTPs.
            details = [{"loc": e["loc"], "type": e["type"], "msg": "Invalid request field"} for e in error.errors()]
            return JSONResponse(status_code=422, content={"detail": details}, headers={"Cache-Control": "no-store"})
        return await request_validation_exception_handler(request, error)

    @application.exception_handler(ReportsUnavailable)
    async def unavailable_handler(request, error):
        return JSONResponse(status_code=503, content={"detail": "Reports service unavailable"})

    @application.exception_handler(ReportAccessDenied)
    async def denied_handler(request, error):
        return JSONResponse(status_code=403, content={"detail": "Report access denied by database policy"})

    @application.exception_handler(WorkflowUnavailable)
    async def workflow_unavailable(request, error):
        return JSONResponse(status_code=503, content={"detail": "Report workflow unavailable; confirm SQL 007 is installed"},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(WorkflowRejected)
    async def workflow_rejected(request, error):
        return JSONResponse(status_code=error.status, content={"detail": error.message},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(NavigationUnavailable)
    async def navigation_unavailable(request, error):
        return JSONResponse(status_code=503, content={"detail": "Walking directions unavailable; confirm the routing engine and KL East data are ready"},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(IssueUnavailable)
    async def issue_unavailable(request,error):
        return JSONResponse(status_code=503,content={"detail":"Community issue service unavailable; confirm SQL 009 is installed"},
                            headers={"Cache-Control":"no-store"})

    @application.exception_handler(IssueRejected)
    async def issue_rejected(request,error):
        return JSONResponse(status_code=error.status,content={"detail":error.message},headers={"Cache-Control":"no-store"})

    @application.exception_handler(NavigationRejected)
    async def navigation_rejected(request, error):
        return JSONResponse(status_code=error.status, content={"detail": error.message},
                            headers={"Cache-Control": "no-store"})

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

    errors = {
        401: {"description": "Invalid credentials."},
        403: {"description": "Active residency or a database policy denied access."},
        503: {"description": "Authentication, resident directory, or cloud service unavailable."},
    }

    @application.post("/api/v1/reports", response_model=ReportCreatedResponse, status_code=201,
                      tags=["Reports"], description="Requires an active, verified resident binding. The report owner is assigned from the Supabase access token.",
                      responses={**errors, 413: {"description": "Photo exceeds 10 MiB."},
                                                   415: {"description": "Unsupported photo type."}})
    async def submit_report(
        request: Request, user: AuthenticatedUser = Depends(active_resident),
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

    @application.get("/api/v1/reports", response_model=ReportListResponse, tags=["Reports"],
                     description="Requires an active, verified resident binding and returns only that resident's reports.",
                     responses=errors)
    async def my_reports(
        request: Request, user: AuthenticatedUser = Depends(active_resident),
        limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0),
    ):
        records = await request.app.state.reports.list_for_owner(user.access_token, user.user_id, limit=limit, offset=offset)
        return ReportListResponse(items=records, limit=limit, offset=offset)

    @application.get("/api/v1/reports/{ticket_id}", response_model=ReportResponse, tags=["Reports"],
                     description="Requires an active, verified resident binding and returns only that resident's report.",
                     responses={**errors, 404: {"description": "Unknown or inaccessible report."}})
    async def report_detail(
        request: Request, ticket_id: Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")],
        user: AuthenticatedUser = Depends(active_resident),
    ):
        record = await request.app.state.reports.get_for_owner(user.access_token, user.user_id, ticket_id)
        if record is None:
            raise HTTPException(404, "Report not found")
        return record

    def community_bounds(bbox):
        try: return MapBounds.parse(bbox)
        except (ValueError,OverflowError): raise HTTPException(422,"Invalid bounding box") from None

    @application.post("/api/v1/facilities",response_model=Facility,status_code=201,tags=["Community Issues"],responses=errors,
                      description="Create an explicit facility point; reuse existing facilities instead of guessing groups by proximity. Requires SQL 009.")
    async def add_facility(request: Request,response: Response,body: FacilityCreate,user: AuthenticatedUser=Depends(active_resident)):
        response.headers["Cache-Control"]="private, no-store"
        return await request.app.state.community_issues.create_facility(user.user_id,body)

    @application.get("/api/v1/facilities",response_model=FacilityList,tags=["Community Issues"],responses=errors)
    async def facilities(request: Request,response: Response,user: AuthenticatedUser=Depends(active_resident),
        bbox: str | None=Query(default=None,max_length=100),limit: int=Query(default=100,ge=1,le=200),offset: int=Query(default=0,ge=0)):
        response.headers["Cache-Control"]="private, no-store"
        return await request.app.state.community_issues.listing(user.user_id,"facilities",bounds=community_bounds(bbox),limit=limit,offset=offset)

    @application.get("/api/v1/community/issues",response_model=IssueList,tags=["Community Issues"],responses=errors,
                     description="Discover open incident points including those with only one reporter, so another resident can select the same issue. No private evidence/identities.")
    async def issue_choices(request: Request,response: Response,user: AuthenticatedUser=Depends(active_resident),
        bbox: str | None=Query(default=None,max_length=100),limit: int=Query(default=100,ge=1,le=200),offset: int=Query(default=0,ge=0)):
        response.headers["Cache-Control"]="private, no-store"
        return await request.app.state.community_issues.listing(user.user_id,"issues",bounds=community_bounds(bbox),limit=limit,offset=offset)

    @application.post("/api/v1/community/issues",response_model=IssueLinked,tags=["Community Issues"],responses=errors,
                      description="Open/reuse an incident at the selected facility using an existing owned report ticket. One resident counts once; report must be within 100m of the facility. Requires SQL 009.")
    async def open_issue(request: Request,response: Response,body: OpenIssue,user: AuthenticatedUser=Depends(active_resident)):
        response.headers["Cache-Control"]="private, no-store"
        return await request.app.state.community_issues.link(user.user_id,body)

    @application.post("/api/v1/community/issues/{issue_id}/reports",response_model=IssueLinked,tags=["Community Issues"],responses=errors,
                      description="Report the exact same incident using your own report ticket. Repeated submissions count once; repaired incidents need fresh evidence/new incident.")
    async def join_issue(request: Request,response: Response,issue_id: UUID,body: JoinIssue,user: AuthenticatedUser=Depends(active_resident)):
        response.headers["Cache-Control"]="private, no-store"
        return await request.app.state.community_issues.link(user.user_id,body,issue_id)

    @application.get(
        "/api/v1/map/issues", response_model=IssueMapResponse, tags=["Community Map"],
        description="One point per incident reported by at least two distinct verified residents. Independent of maintenance approval. Requires SQL 009; excludes private evidence and identities.",
        responses={401: {"description": "Invalid credentials."},
                   403: {"description": "Active verified residency required."},
                   503: {"description": "Community map or residency service unavailable."}},
    )
    async def community_issues(
        request: Request, response: Response, user: AuthenticatedUser = Depends(active_resident),
        bbox: str | None = Query(default=None, max_length=100,
                                description="west,south,east,north in longitude/latitude degrees; no antimeridian crossing."),
        include_resolved: bool = Query(default=False, description="Include resolved community incidents as historical points (threshold still required)."),
        limit: int = Query(default=100, ge=1, le=200), offset: int = Query(default=0, ge=0),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        try:
            bounds = MapBounds.parse(bbox)
        except (ValueError, OverflowError):
            raise HTTPException(422, "bbox must be west,south,east,north within valid longitude/latitude ranges") from None
        return await request.app.state.community_issues.listing(user.user_id,"map",
            bounds=bounds, limit=limit, offset=offset, include_resolved=include_resolved)

    workflow_errors = {401: {"description": "Invalid credentials."},
                       403: {"description": "Management role or active verified residency required."},
                       404: {"description": "Unknown or inaccessible report."},
                       409: {"description": "Stale status; refresh before retrying."},
                       503: {"description": "Report workflow unavailable; confirm SQL 007 is installed."}}

    @application.get("/api/v1/management/reports", response_model=ManagementReportList,
                     tags=["Management Reports"], responses=workflow_errors,
                     description="Management accounts only. Role is checked in the database, without requiring a resident binding.")
    async def management_reports(
        request: Request, response: Response, user: AuthenticatedUser = Depends(current_user),
        status: ReportStatus | None = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        return await request.app.state.report_workflow.list_reports(user.user_id, status=status, limit=limit, offset=offset)

    @application.patch("/api/v1/management/reports/{ticket_id}/status", response_model=StatusUpdated,
                       tags=["Management Reports"], responses=workflow_errors,
                       description="Management only. Updates status and audit history atomically. Notes are visible to the report owner. Resolution requires repair_verified=true.")
    async def update_report_status(
        request: Request, response: Response, body: StatusUpdate,
        ticket_id: Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")],
        user: AuthenticatedUser = Depends(current_user),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        return await request.app.state.report_workflow.update(user.user_id, ticket_id, body)

    @application.get("/api/v1/reports/{ticket_id}/history", response_model=ReportHistory,
                     response_model_exclude_none=True, tags=["Reports"], responses=workflow_errors,
                     description="Management can view any report. Active verified residents can view their own report only. Staff UUIDs are hidden from residents. Old reports may have no history before SQL 007.")
    async def report_history(
        request: Request, response: Response,
        ticket_id: Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")],
        user: AuthenticatedUser = Depends(current_user),
        limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        return await request.app.state.report_workflow.history(user.user_id, ticket_id, limit=limit, offset=offset)

    @application.get("/api/v1/navigation/obstacles",response_model=CommunityObstacleSnapshot,tags=["Navigation"],responses=errors,
                     description="Open road-facility incidents reported by at least two distinct verified residents; maintenance approval is irrelevant. Requires SQL 009.")
    async def navigation_obstacles(request: Request,response: Response,user: AuthenticatedUser=Depends(active_resident)):
        response.headers["Cache-Control"]="private, no-store"
        return await request.app.state.community_issues.active(user.user_id)

    @application.get("/api/v1/navigation/area", response_model=NavigationArea, tags=["Navigation"],
                     responses=errors, description="Development window for the KL East walking pilot; not an official township boundary or field-verified access map.")
    async def navigation_area(request: Request, response: Response, user: AuthenticatedUser = Depends(active_resident)):
        response.headers["Cache-Control"] = "private, no-store"
        return NavigationArea(bbox=PILOT_BBOX, center=MAP_CENTER,**request.app.state.accessibility.coverage())

    @application.post("/api/v1/navigation/routes", response_model=RouteResponse, tags=["Navigation"],
                      description="Select route_mode: shortest ignores damage; avoid_damage avoids two-resident road-facility issues; accessible uses only surveyed step-free connections and also avoids damage. SQL 009 is required for damage modes. No fallback to ordinary walking for accessible mode.",
                      responses={**errors, 409: {"description": "Origin or destination is inside a community-reported damaged area."},
                                 422: {"description": "Invalid location, unsupported profile, outside pilot window, or no walking route."}})
    async def walking_directions(request: Request, response: Response, body: WalkingRouteRequest,
                                 user: AuthenticatedUser = Depends(active_resident)):
        response.headers["Cache-Control"] = "private, no-store"
        return await request.app.state.navigation.route(body,user.user_id)

    return application


app = create_app()
