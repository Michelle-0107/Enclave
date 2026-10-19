"""Resident demo routes computed on the same server-side OSM road graph as live routing."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .contracts import Location, RouteMode, RouteResponse, WalkingRouteRequest
from .provider import NavigationRejected
from .roadside import distance
from .zones import route_intersects_zone, zone_bounds

MAX_DEMO_START_CANDIDATES = 8
MAX_START_ADJUSTMENT_METERS = 100


class DemoRouteRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    origin: Location
    destination: Location
    profile: Literal['walking', 'wheelchair'] = 'walking'
    start_candidates: list[Location] = Field(default_factory=list, max_length=MAX_DEMO_START_CANDIDATES)


class DemoRouteOption(BaseModel):
    mode: RouteMode
    route: RouteResponse | None = None
    unavailable_reason: str | None = None


class DemoRouteResponse(BaseModel):
    area_id: str
    requested_origin: Location
    selected_origin: Location
    start_adjustment_meters: float = Field(ge=0, le=MAX_START_ADJUSTMENT_METERS)
    adjusted_start: bool
    options: list[DemoRouteOption] = Field(min_length=1, max_length=3)


def _inside(point, bounds):
    west, south, east, north = bounds
    return west <= point[0] <= east and south <= point[1] <= north


def _demo_constraints(dataset, mode):
    blocked = []
    excluded_way_ids = set()
    facilities = dataset.get('facilities', [])
    edges = dataset.get('edges', [])

    if mode in {'avoid_damage', 'accessible'}:
        blocked.extend(item for item in facilities
                       if item.get('damaged') is True and item.get('reporters', 0) >= 2)
    if mode == 'accessible':
        blocked.extend(item for item in facilities if item.get('kind') == 'stairs')
        excluded_way_ids.update(str(edge.get('osmWayId')) for edge in edges
                                if edge.get('mappedHasSteps') is True or edge.get('baseStepFree') is False)

    boxes = []
    seen = set()
    for item in blocked:
        identifier = item.get('id')
        coordinate = item.get('coordinate')
        radius = item.get('restrictionRadiusMeters', 3)
        if (not isinstance(identifier, str) or identifier in seen or not isinstance(coordinate, list)
                or len(coordinate) != 2 or not all(isinstance(value, (int, float)) for value in coordinate)
                or not isinstance(radius, (int, float)) or not 0 < radius <= 10):
            continue
        seen.add(identifier)
        boxes.append(zone_bounds(coordinate[1], coordinate[0], radius))
    return boxes, excluded_way_ids


def _options(area_id, dataset, graph, origin, destination, profile, *, modes=None):
    if modes is None:
        modes = ('accessible',) if profile == 'wheelchair' else ('shortest', 'avoid_damage', 'accessible')
    result = []
    for mode in modes:
        boxes, excluded = _demo_constraints(dataset, mode)
        body = WalkingRouteRequest(
            origin={'longitude': origin[0], 'latitude': origin[1]},
            destination={'longitude': destination[0], 'latitude': destination[1]},
            route_mode=mode,
        )
        try:
            route = graph.route(body, boxes=boxes, area_id=area_id,
                                community_supported=False, demo_mode=True,
                                excluded_way_ids=excluded)
        except NavigationRejected as failure:
            result.append(DemoRouteOption(mode=mode, unavailable_reason=failure.message))
            continue

        coordinates = route.geometry.coordinates
        route.demo_facility_ids = sorted(set(route.demo_facility_ids) | {
            item['id'] for item in dataset.get('facilities', [])
            if isinstance(item.get('coordinate'), list) and len(item['coordinate']) == 2
            and route_intersects_zone(coordinates, zone_bounds(
                item['coordinate'][1], item['coordinate'][0],
                min(10, max(1, item.get('restrictionRadiusMeters', 3)))))
        })
        result.append(DemoRouteOption(mode=mode, route=route))
    return result


def calculate_demo_routes(area_id, bounds, request, dataset, graph):
    if dataset.get('navigationFacilities'):
        from .demo_network import demo_walking_graph
        graph=demo_walking_graph(area_id)
    origin = (request.origin.longitude, request.origin.latitude)
    destination = (request.destination.longitude, request.destination.latitude)
    if not _inside(origin, bounds) or not _inside(destination, bounds):
        raise NavigationRejected(422, 'Choose both points inside the selected service area.')
    if distance(origin, destination) < 5:
        raise NavigationRejected(422, 'Choose locations at least 5 meters apart.')

    candidates = []
    for point in request.start_candidates:
        coordinate = (point.longitude, point.latitude)
        gap = distance(origin, coordinate)
        if gap <= 3 or gap > MAX_START_ADJUSTMENT_METERS or not _inside(coordinate, bounds):
            continue
        if all(distance(coordinate, prior[1]) >= 3 for prior in candidates):
            candidates.append((gap, coordinate))
    candidates.sort(key=lambda item: item[0])

    attempts = [(0.0, origin), *candidates]
    direct_options = None
    required_mode = 'accessible' if request.profile == 'wheelchair' else 'shortest'
    for gap, selected in attempts:
        # Failed alternate starts need only the required mode. Calculate the
        # other modes once, after a connected start has actually been found.
        options = _options(area_id, dataset, graph, selected, destination, request.profile,
                           modes=None if direct_options is None else (required_mode,))
        if direct_options is None:
            direct_options = options
        if any(item.mode == required_mode and item.route is not None for item in options):
            if gap > 3 and request.profile == 'walking':
                options.extend(_options(area_id, dataset, graph, selected, destination, request.profile,
                                        modes=('avoid_damage', 'accessible')))
            return DemoRouteResponse(
                area_id=area_id,
                requested_origin=request.origin,
                selected_origin=Location(longitude=selected[0], latitude=selected[1]),
                start_adjustment_meters=gap,
                adjusted_start=gap > 3,
                options=options,
            )

    return DemoRouteResponse(
        area_id=area_id,
        requested_origin=request.origin,
        selected_origin=request.origin,
        start_adjustment_meters=0,
        adjusted_start=False,
        options=direct_options or [],
    )
