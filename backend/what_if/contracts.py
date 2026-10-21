"""Bounded management-defined journeys and explicitly entered MYR estimates."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..navigation.config import in_bounds
from ..navigation.contracts import Location, RouteGeometry
from ..navigation.service import distance_meters
from .candidates import ReviewIssue


Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
SimulationMode = Literal['avoid_damage', 'accessible']


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class MajorPath(Input):
    id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(min_length=1, max_length=120)
    origin: Location
    destination: Location

    @model_validator(mode='after')
    def supported_locations(self):
        points = [(p.longitude, p.latitude) for p in (self.origin, self.destination)]
        if not all(in_bounds(*p) for p in points) or distance_meters(*points) < 5:
            raise ValueError('Use KL East pilot locations at least 5 meters apart')
        return self


class RepairEstimate(Input):
    facility_id: UUID
    estimated_cost_myr: Money | None = None

    @field_validator('estimated_cost_myr', mode='before')
    @classmethod
    def reject_boolean_cost(cls, value):
        if isinstance(value, bool):
            raise ValueError('Cost must be an MYR amount')
        return value


class RepairPlan(Input):
    id: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(min_length=1, max_length=120)
    repairs: list[RepairEstimate] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def unique_facilities(self):
        ids = [repair.facility_id for repair in self.repairs]
        if len(ids) != len(set(ids)):
            raise ValueError('Select each facility only once per plan')
        return self


class CompareRequest(Input):
    paths: list[MajorPath] = Field(min_length=1, max_length=5)
    plans: list[RepairPlan] = Field(min_length=1, max_length=3)
    route_modes: list[SimulationMode] = Field(default_factory=lambda: ['avoid_damage', 'accessible'],
                                              min_length=1, max_length=2)
    budget_myr: Money | None = None
    include_geometry: bool = Field(default=False, strict=True)

    @field_validator('budget_myr', mode='before')
    @classmethod
    def reject_boolean_budget(cls, value):
        if isinstance(value, bool):
            raise ValueError('Budget must be an MYR amount')
        return value

    @model_validator(mode='after')
    def unique_comparison_inputs(self):
        for items in (self.paths, self.plans):
            if len({item.id for item in items}) != len(items):
                raise ValueError('Path and plan IDs must be unique within their lists')
        pairs = [(p.origin.latitude, p.origin.longitude, p.destination.latitude, p.destination.longitude) for p in self.paths]
        if len(pairs) != len(set(pairs)) or len(self.route_modes) != len(set(self.route_modes)):
            raise ValueError('Do not duplicate origin/destination pairs or route modes')
        return self


class RepairCandidates(BaseModel):
    snapshot_at: datetime
    issues: list[ReviewIssue]
    confirmation_threshold: Literal[2] = 2
    main_path_source: Literal['management_defined'] = 'management_defined'
    currency: Literal['MYR'] = 'MYR'
    persistence: Literal['not_saved'] = 'not_saved'


class WalkingReference(BaseModel):
    state: Literal['available'] = 'available'
    route_mode: Literal['avoid_damage'] = 'avoid_damage'
    reference_only: Literal[True] = True
    accessibility_verified: Literal[False] = False
    warning: str = 'Walking reference only; accessibility has not been verified.'
    distance_meters: float
    duration_seconds: float
    geometry: RouteGeometry | None = None
    data_source: str


class RouteOutcome(BaseModel):
    details: str | None = None
    state: Literal['available', 'no_route', 'not_assessable']
    reason: str | None = None
    distance_meters: float | None = None
    duration_seconds: float | None = None
    geometry: RouteGeometry | None = None
    data_source: str | None = None
    field_verified: bool | None = None
    fallback: WalkingReference | None = None


class RoutingRestriction(BaseModel):
    issue_id: UUID
    facility_id: UUID
    facility_name: str
    latitude: float
    longitude: float
    binding_source: Literal['mapped_demo_segment', 'mapped_road_section', 'mapped_road_reference', 'point_only']
    affected_segment: RouteGeometry | None = None
    exclusion_rings: list[list[tuple[float,float]]]


class BaselinePath(BaseModel):
    requested_origin: Location | None = None
    requested_destination: Location | None = None
    path_id: str
    path_name: str
    route_mode: SimulationMode
    comparison_origin: Location | None = None
    comparison_destination: Location | None = None
    current: RouteOutcome
    reference_without_damage: RouteOutcome


class PathImpact(BaseModel):
    path_id: str
    path_name: str
    route_mode: SimulationMode
    after: RouteOutcome
    effect: Literal['restored', 'shortened', 'unchanged', 'longer', 'lost_route', 'still_unavailable', 'not_assessable']
    explanation: str | None = None
    distance_saved_meters: float | None
    duration_saved_seconds: float | None
    reference_intersects_selected_repairs: bool | None
    reference_intersecting_facility_ids: list[UUID]


class ModeSummary(BaseModel):
    route_mode: SimulationMode
    designated_path_count: int
    reference_assessable_path_count: int
    affected_major_path_count: int
    restored_path_count: int
    shortened_path_count: int
    improved_path_count: int
    longer_path_count: int
    lost_route_count: int
    not_assessable_path_count: int
    baseline_available_path_count: int
    after_available_path_count: int
    distance_saved_on_comparable_paths_meters: float


class FacilityImpact(BaseModel):
    facility_id: UUID
    facility_name: str
    repaired_issue_ids: list[UUID]
    affects_routes: bool
    reference_intersecting_major_path_ids: list[str]


class PlanResult(BaseModel):
    id: str
    name: str
    total_estimated_cost_myr: Decimal | None
    known_estimated_subtotal_myr: Decimal
    missing_cost_facility_ids: list[UUID]
    budget_status: Literal['within_budget', 'over_budget', 'unknown_cost', 'not_set']
    repaired_issue_count: int
    remaining_road_obstacle_count: int
    affected_major_path_count: int
    improved_major_path_count: int
    facility_impacts: list[FacilityImpact]
    summaries: list[ModeSummary]
    paths: list[PathImpact]


class CompareResponse(BaseModel):
    simulation_id: UUID
    generated_at: datetime
    snapshot_at: datetime
    simulation_only: Literal[True] = True
    main_path_source: Literal['management_defined'] = 'management_defined'
    currency: Literal['MYR'] = 'MYR'
    budget_myr: Decimal | None
    baseline_road_obstacle_count: int
    routing_restrictions: list[RoutingRestriction] = Field(default_factory=list)
    baseline: list[BaselinePath]
    plans: list[PlanResult]
    warnings: list[str]
