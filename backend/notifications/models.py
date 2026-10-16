"""API contracts for resident-visible management notifications."""

from datetime import datetime
from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    id: int
    title: str
    message: str
    related_report_id: int | None = None
    is_read: bool = False
    created_at: datetime
    published_at: datetime | None = None
    expires_at: datetime | None = None


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    limit: int
    offset: int


class NotificationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)
    related_report_id: int | None = None
    expires_at: datetime | None = None


__all__ = ["NotificationCreate", "NotificationListResponse", "NotificationResponse"]
