"""Walking directions contracts. GPS tracking and speech playback are client-side."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import MAX_ROUTE_POINTS


Longitude = Annotated[float, Field(ge=-180,le=180,allow_inf_nan=False,strict=True)]
Latitude = Annotated[float, Field(ge=-90,le=90,allow_inf_nan=False,strict=True)]
Meters = Annotated[float, Field(ge=0,le=30_000,allow_inf_nan=False)]
Seconds = Annotated[float, Field(ge=0,le=86_400,allow_inf_nan=False)]
RouteMode = Literal['shortest','avoid_damage','accessible']


class Location(BaseModel):
    model_config = ConfigDict(extra='forbid')
    latitude: Latitude
    longitude: Longitude


class WalkingRouteRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={'examples': [{
        'origin': {'latitude': 3.225377, 'longitude': 101.730331},
        'destination': {'latitude': 3.227217, 'longitude': 101.731778},
        'profile': 'walking', 'language': 'en', 'route_mode': 'shortest',
    }]})
    origin: Location
    destination: Location
    profile: Literal['walking'] = 'walking'
    language: Literal['en'] = 'en'
    route_mode: RouteMode = 'shortest'
    avoid_confirmed_obstacles: bool | None = Field(default=None,strict=True,deprecated=True,
        description='Compatibility alias only: true means avoid_damage using two-resident issues, never management approval. Prefer route_mode.')

    @model_validator(mode='after')
    def legacy_mode(self):
        legacy=self.__dict__['avoid_confirmed_obstacles']
        if legacy is not None:
            implied='avoid_damage' if legacy else 'shortest'
            if 'route_mode' in self.model_fields_set and self.route_mode!=implied:
                raise ValueError('Use route_mode without a contradictory legacy avoidance flag')
            self.route_mode=implied
        return self


class RouteGeometry(BaseModel):
    type: Literal['LineString'] = 'LineString'
    coordinates: list[tuple[Longitude,Latitude]] = Field(min_length=2,max_length=MAX_ROUTE_POINTS)


class Maneuver(BaseModel):
    index: int = Field(ge=0)
    type: int = Field(ge=0,le=100,strict=True)
    instruction: str = Field(min_length=1,max_length=1000)
    spoken_instruction: str = Field(min_length=1,max_length=1000)
    distance_meters: Meters
    duration_seconds: Seconds
    begin_shape_index: int = Field(ge=0,strict=True)
    end_shape_index: int = Field(ge=0,strict=True)
    distance_from_start_meters: Meters
    coordinate: tuple[Longitude,Latitude]


class RouteResponse(BaseModel):
    route_id: UUID
    generated_at: datetime
    area: str = 'kl-east-pilot'
    profile: Literal['walking'] = 'walking'
    language: Literal['en'] = 'en'
    route_mode: RouteMode = 'shortest'
    routing_engine: Literal['valhalla','verified_network','osm_roadside']='valhalla'
    road_fallback_used: bool = False
    crossing_policy: Literal['provider_default','mapped_facilities_only'] = 'provider_default'
    mapped_crossing_count: int = Field(default=0,ge=0)
    geometry: RouteGeometry
    distance_meters: Meters
    duration_seconds: Seconds
    origin_snap_distance_meters: Meters
    destination_snap_distance_meters: Meters
    maneuvers: list[Maneuver] = Field(min_length=2,max_length=2000)
    data_source: Literal['openstreetmap_unverified','synthetic_demo','verified_accessibility_network']
    field_verified: bool = False
    accessibility_status: Literal['not_requested','verified_network','synthetic_network']='not_requested'
    community_issue_avoidance: Literal['not_applied','applied','no_active_obstacles'] = 'not_applied'
    obstacle_snapshot_at: datetime | None = None
    obstacle_count: int = Field(default=0,ge=0,le=100)
    obstacle_source: Literal['community_reports'] | None = None
    confirmation_threshold: Literal[2] = 2
    warnings: list[str]
    attribution: str = 'OpenStreetMap contributors'
    attribution_url: str = 'https://www.openstreetmap.org/copyright'


class NavigationArea(BaseModel):
    id: str = 'kl-east-pilot'
    name: str = 'KL East walking pilot'
    bbox: tuple[float,float,float,float]
    center: tuple[float,float]
    boundary_type: Literal['development_window'] = 'development_window'
    official_boundary: Literal[False] = False
    field_verified: Literal[False] = False
    supported_profiles: list[str] = ['walking']
    supported_languages: list[str] = ['en']
    supported_route_modes: list[str] = ['shortest','avoid_damage','accessible']
    temporary_live: bool = False
    community_issues_supported: bool = True
    crossing_policy: Literal['provider_default','mapped_facilities_only'] = 'provider_default'
    accessible_network_available: bool = False
    verified_accessible_segments: int = 0
    community_issue_avoidance: Literal['two_resident_issue_points'] = 'two_resident_issue_points'
    map_style_url: str = 'https://tiles.openfreemap.org/styles/liberty'
    attribution_url: str = 'https://www.openstreetmap.org/copyright'
