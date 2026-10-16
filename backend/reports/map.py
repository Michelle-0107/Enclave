"""Shared GeoJSON and bounds contracts; consensus reads live in reports/issues.py."""
from dataclasses import dataclass
from typing import Literal
import math
from pydantic import BaseModel

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


class MapPoint(BaseModel):
    type: Literal["Point"]="Point"
    coordinates: tuple[float,float]

class MapPagination(BaseModel):
    limit: int
    offset: int
    returned: int
    has_more: bool
