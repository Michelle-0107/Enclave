from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import secrets
import sqlite3
from typing import Any, Iterator, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictBool, field_validator, model_validator
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError


DATABASE_PATH = Path(__file__).resolve().with_name("enclave.db")
TOKEN_LIFETIME_SECONDS = 3600
ReportStatus = Literal["pending_review", "approved", "rejected", "in_progress", "resolved"]
# Only these transitions are allowed; rejected/resolved are terminal in this version.
STATUS_TRANSITIONS = {
    "pending_review": {"approved", "rejected"},
    "approved": {"in_progress"},
    "in_progress": {"resolved"},
    "rejected": set(),
    "resolved": set(),
}
password_hasher = PasswordHash.recommended()
# Unknown usernames still perform a password check before returning an error.
DUMMY_PASSWORD_HASH = password_hasher.hash(secrets.token_urlsafe(32))
bearer_auth = HTTPBearer(
    scheme_name="EnclaveToken",
    description="Paste access_token returned by POST /auth/login.",
    auto_error=False,
)


@contextmanager
def database_connection(*, write: bool = False) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DATABASE_PATH, autocommit=True)
    try:
        # SQLite enables foreign keys before beginning a transaction.
        connection.execute("PRAGMA foreign_keys = ON")
        connection.row_factory = sqlite3.Row
        # Reserve the write lock before a workflow reads and changes the status.
        connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        try:
            yield connection
            connection.execute("COMMIT")
        except BaseException:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
    finally:
        connection.close()


def initialize_database() -> None:
    with database_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY NOT NULL,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('resident', 'management')),
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                ticket_id TEXT PRIMARY KEY NOT NULL,
                description TEXT NOT NULL,
                latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
                longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                user_id TEXT REFERENCES users(user_id)
            )
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(reports)")}
        if "user_id" not in columns:
            # Old practice reports retain a NULL owner and are visible to management.
            connection.execute(
                "ALTER TABLE reports ADD COLUMN user_id TEXT REFERENCES users(user_id)"
            )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS reports_owner_created
            ON reports(user_id, created_at DESC, ticket_id DESC)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS report_status_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT NOT NULL REFERENCES reports(ticket_id) ON DELETE CASCADE,
                from_status TEXT,
                to_status TEXT NOT NULL,
                changed_by TEXT NOT NULL REFERENCES users(user_id),
                note TEXT NOT NULL,
                repair_verified INTEGER NOT NULL CHECK (repair_verified IN (0, 1)),
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS report_events_ticket ON report_status_events(ticket_id, event_id)"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="Enclave Backend",
    version="0.2.0",
    description=(
        "Enclave v0.2.0: local authentication, community reports, and management workflows. "
        "Sign up, log in, and paste your access_token into Authorize. "
        "Use SQLite to test report review, maintenance statuses, and history locally. "
        "Supabase, photo uploads, AI assessment, maps, routing, and notifications are planned for later versions."
    ),
    openapi_tags=[
        {"name": "Health", "description": "Check whether the API is responding."},
        {"name": "Authentication", "description": "Sign up, log in, view the current user, and log out."},
        {"name": "Reports", "description": "Submit and read reports. Residents can only read their own reports."},
        {"name": "Management", "description": "Endpoints restricted to management accounts."},
    ],
    lifespan=lifespan,
)


# Synthetic documentation examples; these are not real accounts or tokens.
USER_EXAMPLE = {
    "user_id": "00000000-0000-4000-8000-000000000001",
    "username": "alice",
    "role": "resident",
    "created_at": "2026-10-13T01:00:00Z",
}
REPORT_EXAMPLE = {
    "description": "The street light at the community park entrance is not working",
    "latitude": 3.139,
    "longitude": 101.687,
    "ticket_id": "00000000-0000-4000-8000-000000000011",
    "status": "pending_review",
    "created_at": "2026-10-13T01:00:00Z",
    "user_id": USER_EXAMPLE["user_id"],
}


class LoginRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"examples": [{"username": "alice", "password": "EnclaveTest123!"}]},
    )

    username: str = Field(
        min_length=3, max_length=32, pattern=r"^[a-z0-9_]+$",
        description="After trimming and converting to lowercase, use 3-32 ASCII letters, digits, or underscores.",
    )
    password: SecretStr = Field(
        min_length=1, max_length=128,
        description="Login password: 1-128 characters. Case and whitespace are preserved.",
    )

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class UserCreate(LoginRequest):
    password: SecretStr = Field(
        min_length=12, max_length=128,
        description="Signup password: 12-128 characters. Case and whitespace are preserved.",
    )


class UserResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [USER_EXAMPLE]})

    user_id: str = Field(description="Backend-generated user ID. Store it as a string on the frontend.")
    username: str
    role: Literal["resident", "management"] = Field(description="Role assigned by the backend.")
    created_at: datetime = Field(description="UTC ISO 8601 timestamp with timezone information.")


class TokenResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{
        "access_token": "<access_token_from_login>", "token_type": "bearer", "expires_in": 3600,
    }]})

    access_token: str = Field(description="Opaque token, not a JWT. The example is a placeholder and cannot authenticate requests.")
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(default=TOKEN_LIFETIME_SECONDS, description="Token lifetime in seconds.")


class ReportCreate(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
        json_schema_extra={"examples": [{
            "description": REPORT_EXAMPLE["description"], "latitude": 3.139, "longitude": 101.687,
        }]},
    )

    description: str = Field(
        min_length=1, max_length=1000,
        description="Issue description: 1-1000 characters after trimming leading and trailing whitespace.",
    )
    latitude: float = Field(ge=-90, le=90, description="WGS84 latitude in decimal degrees.")
    longitude: float = Field(ge=-180, le=180, description="WGS84 longitude in decimal degrees.")


class ReportResponse(ReportCreate):
    model_config = ConfigDict(json_schema_extra={"examples": [REPORT_EXAMPLE]})

    ticket_id: str = Field(description="Backend-generated ticket ID. Treat it as an opaque string.")
    status: ReportStatus = Field(
        default="pending_review", description="Review and maintenance status. Only management can change it through the workflow.",
    )
    created_at: datetime = Field(description="UTC ISO 8601 timestamp generated by the backend.")
    user_id: str | None = Field(
        default=None, description="ID of the submitting user. Legacy reports without an owner use null and are visible only to management.",
    )


class ReportListResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{
        "items": [REPORT_EXAMPLE], "total": 1, "limit": 10, "offset": 0,
    }]})

    items: list[ReportResponse] = Field(description="Reports on the current page, ordered from newest to oldest.")
    total: int = Field(description="Total reports visible to the current user that match the status filter, independent of pagination.")
    limit: int = Field(description="Page size requested by the client.")
    offset: int = Field(description="Number of reports skipped for this request.")


class ReportStatusUpdate(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
        json_schema_extra={"examples": [{
            "status": "approved", "note": "The faulty street light has been confirmed and needs repair", "repair_verified": False,
        }, {
            "status": "resolved", "note": "The street light has been repaired and checked on site", "repair_verified": True,
        }]},
    )

    status: Literal["approved", "rejected", "in_progress", "resolved"]
    note: str = Field(min_length=1, max_length=1000, description="Required note explaining the review, maintenance action, or repair verification.")
    repair_verified: StrictBool = Field(
        default=False,
        description="Must be the JSON boolean true for resolved. For other statuses, use false or omit the field.",
    )

    @model_validator(mode="after")
    def check_repair_verification(self):
        if self.status == "resolved" and not self.repair_verified:
            raise ValueError("repair_verified must be true when resolving a report")
        if self.status != "resolved" and self.repair_verified:
            raise ValueError("repair_verified is only allowed when status is resolved")
        return self


class ReportStatusEvent(BaseModel):
    event_id: int = Field(description="Backend-generated history event sequence number.")
    ticket_id: str
    from_status: ReportStatus | None
    to_status: ReportStatus
    changed_by: str = Field(description="ID of the authenticated user performing the action. The request cannot choose this value.")
    note: str
    repair_verified: bool
    created_at: datetime


class ReportHistoryResponse(BaseModel):
    ticket_id: str
    status: ReportStatus = Field(description="Current status of the report.")
    items: list[ReportStatusEvent] = Field(description="Recorded actions in ascending event_id order.")


class HealthResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"status": "ok"}]})

    status: Literal["ok"]


class ErrorResponse(BaseModel):
    detail: str = Field(description="Error message for the frontend to display or handle.")


class ValidationIssue(BaseModel):
    loc: list[str | int] = Field(description="Location of the validation issue, for example ['body', 'latitude'].")
    msg: str = Field(description="Validation message. The frontend should not depend on its exact wording.")
    type: str = Field(description="Validation error type.")
    input: Any = Field(default=None, description="Optional invalid input value.")
    ctx: dict[str, Any] | None = Field(default=None, description="Optional validation context.")


class ValidationErrorResponse(BaseModel):
    detail: list[ValidationIssue]


# These declarations document existing HTTPException / validation responses.
UNAUTHORIZED_RESPONSE = {
    "model": ErrorResponse,
    "description": "Missing, invalid, or expired token, or incorrect login credentials.",
    "headers": {"WWW-Authenticate": {
        "description": "Authentication scheme.", "schema": {"type": "string", "enum": ["Bearer"]},
    }},
    "content": {"application/json": {"example": {"detail": "Invalid or expired credentials"}}},
}
FORBIDDEN_RESPONSE = {
    "model": ErrorResponse,
    "description": "The user is authenticated but does not have the management role.",
    "content": {"application/json": {"example": {"detail": "Management access required"}}},
}
NOT_FOUND_RESPONSE = {
    "model": ErrorResponse,
    "description": "The report does not exist or is not visible to the resident. Both cases return 404.",
    "content": {"application/json": {"example": {"detail": "Report not found"}}},
}
CONFLICT_RESPONSE = {
    "model": ErrorResponse,
    "description": "The normalized username already exists.",
    "content": {"application/json": {"example": {"detail": "Username already exists"}}},
}
VALIDATION_RESPONSE = {
    "model": ValidationErrorResponse,
    "description": "The request body or query parameters failed validation.",
    "content": {"application/json": {"example": {"detail": [{
        "loc": ["body", "latitude"], "msg": "Input should be less than or equal to 90",
        "type": "less_than_equal", "input": 100, "ctx": {"le": 90},
    }]}}},
}
AUTH_VALIDATION_RESPONSE = {
    **VALIDATION_RESPONSE,
    "content": {"application/json": {"example": {"detail": [{
        "loc": ["body", "username"], "msg": "String should have at least 3 characters",
        "type": "string_too_short", "input": "ab", "ctx": {"min_length": 3},
    }]}}},
}
PAGINATION_VALIDATION_RESPONSE = {
    **VALIDATION_RESPONSE,
    "content": {"application/json": {"example": {"detail": [{
        "loc": ["query", "limit"], "msg": "Input should be greater than or equal to 1",
        "type": "greater_than_equal", "input": "0", "ctx": {"ge": 1},
    }]}}},
}
STATUS_CONFLICT_RESPONSE = {
    "model": ErrorResponse,
    "description": "The current status does not allow the requested transition, including duplicate or stale actions.",
    "content": {"application/json": {"example": {
        "detail": "Cannot change report status from pending_review to resolved",
    }}},
}
WORKFLOW_VALIDATION_RESPONSE = {
    "model": ValidationErrorResponse,
    "description": "The status, note, or repair_verified value does not satisfy the workflow request contract.",
    "content": {"application/json": {"example": {"detail": [{
        "loc": ["body", "note"], "msg": "String should have at least 1 character",
        "type": "string_too_short", "input": "", "ctx": {"min_length": 1},
    }]}}},
}


def authentication_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Invalid or expired credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def insert_status_event(
    connection: sqlite3.Connection,
    ticket_id: str,
    from_status: ReportStatus | None,
    to_status: ReportStatus,
    changed_by: str,
    note: str,
    repair_verified: bool,
    created_at: datetime,
) -> None:
    connection.execute(
        """INSERT INTO report_status_events
        (ticket_id, from_status, to_status, changed_by, note, repair_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (ticket_id, from_status, to_status, changed_by, note, int(repair_verified), created_at.isoformat()),
    )


def find_visible_report(
    connection: sqlite3.Connection, ticket_id: str, current_user: UserResponse,
) -> sqlite3.Row:
    row = connection.execute(
        """SELECT ticket_id, description, latitude, longitude, status, created_at, user_id
        FROM reports WHERE ticket_id = ?""", (ticket_id,),
    ).fetchone()
    if row is None or (
        current_user.role != "management" and row["user_id"] != current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Report not found")
    return row


def create_account(
    credentials: UserCreate,
    role: Literal["resident", "management"] = "resident",
) -> UserResponse:
    user = UserResponse(
        user_id=str(uuid4()),
        username=credentials.username,
        role=role,
        created_at=datetime.now(timezone.utc),
    )
    password_hash = password_hasher.hash(credentials.password.get_secret_value())
    try:
        with database_connection() as connection:
            connection.execute(
                """
                INSERT INTO users (user_id, username, password_hash, role, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user.user_id, user.username, password_hash, user.role, user.created_at.isoformat()),
            )
    except sqlite3.IntegrityError as error:
        raise HTTPException(status_code=409, detail="Username already exists") from error
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_auth),
) -> UserResponse:
    if credentials is None:
        raise authentication_error()
    with database_connection() as connection:
        row = connection.execute(
            """
            SELECT users.user_id, users.username, users.role, users.created_at, sessions.expires_at
            FROM sessions JOIN users ON users.user_id = sessions.user_id
            WHERE sessions.token_hash = ?
            """,
            (hash_token(credentials.credentials),),
        ).fetchone()
    now = int(datetime.now(timezone.utc).timestamp())
    if row is None or row["expires_at"] <= now:
        raise authentication_error()
    return UserResponse.model_validate(dict(row))


def require_management(
    current_user: UserResponse = Depends(get_current_user),
) -> UserResponse:
    if current_user.role != "management":
        raise HTTPException(status_code=403, detail="Management access required")
    return current_user


@app.get(
    "/health", response_model=HealthResponse, tags=["Health"],
    summary="Check API liveness", response_description="The API is responding.",
    description="Public liveness endpoint. It does not check database, AWS, or other dependency readiness.",
)
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/auth/signup", response_model=UserResponse, status_code=201,
    tags=["Authentication"], summary="Register a resident account",
    description="Public endpoint. Accepts only username and password; extra fields return 422. Log in after signing up.",
    response_description="The new resident account, without a password or token.",
    responses={409: CONFLICT_RESPONSE, 422: AUTH_VALIDATION_RESPONSE},
)
def signup(credentials: UserCreate):
    # Public signup never accepts a role or creates management accounts.
    return create_account(credentials, role="resident")


@app.post(
    "/auth/login", response_model=TokenResponse, tags=["Authentication"], summary="Log in and obtain a token",
    description="Log in with a JSON body. The opaque bearer token lasts 3600 seconds. Refresh tokens are not implemented.",
    response_description="Token for the Authorization header.",
    responses={401: UNAUTHORIZED_RESPONSE, 422: AUTH_VALIDATION_RESPONSE},
)
def login(credentials: LoginRequest):
    with database_connection() as connection:
        row = connection.execute(
            "SELECT user_id, password_hash FROM users WHERE username = ?",
            (credentials.username,),
        ).fetchone()
    stored_hash = row["password_hash"] if row is not None else DUMMY_PASSWORD_HASH
    try:
        valid_password = password_hasher.verify(credentials.password.get_secret_value(), stored_hash)
    except UnknownHashError:
        valid_password = False
    if row is None or not valid_password:
        raise authentication_error()

    token = secrets.token_urlsafe(32)
    expires_at = int(datetime.now(timezone.utc).timestamp()) + TOKEN_LIFETIME_SECONDS
    with database_connection() as connection:
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hash_token(token), row["user_id"], expires_at),
        )
    return TokenResponse(access_token=token)


@app.get(
    "/auth/me", response_model=UserResponse, tags=["Authentication"], summary="Read the current user",
    response_description="The user associated with the token.", responses={401: UNAUTHORIZED_RESPONSE},
)
def me(current_user: UserResponse = Depends(get_current_user)):
    return current_user


@app.post(
    "/auth/logout", status_code=204, tags=["Authentication"], summary="Log out of the current session",
    description="Revoke the current token. Other sessions remain valid. Reusing the revoked token returns 401.",
    response_description="Logout succeeded. The response body is empty.", responses={401: UNAUTHORIZED_RESPONSE},
)
def logout(
    current_user: UserResponse = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_auth),
):
    with database_connection() as connection:
        connection.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (hash_token(credentials.credentials),),
        )
    return Response(status_code=204)


@app.post(
    "/reports", response_model=ReportResponse, status_code=201,
    tags=["Reports"], summary="Submit a community issue report",
    description=(
        "Residents and management can submit reports. Accepts only description, latitude, and longitude. "
        "The backend sets user_id, ticket_id, created_at, and the initial pending_review status. "
        "Photos, category, priority, and other extra fields are not accepted in this version."
    ),
    response_description="The saved report. Saving a report does not mean it has been approved.",
    responses={401: UNAUTHORIZED_RESPONSE, 422: VALIDATION_RESPONSE},
)
def create_report(
    report: ReportCreate,
    current_user: UserResponse = Depends(get_current_user),
):
    ticket = ReportResponse(
        **report.model_dump(),
        ticket_id=str(uuid4()),
        created_at=datetime.now(timezone.utc),
        user_id=current_user.user_id,
    )
    with database_connection() as connection:
        connection.execute(
            """
            INSERT INTO reports
                (ticket_id, description, latitude, longitude, status, created_at, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ticket.ticket_id, ticket.description, ticket.latitude, ticket.longitude,
                ticket.status, ticket.created_at.isoformat(), ticket.user_id,
            ),
        )
        insert_status_event(
            connection, ticket.ticket_id, None, ticket.status, current_user.user_id,
            "Report submitted", False, ticket.created_at,
        )
    return ticket


def fetch_reports(
    limit: int, offset: int, owner_id: str | None, status: ReportStatus | None = None,
) -> ReportListResponse:
    # The SQL clause is fixed; user values are passed through placeholders.
    clauses = []
    parameters = []
    if owner_id is not None:
        clauses.append("user_id = ?")
        parameters.append(owner_id)
    if status is not None:
        clauses.append("status = ?")
        parameters.append(status)
    where_clause = " WHERE " + " AND ".join(clauses) if clauses else ""
    with database_connection() as connection:
        total = connection.execute(
            "SELECT COUNT(*) FROM reports" + where_clause, parameters
        ).fetchone()[0]
        rows = connection.execute(
            """
            SELECT ticket_id, description, latitude, longitude, status, created_at, user_id
            FROM reports
            """ + where_clause + """
            ORDER BY created_at DESC, ticket_id DESC
            LIMIT ? OFFSET ?
            """,
            (*parameters, limit, offset),
        ).fetchall()
    return ReportListResponse(
        items=[ReportResponse.model_validate(dict(row)) for row in rows],
        total=total, limit=limit, offset=offset,
    )


@app.get(
    "/reports", response_model=ReportListResponse, tags=["Reports"], summary="List visible reports with pagination",
    description=(
        "Residents see only their own reports. Management sees all reports, including legacy reports without an owner. "
        "Filter by status if needed. Ordered by created_at DESC, then ticket_id DESC. An offset beyond the total returns an empty items array."
    ),
    response_description="The current page and total number of matching, visible reports.",
    responses={401: UNAUTHORIZED_RESPONSE, 422: PAGINATION_VALIDATION_RESPONSE},
)
def list_reports(
    limit: int = Query(default=10, ge=1, le=100, description="Page size: 1-100. Defaults to 10."),
    offset: int = Query(default=0, ge=0, description="Number of reports to skip. Defaults to 0. This is not a page number."),
    status: ReportStatus | None = Query(default=None, description="Optional status filter. Omit it to include all visible statuses."),
    current_user: UserResponse = Depends(get_current_user),
):
    owner_id = current_user.user_id if current_user.role == "resident" else None
    return fetch_reports(limit, offset, owner_id, status)


@app.get(
    "/reports/{ticket_id}", response_model=ReportResponse, tags=["Reports"], summary="Read a report",
    description=(
        "Pass ticket_id as a string. Residents can read their own reports; management can read all reports. "
        "Unknown IDs and reports belonging to another resident both return 404 to avoid revealing other residents' reports."
    ),
    response_description="Details of a report visible to the current user.",
    responses={401: UNAUTHORIZED_RESPONSE, 404: NOT_FOUND_RESPONSE},
)
def get_report(
    ticket_id: str,
    current_user: UserResponse = Depends(get_current_user),
):
    with database_connection() as connection:
        row = find_visible_report(connection, ticket_id, current_user)
    return ReportResponse.model_validate(dict(row))


@app.get(
    "/reports/{ticket_id}/history", response_model=ReportHistoryResponse,
    tags=["Reports"], summary="Read report review and maintenance history",
    description=(
        "Residents can read their own report history; management can read all report histories. Events are ordered by event_id ASC. "
        "Legacy reports may have no creation event. Historical actions are not fabricated."
    ),
    response_description="The current status and recorded action history.",
    responses={401: UNAUTHORIZED_RESPONSE, 404: NOT_FOUND_RESPONSE},
)
def get_report_history(
    ticket_id: str, current_user: UserResponse = Depends(get_current_user),
):
    with database_connection() as connection:
        report = find_visible_report(connection, ticket_id, current_user)
        rows = connection.execute(
            """SELECT event_id, ticket_id, from_status, to_status, changed_by, note,
            repair_verified, created_at FROM report_status_events
            WHERE ticket_id = ? ORDER BY event_id ASC""", (ticket_id,),
        ).fetchall()
    return ReportHistoryResponse(
        ticket_id=ticket_id, status=report["status"],
        items=[ReportStatusEvent.model_validate(dict(row)) for row in rows],
    )


@app.get(
    "/management/reports", response_model=ReportListResponse,
    tags=["Management"], summary="List all reports for management",
    description=(
        "Restricted to management. Uses the same listing rules as GET /reports for management users. "
        "Use status=pending_review to list reports awaiting review."
    ),
    response_description="The current page and total number of matching reports.",
    responses={401: UNAUTHORIZED_RESPONSE, 403: FORBIDDEN_RESPONSE, 422: PAGINATION_VALIDATION_RESPONSE},
)
def list_management_reports(
    limit: int = Query(default=10, ge=1, le=100, description="Page size: 1-100. Defaults to 10."),
    offset: int = Query(default=0, ge=0, description="Number of reports to skip. Defaults to 0. This is not a page number."),
    status: ReportStatus | None = Query(default=None, description="Optional status filter."),
    current_user: UserResponse = Depends(require_management),
):
    return fetch_reports(limit, offset, owner_id=None, status=status)


@app.patch(
    "/management/reports/{ticket_id}/status", response_model=ReportResponse,
    tags=["Management"], summary="Review a report or update its maintenance status",
    description=(
        "Restricted to management. Allowed transitions: pending_review to approved or rejected; "
        "approved to in_progress; in_progress to resolved. Rejected and resolved are terminal statuses. "
        "Every action requires a note. Resolving a report also requires repair_verified=true to record management's confirmation of the repair. "
        "The backend records a human confirmation; it does not inspect the repair. The status and history event are saved together."
    ),
    response_description="The updated report.",
    responses={
        401: UNAUTHORIZED_RESPONSE, 403: FORBIDDEN_RESPONSE, 404: NOT_FOUND_RESPONSE,
        409: STATUS_CONFLICT_RESPONSE, 422: WORKFLOW_VALIDATION_RESPONSE,
    },
)
def update_report_status(
    ticket_id: str, update: ReportStatusUpdate,
    current_user: UserResponse = Depends(require_management),
):
    with database_connection(write=True) as connection:
        row = find_visible_report(connection, ticket_id, current_user)
        previous_status = row["status"]
        if update.status not in STATUS_TRANSITIONS[previous_status]:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot change report status from {previous_status} to {update.status}",
            )
        connection.execute("UPDATE reports SET status = ? WHERE ticket_id = ?", (update.status, ticket_id))
        insert_status_event(
            connection, ticket_id, previous_status, update.status, current_user.user_id,
            update.note, update.repair_verified, datetime.now(timezone.utc),
        )
        updated = find_visible_report(connection, ticket_id, current_user)
    return ReportResponse.model_validate(dict(updated))
