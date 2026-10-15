"""Read approved community issue points without exposing private report evidence."""

from dataclasses import dataclass
from datetime import datetime
import math
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..core.config import Settings
from .models import Priority


MAP_COLUMNS = "id,ticket_id,status,created_at,latitude,longitude,category,priority,is_approved"
ACTIVE_MAP_STATUSES = ("approved", "in_progress")


class CommunityMapUnavailable(RuntimeError):
    """Map data could not be read or safely projected."""


@dataclass(frozen=True)
class MapBounds:
    west: float = -180
    south: float = -90
    east: float = 180
    north: float = 90

    @classmethod
    def parse(cls, value: str | None):
        if value is None:
            return cls()
        parts = value.split(",")
        if len(parts) != 4:
            raise ValueError("Invalid bounding box")
        west, south, east, north = (float(part) for part in parts)
        if not all(math.isfinite(n) for n in (west, south, east, north)):
            raise ValueError("Invalid bounding box")
        if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
            raise ValueError("Invalid bounding box")
        return cls(west, south, east, north)

    def contains(self, longitude, latitude):
        return self.west <= longitude <= self.east and self.south <= latitude <= self.north

    def postgrest_filter(self):
        return (f"(longitude.gte.{self.west},longitude.lte.{self.east},"
                f"latitude.gte.{self.south},latitude.lte.{self.north})")


class _MapRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int = Field(gt=0, strict=True)
    ticket_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    status: Literal["approved", "in_progress", "resolved"]
    created_at: datetime | None = None
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    category: str | None = Field(default=None, max_length=80)
    priority: Priority | None = None


class MapPoint(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]


class MapIssueProperties(BaseModel):
    ticket_id: str
    category: str | None
    priority: Priority | None
    status: Literal["approved", "in_progress", "resolved"]
    reported_at: datetime | None
    # The current table has no verification timestamp. Never relabel created_at.
    verified_at: None = None


class MapIssueFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: str
    geometry: MapPoint
    properties: MapIssueProperties


class MapPagination(BaseModel):
    limit: int
    offset: int
    returned: int
    has_more: bool


class CommunityMapResponse(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[MapIssueFeature]
    pagination: MapPagination


class CommunityMapRepository:
    """Trusted backend projection; owner-only report RLS remains unchanged.

    This explicit community read uses the existing server-only key. It requests
    only map fields, filters approved rows, and validates eligibility again
    before serialization. No client token or administrative response is exposed.
    """

    def __init__(self, settings: Settings, *, transport=None):
        self.url = settings.project_url + "/rest/v1/reports"
        self.headers = {"apikey": settings.api_key, "Accept-Profile": "public"}
        if not settings.api_key.startswith("sb_secret_"):
            self.headers["Authorization"] = "Bearer " + settings.api_key
        self.client = httpx.AsyncClient(timeout=10, follow_redirects=False,
                                        trust_env=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    async def list_issues(self, *, bounds: MapBounds, limit: int, offset: int,
                          include_resolved: bool = False) -> CommunityMapResponse:
        statuses = ACTIVE_MAP_STATUSES + (("resolved",) if include_resolved else ())
        params = {"select": MAP_COLUMNS, "is_approved": "eq.true",
                  "status": "in.(" + ",".join(statuses) + ")",
                  "and": bounds.postgrest_filter(),
                  "order": "created_at.desc.nullslast,id.desc",
                  "limit": str(limit + 1), "offset": str(offset)}
        try:
            response = await self.client.get(self.url, headers=self.headers, params=params)
            if response.status_code != 200:
                raise CommunityMapUnavailable()
            rows = response.json()
            if not isinstance(rows, list) or len(rows) > limit + 1:
                raise CommunityMapUnavailable()
            records = []
            for row in rows:
                if not isinstance(row, dict) or row.get("is_approved") is not True:
                    raise CommunityMapUnavailable()
                record = _MapRow.model_validate(row)
                if record.status not in statuses or not bounds.contains(record.longitude, record.latitude):
                    raise CommunityMapUnavailable()
                records.append(record)
            if len({record.id for record in records}) != len(records):
                raise CommunityMapUnavailable()
        except (httpx.HTTPError, ValueError, TypeError, ValidationError):
            raise CommunityMapUnavailable() from None
        features = [MapIssueFeature(
            id=str(record.id),
            geometry=MapPoint(coordinates=(record.longitude, record.latitude)),
            properties=MapIssueProperties(ticket_id=record.ticket_id, category=record.category,
                                          priority=record.priority, status=record.status,
                                          reported_at=record.created_at),
        ) for record in records[:limit]]
        return CommunityMapResponse(features=features, pagination=MapPagination(
            limit=limit, offset=offset, returned=len(features), has_more=len(records) > limit))
