"""Response contracts for authenticated cloud reports."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


Category = Literal["Streetlight", "Damaged Facility", "Blocked Path", "Drainage", "Waste"]
Priority = Literal["high", "medium", "low"]


class CurrentUserResponse(BaseModel):
    user_id: UUID
    email: str | None


class AIAnalysis(BaseModel):
    category: Category
    priority: Priority
    summary: str = Field(min_length=1, max_length=1000)


class ReportResponse(BaseModel):
    # Only declared report fields are returned, even if the database gains more columns.
    model_config = ConfigDict(extra="ignore")

    ticket_id: str
    user_id: UUID
    description: str
    status: str
    created_at: datetime | None = None
    latitude: float
    longitude: float
    image_url: str | None = None
    category: str | None = None
    priority: str | None = None
    is_approved: bool = False


class ReportCreatedResponse(BaseModel):
    success: Literal[True] = True
    message: str = "Report successfully created, analyzed by AI, and stored."
    ticket_id: str
    ai_analysis: AIAnalysis
    image_url: str
    data: list[ReportResponse]


class ReportListResponse(BaseModel):
    items: list[ReportResponse]
    limit: int
    offset: int
