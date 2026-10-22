"""Authenticated Enclave cloud reports, preserving the S3 and AI submission pipeline."""

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import logging
import time
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
from .accounts.profile import AccountProfileRepository
from .activity_logs import ActivityLogsRepository, create_router as activity_logs_router
from .accounts.routes import create_router as account_router
from .core.config import ConfigurationError, Settings, load_settings
from .reports.media import MediaServices, MediaUnavailable
from .reports.models import AIAnalysis, CurrentUserResponse, ReportCreatedResponse, ReportListResponse, ReportResponse
from .reports.repository import ReportAccessDenied, ReportsRepository, ReportsUnavailable
from .reports.moderation import (ReportWorkflow, ReportStatus, StatusUpdate, StatusUpdated,
                                 ManagementReportList, ReportHistory, WorkflowUnavailable, WorkflowRejected)
from .reports.map import MapBounds
from .navigation.config import NavigationSettings, PILOT_BBOX, MAP_CENTER
from .navigation.contracts import NavigationArea, WalkingRouteRequest, RouteResponse
from .navigation.areas import ServiceAreas, DemoAreaDataset, service_areas, find_area, demo_area_dataset
from .navigation.provider import ValhallaProvider, NavigationRejected, NavigationUnavailable
from .navigation.demo_routes import DemoRouteRequest, DemoRouteResponse, calculate_demo_routes
from .navigation.roadside import walking_graph
from .navigation.places import PlacesRepository, PlacesUnavailable, PlaceSearchResult
from .navigation.locations import LocationsRepository, LocationsUnavailable, LocationsNotInstalled, LocationResult
from .navigation.location_names import LocationName, LocationNamesUnavailable, MapLocationNamesRepository
from .navigation.service import NavigationService
from .reports.issues import (CommunityIssues,FacilityCreate,Facility,FacilityList,OpenIssue,JoinIssue,
                             IssueLinked,IssueList,IssueMapResponse,CommunityObstacleSnapshot,IssueUnavailable,IssueRejected)
from .navigation.accessibility import VerifiedNetwork
from .what_if.contracts import CompareRequest, CompareResponse, RepairCandidates
from .what_if.repository import WhatIfRepository, WhatIfRejected, WhatIfUnavailable
from .what_if.service import WhatIfService
from .what_if.summary import SummaryRequest, RepairSummary, RepairSummaryService, SummaryNarrator
from .notifications.models import NotificationCreate, NotificationListResponse, NotificationResponse
from .notifications.repository import NotificationAccessDenied, NotificationsRepository, NotificationsUnavailable
from .registration.residents import ResidentAccessRepository, ResidentDirectoryUnavailable
from .registration import RegistrationRejected, RegistrationService
from .registration.clients import RegistrationUnavailable
from .registration.settings import load_registration_settings
from .routers.email import router as registration_router
from .maintenance.repository import MaintenanceRepository, MaintenanceRejected, MaintenanceUnavailable
from .maintenance.routes import create_router as maintenance_router
from fastapi.middleware.cors import CORSMiddleware


MAX_PHOTO_BYTES = 10 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png"}
bearer = HTTPBearer(scheme_name="SupabaseAccessToken", auto_error=False,
                    description="Paste the Supabase Auth access_token, without the Bearer prefix.")
route_logger = logging.getLogger('uvicorn.error')


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
    account_transport: httpx.AsyncBaseTransport | None = None,
    activity_logs_transport: httpx.AsyncBaseTransport | None = None,
    map_transport: httpx.AsyncBaseTransport | None = None,
    workflow_transport: httpx.AsyncBaseTransport | None = None,
    navigation_settings: NavigationSettings | None = None,
    navigation_transport: httpx.AsyncBaseTransport | None = None,
    obstacles_transport: httpx.AsyncBaseTransport | None = None,  # Legacy injection; no longer used.
    community_transport: httpx.AsyncBaseTransport | None = None,
    accessibility_network: VerifiedNetwork | None = None,
    what_if_transport: httpx.AsyncBaseTransport | None = None,
    registration_service: RegistrationService | None = None,
    places_transport: httpx.AsyncBaseTransport | None = None,
    map_location_names_transport: httpx.AsyncBaseTransport | None = None,
    maintenance_transport: httpx.AsyncBaseTransport | None = None,
    locations_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        try:
            configured = settings if settings is not None else load_settings()
        except ConfigurationError:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_KEY in the root .env.") from None
        verifier = TokenVerifier(configured, transport=auth_transport)
        repository = ReportsRepository(configured, transport=reports_transport)
        application.state.account_profiles = AccountProfileRepository(configured, transport=account_transport)
        application.state.activity_logs = ActivityLogsRepository(configured, transport=activity_logs_transport)
        residents = ResidentAccessRepository(configured, transport=residents_transport)
        notifications = NotificationsRepository(configured)
        application.state.verifier = verifier
        application.state.reports = repository
        application.state.residents = residents
        application.state.community_issues = CommunityIssues(configured,transport=community_transport if community_transport is not None else map_transport)
        application.state.notifications = notifications
        application.state.places = PlacesRepository(configured, transport=places_transport)
        application.state.locations = LocationsRepository(configured, transport=locations_transport)
        application.state.community_issues.locations = application.state.locations
        application.state.map_location_names = MapLocationNamesRepository(configured, transport=map_location_names_transport)
        application.state.report_workflow = ReportWorkflow(configured, transport=workflow_transport)
        application.state.maintenance = MaintenanceRepository(configured, transport=maintenance_transport)
        routing_provider = ValhallaProvider(navigation_settings or NavigationSettings(), transport=navigation_transport)
        application.state.accessibility = accessibility_network or VerifiedNetwork()
        application.state.navigation = NavigationService(routing_provider,application.state.community_issues,application.state.accessibility)
        application.state.what_if_repository = WhatIfRepository(configured, transport=what_if_transport)
        application.state.what_if = WhatIfService(application.state.what_if_repository, application.state.navigation)
        application.state.what_if_summaries = RepairSummaryService(application.state.what_if_repository, SummaryNarrator(configured.service_values))
        application.state.media = media_services if media_services is not None else MediaServices(configured)
        application.state.report_photo_links = MediaServices(configured)
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
            await application.state.account_profiles.close()
            await application.state.activity_logs.close()
            await residents.close()
            await application.state.community_issues.close()
            await notifications.close()
            await application.state.places.close()
            await application.state.locations.close()
            await application.state.map_location_names.close()
            await application.state.report_workflow.close()
            await application.state.maintenance.close()
            await routing_provider.close()
            await application.state.what_if_summaries.close()
            await application.state.what_if_repository.close()
            if application.state.registration is not None:
                application.state.registration.close()

    application = FastAPI(
        title="Enclave Backend API", version="0.4.0", lifespan=lifespan,
        description="Supabase JWT authentication, resident OTP registration, active-resident report access, and S3/AI submission.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "https://enclavehomes.app",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @application.middleware('http')
    async def trace_demo_route(request, call_next):
        demo = request.url.path.startswith('/api/v1/navigation/areas/') and request.url.path.endswith('/demo-routes')
        comparison = request.url.path == '/api/v1/management/what-if/compare'
        if request.method != 'POST' or not (demo or comparison):
            return await call_next(request)
        event = 'enclave_compare' if comparison else 'enclave_route'
        trace = uuid4().hex
        request.state.demo_route_trace = trace
        started = time.monotonic()
        # No request body, coordinates, credentials, or exception text in logs.
        route_logger.info('%s received trace=%s', event, trace)
        try:
            response = await call_next(request)
        except Exception as error:
            route_logger.error('%s failed trace=%s elapsed_ms=%d error_type=%s',
                event, trace, (time.monotonic()-started)*1000, type(error).__name__)
            raise
        route_logger.info('%s response trace=%s status=%d elapsed_ms=%d',
            event, trace, response.status_code, (time.monotonic()-started)*1000)
        return response

    application.include_router(registration_router)
    application.include_router(account_router(current_user))
    application.include_router(maintenance_router(current_user))
    application.include_router(activity_logs_router(current_user))

    @application.exception_handler(MaintenanceUnavailable)
    async def maintenance_unavailable(request, error):
        return JSONResponse(status_code=503, content={'detail': 'Maintenance service unavailable; confirm SQL 017 is installed'},
                            headers={'Cache-Control': 'no-store'})

    @application.exception_handler(MaintenanceRejected)
    async def maintenance_rejected(request, error):
        return JSONResponse(status_code=error.status, content={'detail': error.message}, headers={'Cache-Control': 'no-store'})

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
        if request.url.path.startswith(("/api/v1/registration/", "/api/v1/account/", "/api/v1/management/", "/api/v1/maintenance/", "/api/v1/navigation/", "/api/v1/community/", "/api/v1/facilities")) or request.url.path == "/api/send-verification-email":
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

    @application.exception_handler(MediaUnavailable)
    async def photo_unavailable_handler(request, error):
        return JSONResponse(status_code=503, content={"detail": "Report photo access unavailable"},
                            headers={"Cache-Control": "no-store"})

    async def with_report_photo(request, record):
        # Call only after the owner/management report query has authorized access.
        image_url = await run_in_threadpool(
            request.app.state.report_photo_links.signed_image_url, record.image_url)
        return record.model_copy(update={"image_url": image_url})

    @application.exception_handler(NotificationsUnavailable)
    async def notifications_unavailable_handler(request, error):
        return JSONResponse(status_code=503, content={"detail": "Notifications service unavailable"})

    @application.exception_handler(NotificationAccessDenied)
    async def notifications_denied_handler(request, error):
        return JSONResponse(status_code=403, content={"detail": "Notification access denied by database policy"})

    @application.exception_handler(WorkflowUnavailable)
    async def workflow_unavailable(request, error):
        return JSONResponse(status_code=503, content={"detail": "Report workflow unavailable; confirm SQL 007 is installed"},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(WorkflowRejected)
    async def workflow_rejected(request, error):
        return JSONResponse(status_code=error.status, content={"detail": error.message},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(WhatIfUnavailable)
    async def what_if_unavailable(request, error):
        if error.reason == 'timeout':
            return JSONResponse(status_code=504, content={"detail": "Repair comparison timed out while calculating routes. Please retry."},
                                headers={"Cache-Control": "no-store"})
        detail = ("Repair comparison routing is unavailable; check the routing service."
                  if error.reason == 'routing' else
                  "Repair comparison unavailable; check the database snapshot and routing service.")
        return JSONResponse(status_code=503, content={"detail": detail},
                            headers={"Cache-Control": "no-store"})

    @application.exception_handler(WhatIfRejected)
    async def what_if_rejected(request, error):
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
    def health(response: Response) -> dict[str, str]:
        response.headers['X-Enclave-Routing-Revision']='demo-crossings-v1'
        return {"status": "ok"}

    @application.get('/health/routing', tags=['Health'])
    def routing_revision() -> dict[str, str]:
        return {'routing_revision':'demo-crossings-v1'}

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
        location_id: UUID | None = Form(default=None),
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
        if location_id is not None: row["location_id"]=str(location_id)
        record = await request.app.state.reports.create(row, user.access_token, user.user_id)
        record = (await request.app.state.locations.labels([record]))[0]
        return ReportCreatedResponse(ticket_id=ticket_id, ai_analysis=analysis, image_url=image_url, data=[record])

    @application.get("/api/v1/reports", response_model=ReportListResponse, tags=["Reports"],
                     description="Requires an active, verified resident binding and returns only that resident's reports.",
                     responses=errors)
    async def my_reports(
        request: Request, user: AuthenticatedUser = Depends(active_resident),
        limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0),
    ):
        records = await request.app.state.reports.list_for_owner(user.access_token, user.user_id, limit=limit, offset=offset)
        records = await request.app.state.locations.labels(records)
        records = [await with_report_photo(request, record) for record in records]
        return ReportListResponse(items=records, limit=limit, offset=offset)

    @application.get("/api/v1/notifications", response_model=NotificationListResponse,
                     tags=["Notifications"], responses=errors,
                     description="Published management broadcasts for the authenticated resident.")
    async def resident_notifications(
        request: Request, user: AuthenticatedUser = Depends(active_resident),
        limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
    ):
        items = await request.app.state.notifications.list_for_user(
            user.access_token, user.user_id, limit=limit, offset=offset)
        return NotificationListResponse(items=items, limit=limit, offset=offset)

    @application.post("/api/v1/management/notifications", response_model=NotificationResponse,
                      status_code=201, tags=["Management Notifications"],
                      responses={401: {"description": "Invalid credentials."},
                                 403: {"description": "Management role required."},
                                 503: {"description": "Notifications service unavailable."}})
    async def create_management_notification(
        request: Request, body: NotificationCreate,
        user: AuthenticatedUser = Depends(current_user),
    ):
        return await request.app.state.notifications.create_broadcast(
            user.access_token, user.user_id, body)

    @application.post("/api/v1/notifications/{notification_id}/read", status_code=204,
                      tags=["Notifications"], responses=errors)
    async def mark_notification_read(
        request: Request, notification_id: Annotated[int, Path(gt=0)],
        user: AuthenticatedUser = Depends(active_resident),
    ):
        await request.app.state.notifications.mark_read(
            user.access_token, user.user_id, notification_id)
        return Response(status_code=204)

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
        record = (await request.app.state.locations.labels([record]))[0]
        return await with_report_photo(request, record)

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

    @application.get("/api/v1/facilities/road-sections",response_model=FacilityList,tags=["Community Issues"],responses=errors,
                     description="Nearby fixed OSM road-section report points, approximately 100m per section. Read-only catalog; independent of route access or accessibility verification.")
    async def road_report_points(request: Request,response: Response,user: AuthenticatedUser=Depends(active_resident),
        latitude: float=Query(ge=-90,le=90,allow_inf_nan=False),longitude: float=Query(ge=-180,le=180,allow_inf_nan=False),
        limit: int=Query(default=100,ge=1,le=200),offset: int=Query(default=0,ge=0)):
        from .reports.road_sections import nearby
        from .reports.map import MapPagination
        response.headers["Cache-Control"]="private, no-store"
        try:
            area=next((a for a in service_areas().items if a.enabled and a.community_issues_supported and a.bbox[0]<=longitude<=a.bbox[2] and a.bbox[1]<=latitude<=a.bbox[3]),None)
            if area is not None:
                try:
                    page=await request.app.state.locations.listing('road_sections',user.user_id,area,latitude=latitude,longitude=longitude,limit=limit,offset=offset)
                    selected=[Facility(id=p.id,name=p.name,facility_type='path_surface',latitude=p.latitude,longitude=p.longitude,created_at=p.metadata['created_at'],road_section=p.metadata.get('road_section')) for p in page.items]
                    response.headers['X-Enclave-Location-Storage']='database'
                    return FacilityList(items=selected,pagination=MapPagination(limit=limit,offset=offset,returned=len(selected),has_more=page.has_more))
                except LocationsNotInstalled:
                    pass
            response.headers['X-Enclave-Location-Storage']='bundled_catalog'
            rows=nearby(latitude,longitude);selected=rows[offset:offset+limit]
            return FacilityList(items=[Facility.model_validate(point.model_dump()) for point in selected],
                pagination=MapPagination(limit=limit,offset=offset,returned=len(selected),has_more=offset+limit<len(rows)))
        except (ValueError,OSError,KeyError,TypeError):
            raise HTTPException(503,"Road reporting points are unavailable") from None

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
        result = await request.app.state.report_workflow.list_reports(user.user_id, status=status, limit=limit, offset=offset)
        result.items = await request.app.state.locations.labels(result.items)
        result.items = [await with_report_photo(request, record) for record in result.items]
        return result

    @application.patch("/api/v1/management/reports/{ticket_id}/status", response_model=StatusUpdated,
                       tags=["Management Reports"], responses=workflow_errors,
                       description="Management only. Updates status and audit history atomically. Notes are visible to the report owner. Resolution requires repair_verified=true.")
    async def update_report_status(
        request: Request, response: Response, body: StatusUpdate,
        ticket_id: Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")],
        user: AuthenticatedUser = Depends(current_user),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        result = await request.app.state.report_workflow.update(user.user_id, ticket_id, body)
        result.report = (await request.app.state.locations.labels([result.report]))[0]
        result.report = await with_report_photo(request, result.report)
        return result

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

    @application.get("/api/v1/navigation/areas", response_model=ServiceAreas, tags=["Navigation"],
                     responses=errors, description="Server-owned service-area catalog. Registered coverage and available route/demo graphs are reported separately.")
    async def navigation_areas(response: Response, user: AuthenticatedUser = Depends(active_resident)):
        response.headers["Cache-Control"] = "private, no-store"
        return service_areas()

    @application.exception_handler(LocationsUnavailable)
    async def locations_unavailable(request, error):
        return JSONResponse(status_code=503,content={'detail':'Shared locations unavailable; confirm SQL 020 and 021 are installed'},headers={'Cache-Control':'no-store'})

    @application.get('/api/v1/locations',response_model=LocationResult,tags=['Locations'])
    async def shared_locations(request: Request,response: Response,user: AuthenticatedUser=Depends(current_user),
        area_id: str=Query(max_length=64),q: str | None=Query(default=None,min_length=2,max_length=160),
        latitude: float | None=Query(default=None,ge=-90,le=90,allow_inf_nan=False),
        longitude: float | None=Query(default=None,ge=-180,le=180,allow_inf_nan=False),
        limit: int=Query(default=20,ge=1,le=100),offset: int=Query(default=0,ge=0,le=100000)):
        response.headers['Cache-Control']='private, no-store'
        area=find_area(area_id)
        if area is None: raise HTTPException(404,'Service area not found')
        if q is None and (latitude is None or longitude is None): raise HTTPException(422,'Provide a place name or map coordinates')
        return await request.app.state.locations.listing('search' if q is not None else 'nearby',user.user_id,area,
            query=q,latitude=latitude,longitude=longitude,limit=limit,offset=offset)

    @application.get("/api/v1/navigation/areas/{area_id}/places", response_model=PlaceSearchResult, tags=["Navigation"],
                     responses={**errors, 404: {"description": "Service area not found"}},
                     description="Search stored OpenStreetMap names and addresses within the selected service area.")
    async def navigation_places(request: Request, response: Response,
            area_id: str = Path(pattern=r'^[a-z][a-z0-9-]{1,63}$'),
            q: str = Query(min_length=2, max_length=160), user: AuthenticatedUser = Depends(active_resident)):
        response.headers['Cache-Control'] = 'private, no-store'
        area = find_area(area_id)
        if area is None:
            raise HTTPException(404, 'Service area not found')
        if len(q.strip()) < 2:
            raise HTTPException(422, 'Enter at least two characters of an address or place name')
        try:
            return await request.app.state.places.search(user.access_token, area, q.strip())
        except PlacesUnavailable:
            raise HTTPException(503, 'Place search is unavailable. Retry or choose a point on the map.') from None

    @application.get("/api/v1/navigation/areas/{area_id}/demo", response_model=DemoAreaDataset, tags=["Navigation"],
                     responses={**errors, 404: {"description": "Service area not found"}},
                     description="Read-only OSM road graph and real landmarks for the selected resident demo. Facility/access annotations, where present, are simulated.")
    async def navigation_area_demo(response: Response,
            area_id: str = Path(pattern=r'^[a-z][a-z0-9-]{1,63}$'), user: AuthenticatedUser = Depends(active_resident)):
        response.headers["Cache-Control"] = "private, no-store"
        area = find_area(area_id)
        if area is None:
            raise HTTPException(404, "Service area not found")
        try:
            return demo_area_dataset(area.id)
        except (OSError, ValueError):
            raise HTTPException(503, "Resident demo dataset unavailable for this service area") from None

    @application.post("/api/v1/navigation/areas/{area_id}/demo-routes", response_model=DemoRouteResponse,
                      tags=["Navigation"], responses={**errors, 404: {"description": "Resident demo service area not found"},
                          422: {"description": "Invalid endpoints or no route satisfies mapped crossing rules."},
                          503: {"description": "Demo routing graph unavailable."}},
                      description="Authenticated resident demo routing on the server-owned OSM roadside graph. Facility damage and step-free annotations are simulated; routes are not field verified.")
    async def navigation_demo_routes(request: Request, response: Response, body: DemoRouteRequest,
            area_id: str = Path(pattern=r'^[a-z][a-z0-9-]{1,63}$'), user: AuthenticatedUser = Depends(active_resident)):
        response.headers["Cache-Control"] = "private, no-store"
        area = find_area(area_id)
        if area is None or not area.resident_demo_supported or not area.routing_supported:
            raise HTTPException(404, "Resident demo routes are not available for this service area")
        trace = request.state.demo_route_trace
        route_logger.info('enclave_route authenticated trace=%s area=%s', trace, area.id)
        def calculate():
            # Cold graph construction is CPU-heavy too; keep it off the event loop.
            started = time.monotonic()
            dataset = demo_area_dataset(area.id).dataset
            route_logger.info('enclave_route dataset_ready trace=%s elapsed_ms=%d',
                trace, (time.monotonic()-started)*1000)
            started = time.monotonic()
            graph = walking_graph(area.id)
            route_logger.info('enclave_route graph_ready trace=%s elapsed_ms=%d',
                trace, (time.monotonic()-started)*1000)
            started = time.monotonic()
            result = calculate_demo_routes(area.id, area.bbox, body, dataset, graph)
            route_logger.info('enclave_route calculated trace=%s elapsed_ms=%d',
                trace, (time.monotonic()-started)*1000)
            return result

        try:
            return await run_in_threadpool(calculate)
        except NavigationRejected as failure:
            raise HTTPException(failure.status, failure.message) from None
        except (OSError, ValueError):
            raise HTTPException(503, "Resident demo routing data unavailable") from None

    @application.get("/api/v1/navigation/area", response_model=NavigationArea, tags=["Navigation"],
                     responses=errors, description="Selected live service-area coverage; defaults to KL East for compatibility. Service rectangles are not official boundaries or field-verified access maps.")
    async def navigation_area(request: Request, response: Response,
            area_id: str | None = Query(default=None, pattern=r'^[a-z][a-z0-9-]{1,63}$'),
            user: AuthenticatedUser = Depends(active_resident)):
        response.headers["Cache-Control"] = "private, no-store"
        area = find_area(area_id or 'kl-east-pilot')
        if area is None or not area.routing_supported:
            raise HTTPException(404, "Live service area not found")
        if area.temporary_live:
            return NavigationArea(id=area.id, name=area.name, bbox=area.bbox, center=area.center,
                supported_route_modes=['shortest'], temporary_live=True,
                community_issues_supported=area.community_issues_supported, crossing_policy=area.crossing_policy)
        return NavigationArea(bbox=PILOT_BBOX, center=MAP_CENTER,crossing_policy=area.crossing_policy,**request.app.state.accessibility.coverage())

    @application.post("/api/v1/navigation/routes", response_model=RouteResponse, tags=["Navigation"],
                      description="Select route_mode: shortest ignores damage; avoid_damage avoids two-resident road-facility issues; accessible uses only surveyed step-free connections and also avoids damage. SQL 009 is required for damage modes. No fallback to ordinary walking for accessible mode.",
                      responses={**errors, 409: {"description": "Origin or destination is inside a community-reported damaged area."},
                                 422: {"description": "Invalid location, unsupported profile, outside pilot window, or no walking route."}})
    async def walking_directions(request: Request, response: Response, body: WalkingRouteRequest,
                                 user: AuthenticatedUser = Depends(active_resident)):
        response.headers["Cache-Control"] = "private, no-store"
        return await request.app.state.navigation.route(body,user.user_id)

    @application.get("/api/v1/management/what-if/candidates", response_model=RepairCandidates,
                     tags=["Management What-if"], responses={401: {"description": "Invalid credentials."},
                         403: {"description": "Management role required."}, 503: {"description": "Snapshot unavailable; confirm SQL 010."}},
                     description="Management only, no resident binding required. Read current two-resident facility issues eligible for hypothetical repair. Does not save or repair anything.")
    async def what_if_candidates(request: Request, response: Response, user: AuthenticatedUser = Depends(current_user)):
        response.headers["Cache-Control"] = "private, no-store"
        return await request.app.state.what_if.candidates(user.user_id)

    @application.get("/api/v1/management/what-if/location-name", response_model=LocationName,
                     tags=["Management What-if"], responses={**errors, 403: {"description": "Management role required"},
                         404: {"description": "Service area not found"},
                         503: {"description": "Map location catalog unavailable"}},
                     description="Read-only lookup of a selected map point against named road sections in the shared OSM location catalog.")
    async def what_if_location_name(request: Request, response: Response,
            area_id: str = Query('kl-east-pilot', pattern=r'^[a-z][a-z0-9-]{1,63}$'),
            latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
            user: AuthenticatedUser = Depends(current_user)):
        response.headers["Cache-Control"] = "private, no-store"
        area = find_area(area_id)
        if area is None:
            raise HTTPException(404, "Service area not found")
        try:
            # Reuse the database-authoritative management check before the
            # service-role read of the public road-name catalog.
            await request.app.state.what_if_repository.snapshot(user.user_id)
            return await request.app.state.map_location_names.resolve(area, latitude, longitude)
        except WhatIfRejected as error:
            raise HTTPException(error.status, error.message) from None
        except WhatIfUnavailable:
            raise HTTPException(503, "Management access or map location catalog unavailable") from None
        except LocationNamesUnavailable:
            raise HTTPException(503, "Map location catalog unavailable") from None

    @application.post("/api/v1/management/what-if/compare", response_model=CompareResponse,
                      tags=["Management What-if"], responses={401: {"description": "Invalid credentials."},
                          403: {"description": "Management role required."}, 409: {"description": "Selected repair candidates changed."},
                          429: {"description": "Another comparison is running."}, 503: {"description": "Snapshot or routing dependency unavailable."}},
                      description="Read-only repair simulation on one snapshot: 1-5 management-defined major paths, 1-3 plans, optional MYR estimates and budget. Affected reference paths and actual restored/shortened paths are distinct metrics. No live report/issue changes and no saved scenarios.")
    async def compare_repairs(request: Request, response: Response, body: CompareRequest,
                              user: AuthenticatedUser = Depends(current_user)):
        response.headers["Cache-Control"] = "private, no-store"
        result = await request.app.state.what_if.compare(user.user_id, body)
        request.app.state.what_if_summaries.remember(user.user_id, result)
        return result

    @application.post("/api/v1/management/what-if/{simulation_id}/summary", response_model=RepairSummary,
                      tags=["Management What-if"], responses={401:{"description":"Invalid credentials."},
                          403:{"description":"Management role required."},404:{"description":"Comparison expired or unavailable."},
                          429:{"description":"Summary generation busy."}},
                      description="Summarize an owned comparison from the last ten minutes. Numeric facts and rankings are calculated; optional AI explains them. AI failure returns a labelled calculated summary. No live changes.")
    async def repair_summary(request: Request, response: Response, simulation_id: UUID, body: SummaryRequest,
                             user: AuthenticatedUser = Depends(current_user)):
        response.headers["Cache-Control"] = "private, no-store"
        return await request.app.state.what_if_summaries.summary(user.user_id,simulation_id,body.route_mode)

    return application


app = create_app()
