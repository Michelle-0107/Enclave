"""Management review and resident-visible audit history through a private RPC."""

from datetime import datetime
from typing import Literal
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..core.config import Settings
from .models import ReportResponse


ReportStatus = Literal["pending", "approved", "rejected", "in_progress", "resolved"]
TRANSITIONS = {"pending": {"approved", "rejected"}, "approved": {"in_progress"},
               "in_progress": {"resolved"}, "resolved": set(), "rejected": set()}


class StatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_status: ReportStatus
    status: ReportStatus
    note: str = Field(min_length=1, max_length=1000,
                      description="Resident-visible review or repair note; exclude private staff information.")
    repair_verified: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def valid_transition(self):
        if self.status not in TRANSITIONS[self.expected_status]:
            raise ValueError("Invalid status transition")
        if self.repair_verified != (self.status == "resolved"):
            raise ValueError("Only resolution requires repair_verified=true")
        return self


class WorkflowReport(ReportResponse):
    status: ReportStatus
    is_approved: bool = Field(strict=True)

    @model_validator(mode="after")
    def consistent_approval(self):
        if self.is_approved != (self.status in ("approved", "in_progress", "resolved")):
            raise ValueError("Inconsistent approval")
        return self


class ManagementReportList(BaseModel):
    items: list[WorkflowReport]
    limit: int
    offset: int
    has_more: bool


class StatusEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: int = Field(gt=0, strict=True)
    from_status: ReportStatus
    to_status: ReportStatus
    note: str = Field(min_length=1, max_length=1000)
    repair_verified: bool = Field(strict=True)
    created_at: datetime
    actor_role: Literal["management", "maintenance"] = "management"
    # Names/emails are never returned. Only managers receive the actor UUID.
    changed_by: UUID | None = None

    @model_validator(mode="after")
    def valid_event(self):
        if self.to_status not in TRANSITIONS[self.from_status]:
            raise ValueError("Invalid history transition")
        if self.repair_verified != (self.to_status == "resolved"):
            raise ValueError("Invalid verification flag")
        return self


class ReportHistory(BaseModel):
    ticket_id: str
    items: list[StatusEvent]
    limit: int
    offset: int
    has_more: bool


class StatusUpdated(BaseModel):
    report: WorkflowReport
    event: StatusEvent


class WorkflowUnavailable(RuntimeError):
    pass


class WorkflowRejected(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


class ReportWorkflow:
    def __init__(self, settings: Settings, *, transport=None):
        self.url = settings.project_url + "/rest/v1/rpc/enclave_report_workflow"
        self.headers = {"apikey": settings.api_key, "Content-Profile": "public"}
        if not settings.api_key.startswith("sb_secret_"):
            self.headers["Authorization"] = "Bearer " + settings.api_key
        self.client = httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    async def call(self, action, actor_id, **args):
        try:
            response = await self.client.post(self.url, headers=self.headers,
                json={"p_action": action, "p_args": {**args, "actor_id": str(actor_id)}})
            if response.status_code != 200:
                raise WorkflowUnavailable()
            data = response.json()
            if not isinstance(data, dict):
                raise WorkflowUnavailable()
            state = data.get("state")
            failures = {"forbidden": (403, "Report workflow access denied"),
                        "not_found": (404, "Report not found"),
                        "conflict": (409, "Report status changed; refresh before retrying"),
                        "invalid": (422, "Invalid report workflow request")}
            if state in failures:
                raise WorkflowRejected(*failures[state])
            if state != "ok":
                raise WorkflowUnavailable()
            return data
        except (httpx.HTTPError, ValueError, TypeError):
            raise WorkflowUnavailable() from None

    async def list_reports(self, actor_id, *, status, limit, offset):
        data = await self.call("list", actor_id, status=status, limit=limit, offset=offset)
        try:
            items = [WorkflowReport.model_validate(row) for row in data["items"]]
            if len(items) > limit or type(data["has_more"]) is not bool:
                raise WorkflowUnavailable()
            if status and any(row.status != status for row in items):
                raise WorkflowUnavailable()
            return ManagementReportList(items=items, limit=limit, offset=offset, has_more=data["has_more"])
        except (KeyError, TypeError, ValueError, ValidationError):
            raise WorkflowUnavailable() from None

    async def update(self, actor_id, ticket_id, body: StatusUpdate):
        data = await self.call("update", actor_id, ticket_id=ticket_id, **body.model_dump())
        try:
            result = StatusUpdated.model_validate(data)
            if (result.report.ticket_id != ticket_id or result.report.status != body.status
                or result.event.from_status != body.expected_status or result.event.to_status != body.status
                or result.event.changed_by != actor_id or result.event.note != body.note):
                raise WorkflowUnavailable()
            return result
        except (ValueError, ValidationError):
            raise WorkflowUnavailable() from None

    async def history(self, actor_id, ticket_id, *, limit, offset):
        data = await self.call("history", actor_id, ticket_id=ticket_id, limit=limit, offset=offset)
        try:
            if type(data["is_management"]) is not bool or type(data["has_more"]) is not bool:
                raise WorkflowUnavailable()
            items = [StatusEvent.model_validate(row) for row in data["items"]]
            if len(items) > limit:
                raise WorkflowUnavailable()
            if not data["is_management"]:
                items = [item.model_copy(update={"changed_by": None}) for item in items]
            return ReportHistory(ticket_id=ticket_id, items=items, limit=limit, offset=offset,
                                 has_more=data["has_more"])
        except (KeyError, TypeError, ValueError, ValidationError):
            raise WorkflowUnavailable() from None
