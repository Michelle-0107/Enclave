"""Server-owned service-area discovery; registering an area does not create roads."""

from functools import lru_cache
import json
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]


class ServiceArea(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    id: str = Field(pattern=r'^[a-z][a-z0-9-]{1,63}$')
    name: str = Field(min_length=1, max_length=100)
    bbox: tuple[Longitude, Latitude, Longitude, Latitude]
    center: tuple[Longitude, Latitude]
    enabled: bool = Field(strict=True)
    routing_supported: bool = Field(strict=True, description='A route implementation exists; not a routing-engine health check.')
    resident_demo_supported: bool = Field(strict=True, description='A compatible server-owned resident-demo road graph exists for this area.')
    temporary_live: bool = False
    community_issues_supported: bool = True
    crossing_policy: Literal['provider_default','mapped_facilities_only','resident_local_roads'] = 'resident_local_roads'
    location_reference: str = Field(pattern=r'^https://www\.openstreetmap\.org/(node|way|relation)/[0-9]+$')
    boundary_type: Literal['development_window'] = 'development_window'
    official_boundary: Literal[False] = False
    field_verified: Literal[False] = False

    @model_validator(mode='after')
    def valid_bounds(self):
        west, south, east, north = self.bbox
        longitude, latitude = self.center
        if not west < east or not south < north:
            raise ValueError('Service-area bounds must have positive width and height')
        if not west <= longitude <= east or not south <= latitude <= north:
            raise ValueError('Service-area center must be inside its bounds')
        return self


class ServiceAreas(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    default_area_id: str
    items: tuple[ServiceArea, ...] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def valid_default(self):
        ids = [item.id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError('Service-area identifiers must be unique')
        if not any(item.id == self.default_area_id and item.enabled for item in self.items):
            raise ValueError('The default must identify an enabled service area')
        return self


@lru_cache(maxsize=1)
def service_areas() -> ServiceAreas:
    path = Path(__file__).resolve().parents[1] / 'data' / 'service_areas.json'
    return ServiceAreas.model_validate(json.loads(path.read_text(encoding='utf-8')))


class DemoAreaDataset(BaseModel):
    area_id: str
    dataset: dict[str, Any]


def find_area(area_id: str) -> ServiceArea | None:
    return next((area for area in service_areas().items if area.id == area_id and area.enabled), None)


def route_area(origin, destination):
    for area in service_areas().items:
        if not area.enabled or not area.routing_supported:
            continue
        w,s,e,n=area.bbox
        if all(w<=p[0]<=e and s<=p[1]<=n for p in (origin,destination)):
            return area
    return None


@lru_cache(maxsize=4)
def demo_area_dataset(area_id: str) -> DemoAreaDataset:
    area = find_area(area_id)
    if area is None or not area.resident_demo_supported:
        raise ValueError('No resident demo dataset is configured for this area')
    # IDs come from the validated registry, never an arbitrary caller-supplied path.
    path = Path(__file__).resolve().parents[1] / 'data' / 'demo_areas' / (area.id + '.json')
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Resident demo dataset exceeds the supported size')
    dataset = json.loads(path.read_text(encoding='utf-8'))
    if (dataset.get('version') != 3 or dataset.get('source') != 'osm_roads_with_fictional_facilities'
            or dataset.get('fieldVerified') is not False or dataset.get('bbox') != list(area.bbox)
            or dataset.get('provenance', {}).get('geometrySource') != 'OpenStreetMap'
            or dataset.get('provenance', {}).get('license') != 'ODbL-1.0'
            or not dataset.get('nodes') or not dataset.get('edges')):
        raise ValueError('Resident demo dataset does not match the configured area')
    return DemoAreaDataset(area_id=area.id, dataset=dataset)
