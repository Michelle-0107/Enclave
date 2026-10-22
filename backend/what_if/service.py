"""Compare independent hypothetical repairs against one immutable incident snapshot."""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from ..navigation.accessibility import VerifiedNetwork
from ..navigation.contracts import WalkingRouteRequest
from ..navigation.provider import NavigationRejected, NavigationUnavailable
from ..navigation.service import distance_meters
from .routing import SimulationNavigation
from ..navigation.facility_segments import restriction_for
from ..navigation.zones import BoundsIndex, zone_bounds, zone_ring, route_intersects_zone
from ..reports.issues import CommunityObstacle, CommunityObstacleSnapshot
from .contracts import (BaselinePath, CompareResponse, FacilityImpact, ModeSummary,
                        PathImpact, PlanResult, RepairCandidates, RouteOutcome, WalkingReference, RoutingRestriction)
from .repository import WhatIfRejected, WhatIfUnavailable


@dataclass(frozen=True)
class CalculatedRoute:
    route: object | None
    state: str
    reason: str | None = None
    details: str | None = None


class WhatIfService:
    def __init__(self, repository, navigation, *, timeout_seconds=45):
        self.repository, self.navigation = repository, navigation
        self.timeout_seconds = timeout_seconds
        self._comparison_slot = asyncio.Lock()

    async def candidates(self, actor_id):
        snapshot = await self.repository.snapshot(actor_id)
        return RepairCandidates(snapshot_at=snapshot.checked_at, issues=[i for i in snapshot.issues if i.review_ticket_id is not None])

    async def compare(self, actor_id, body):
        # Authorize against the current database role before reading candidates or doing work.
        snapshot = await self.repository.snapshot(actor_id)
        if self._comparison_slot.locked():
            raise WhatIfRejected(429, 'Another repair comparison is running; retry shortly')
        async with self._comparison_slot:
            try:
                async with asyncio.timeout(self.timeout_seconds):
                    return await self._compare_snapshot(snapshot, body)
            except TimeoutError:
                raise WhatIfUnavailable('timeout') from None
            except NavigationUnavailable:
                raise WhatIfUnavailable('routing') from None

    async def _compare_snapshot(self, snapshot, body):
        from ..navigation.road_bindings import road_reference_bindings
        for issue in snapshot.issues:
            binding = road_reference_bindings().get(issue.facility_id)
            if (binding and abs(binding['latitude']-issue.latitude)<1e-9 and abs(binding['longitude']-issue.longitude)<1e-9
                    and issue.facility_type == 'other'):
                raise WhatIfRejected(409, 'Road catalog update required before comparing road repairs')
        by_facility = {}
        for issue in snapshot.issues:
            if issue.review_ticket_id is not None:
                by_facility.setdefault(issue.facility_id, []).append(issue)
        for plan in body.plans:
            if any(r.facility_id not in by_facility for r in plan.repairs):
                raise WhatIfRejected(409, 'A selected facility has no current unapproved two-resident issue; refresh repair candidates')

        restrictions = [RoutingRestriction(**restriction_for(i)) for i in snapshot.issues if i.affects_routes]
        rings_by_issue = {r.issue_id: r.exclusion_rings for r in restrictions}

        def obstacles(repaired=frozenset()):
            return CommunityObstacleSnapshot(checked_at=snapshot.checked_at, items=[
                CommunityObstacle(issue_id=i.id, facility_id=i.facility_id, reporter_count=i.reporter_count,
                                  exclusion_ring=ring)
                for i in snapshot.issues if i.affects_routes and not (i.facility_id in repaired and i.review_ticket_id is not None)
                for ring in rings_by_issue[i.id]])

        before_snapshot = obstacles()
        reference_snapshot = CommunityObstacleSnapshot(checked_at=snapshot.checked_at, items=[])
        plan_snapshots = {p.id: obstacles({r.facility_id for r in p.repairs}) for p in body.plans}
        navigation = SimulationNavigation(self.navigation.provider,
                                          accessibility=self.navigation.accessibility, fixed_snap=True)
        if 'accessible' in body.route_modes and not navigation.uses_resident_facilities:
            network = navigation.accessibility
            if network is None:
                raise WhatIfUnavailable()
            # Freeze survey data and validity time too, so all plans use the same assumptions.
            navigation.accessibility = VerifiedNetwork(
                document=network.load().model_dump(mode='json'),
                assessment_time=snapshot.checked_at)
        # A mapped 100 m road section expands into many 5 m exclusion squares.
        # The resident graph indexes those squares directly; the legacy external
        # provider has its own bounded polygon request and cannot accept them.
        if not navigation.uses_resident_facilities and sum(len(r.exclusion_rings) for r in restrictions) > 100:
            raise WhatIfRejected(422, 'Comparison exceeds the external routing provider limit of 100 exclusion zones')
        # One source issue may contribute many overlapping 5 m squares. Index
        # the frozen zones once per distinct repair state and test entire route
        # geometry, including its origin and destination approaches.
        zone_indexes = {}

        def snapshot_key(selected_snapshot):
            return tuple(sorted({item.issue_id for item in selected_snapshot.items}, key=str))

        def zone_index(selected_snapshot):
            key = snapshot_key(selected_snapshot)
            if key not in zone_indexes:
                zone_indexes[key] = BoundsIndex([
                    (item.exclusion_ring[0][0], item.exclusion_ring[0][1],
                     item.exclusion_ring[2][0], item.exclusion_ring[2][1])
                    for item in selected_snapshot.items])
            return zone_indexes[key]

        def route_clear(route, path, selected_snapshot):
            index = zone_index(selected_snapshot)
            if not index.bounds:
                return True
            coordinates = [(path.origin.longitude, path.origin.latitude),
                           *route.geometry.coordinates,
                           (path.destination.longitude, path.destination.latitude)]
            return not any(index.intersects(a, b) for a, b in zip(coordinates, coordinates[1:]))

        anchors = {}
        semaphore = asyncio.Semaphore(4)
        tasks = {}

        async def calculate(path, mode, selected_snapshot, anchored_request=None, expected_endpoints=None):
            key = (path.id, mode, snapshot_key(selected_snapshot))
            if key not in tasks:
                async def run():
                    async with semaphore:
                        request = anchored_request or WalkingRouteRequest(origin=path.origin, destination=path.destination, route_mode=mode)
                        try:
                            route = await navigation.route_with_snapshot(request, selected_snapshot)
                            if expected_endpoints is not None:
                                ends = (route.geometry.coordinates[0], route.geometry.coordinates[-1])
                                if any(distance_meters(a,b)>1 for a,b in zip(ends,expected_endpoints)):
                                    return CalculatedRoute(None, 'not_assessable', 'comparison_endpoint_changed', 'The route could not retain the same matched endpoints within one metre.')
                            return CalculatedRoute(route, 'available')
                        except NavigationRejected as error:
                            if error.status not in (409, 422):
                                raise
                            reason = 'blocked_endpoint' if error.status == 409 else 'no_supported_route'
                            return CalculatedRoute(None, 'no_route', reason, error.message)
                tasks[key] = asyncio.create_task(run())
            return await tasks[key]

        async def compare_path(path, mode):
            reference = await calculate(path, mode, reference_snapshot)
            if mode == 'accessible' and reference.route is None and not navigation.uses_resident_facilities:
                unknown = CalculatedRoute(None, 'not_assessable', 'no_verified_accessible_reference', reference.details)
                return path, mode, unknown, unknown, {p.id: unknown for p in body.plans}
            if reference.route is None:
                reason = 'no_simulated_step_free_reference' if mode == 'accessible' else 'no_fixed_reference_endpoints'
                unknown = CalculatedRoute(None, 'not_assessable', reason, reference.details)
                return path, mode, unknown, unknown, {p.id: unknown for p in body.plans}
            anchored_request = None
            expected_endpoints = None
            if reference.route is not None:
                a,b = reference.route.geometry.coordinates[0],reference.route.geometry.coordinates[-1]
                expected_endpoints = (a,b)
                anchored_request = WalkingRouteRequest(origin={'longitude':a[0],'latitude':a[1]},
                    destination={'longitude':b[0],'latitude':b[1]},route_mode=mode)
                anchors[(path.id,mode)] = (anchored_request.origin,anchored_request.destination)
                if navigation.uses_resident_facilities:
                    # This graph chooses access deterministically, independently
                    # of damage. Repeat the original request to retain the SAME
                    # graph anchors: a snapped building boundary can belong to a
                    # neighbouring footprint when treated as a fresh selection.
                    anchored_request = WalkingRouteRequest(origin=path.origin, destination=path.destination, route_mode=mode)
            # The damage-free reference is already the shortest route on the
            # same graph. If all remaining restrictions leave it clear, another
            # graph search cannot improve it, regardless of the repair plan.
            before = (reference if navigation.uses_resident_facilities and route_clear(reference.route, path, before_snapshot)
                      else await calculate(path, mode, before_snapshot, anchored_request, expected_endpoints))
            after = {}
            for plan in body.plans:
                target = plan_snapshots[plan.id]
                after[plan.id] = (reference if navigation.uses_resident_facilities and route_clear(reference.route, path, target)
                                  else await calculate(path, mode, target, anchored_request, expected_endpoints))
            # Every candidate was validated by NavigationService for this exact
            # origin/destination pair, mode, and frozen network. Revalidate its
            # whole geometry against each target's remaining damage zones.
            # A shared feasible pool makes relaxed restrictions monotonic without
            # clamping numbers or inventing a shorter geometry.
            pool = [item.route for item in [reference, before, *after.values()] if item.route is not None]
            def best_for(original, target_snapshot):
                feasible = []
                for route in pool:
                    if expected_endpoints is not None:
                        if any(distance_meters(a,b)>1 for a,b in zip((route.geometry.coordinates[0],route.geometry.coordinates[-1]),expected_endpoints)):
                            continue
                    if route_clear(route, path, target_snapshot):
                        feasible.append(route)
                if not feasible:
                    if original.route is not None:
                        return CalculatedRoute(None, 'no_route', 'remaining_damage_intersection', 'Every validated route still intersects an unrepaired restriction or its endpoint approach.')
                    return original
                route = min(feasible, key=lambda item: (item.distance_meters, item.duration_seconds))
                route = route.model_copy(update={
                    'obstacle_count': len({i.issue_id for i in target_snapshot.items}),
                    'obstacle_snapshot_at': target_snapshot.checked_at,
                    'community_issue_avoidance': 'applied' if target_snapshot.items else 'no_active_obstacles',
                })
                return CalculatedRoute(route, 'available')
            reference = best_for(reference, reference_snapshot)
            before = best_for(before, before_snapshot)
            after = {p.id: best_for(after[p.id], plan_snapshots[p.id]) for p in body.plans}
            return path, mode, reference, before, after

        def zone_bounds_from_ring(ring):
            return ring[0][0], ring[0][1], ring[2][0], ring[2][1]

        workers = [asyncio.create_task(compare_path(path, mode)) for path in body.paths for mode in body.route_modes]
        try:
            comparisons = await asyncio.gather(*workers)
            # Compute a walking reference even for accessible-only requests, but
            # only when an accessible before/after route is unavailable.
            fallback_workers = []
            if 'accessible' in body.route_modes and 'avoid_damage' not in body.route_modes:
                for path, mode, _, before, after in comparisons:
                    if mode == 'accessible' and (before.route is None or any(i.route is None for i in after.values())):
                        fallback_workers.append(asyncio.create_task(compare_path(path, 'avoid_damage')))
            workers.extend(fallback_workers)
            hidden = await asyncio.gather(*fallback_workers)
            walking = {path.id: (reference, before, after)
                       for path, mode, reference, before, after in [*comparisons, *hidden] if mode == 'avoid_damage'}
        finally:
            # A timeout/provider failure cannot leave detached work running in the background.
            pending = [task for task in [*workers, *tasks.values()] if not task.done()]
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

        points_used = 0
        def route_geometry(route):
            nonlocal points_used
            geometry = route.geometry if body.include_geometry else None
            if geometry is not None:
                points_used += len(geometry.coordinates)
                if points_used > 50_000:
                    raise WhatIfRejected(422, 'Comparison geometry exceeds the supported limit; retry with include_geometry=false')
            return geometry

        def project(calculated, walking_reference=None):
            if calculated.route is None:
                fallback = None
                if walking_reference is not None and walking_reference.route is not None:
                    route = walking_reference.route
                    fallback = WalkingReference(distance_meters=route.distance_meters,
                        duration_seconds=route.duration_seconds, geometry=route_geometry(route),
                        data_source=route.data_source)
                return RouteOutcome(state=calculated.state, reason=calculated.reason, details=calculated.details, fallback=fallback)
            route = calculated.route
            geometry = route_geometry(route)
            return RouteOutcome(state='available', distance_meters=route.distance_meters,
                                duration_seconds=route.duration_seconds, geometry=geometry,
                                data_source=route.data_source, field_verified=route.field_verified)

        baseline = [BaselinePath(path_id=path.id, path_name=path.name, route_mode=mode,
                                 requested_origin=path.origin, requested_destination=path.destination,
                                 comparison_origin=anchors.get((path.id,mode),(None,None))[0],
                                 comparison_destination=anchors.get((path.id,mode),(None,None))[1],
                                 current=project(before, walking[path.id][1] if mode == 'accessible' and path.id in walking else None),
                                 reference_without_damage=project(reference))
                    for path, mode, reference, before, _ in comparisons]
        results = []
        for plan in body.plans:
            facilities = {r.facility_id for r in plan.repairs}
            selected_issues = [i for i in snapshot.issues if i.facility_id in facilities and i.review_ticket_id is not None]
            facility_hits = {fid: set() for fid in facilities}
            impacts = []
            for path, mode, reference, before, after_by_plan in comparisons:
                after = after_by_plan[plan.id]
                hits = set()
                if reference.route is not None:
                    coordinates = [(path.origin.longitude, path.origin.latitude),
                                   *reference.route.geometry.coordinates,
                                   (path.destination.longitude, path.destination.latitude)]
                    for issue in selected_issues:
                        if issue.affects_routes and any(route_intersects_zone(coordinates, zone_bounds_from_ring(ring)) for ring in rings_by_issue[issue.id]):
                            hits.add(issue.facility_id)
                            facility_hits[issue.facility_id].add(path.id)
                comparable = before.route is not None and after.route is not None
                saved = before.route.distance_meters - after.route.distance_meters if comparable else None
                time_saved = before.route.duration_seconds - after.route.duration_seconds if comparable else None
                if before.state == 'not_assessable' or after.state == 'not_assessable':
                    effect = 'not_assessable'
                elif before.route is None:
                    effect = 'restored' if after.route is not None else 'still_unavailable'
                elif after.route is None:
                    # A healthy provider must not quietly describe a new failure as an improvement.
                    effect = 'lost_route'
                elif saved >= 1.0:
                    effect = 'shortened'
                elif saved <= -1.0:
                    effect = 'longer'
                else:
                    effect = 'unchanged'
                impacts.append(PathImpact(path_id=path.id, path_name=path.name, route_mode=mode,
                    after=project(after, walking[path.id][2][plan.id] if mode == 'accessible' and path.id in walking else None), effect=effect,
                    explanation=('Selected repairs do not intersect the fixed-endpoint reference route; a nearby facility marker does not imply this path is blocked.' if effect=='unchanged' and not hits else
                        'The same route remains the shortest validated candidate after these repairs; other restrictions or network connections may still limit this journey.' if effect=='unchanged' else None),
                    distance_saved_meters=round(saved, 3) if saved is not None else None,
                    duration_saved_seconds=round(time_saved, 3) if time_saved is not None else None,
                    reference_intersects_selected_repairs=bool(hits) if reference.route is not None else None,
                    reference_intersecting_facility_ids=sorted(hits, key=str)))

            summaries = []
            for mode in body.route_modes:
                rows = [r for r in impacts if r.route_mode == mode]
                old = [r for r in baseline if r.route_mode == mode]
                summaries.append(ModeSummary(route_mode=mode, designated_path_count=len(body.paths),
                    reference_assessable_path_count=sum(r.reference_without_damage.state == 'available' for r in old),
                    affected_major_path_count=sum(r.reference_intersects_selected_repairs is True for r in rows),
                    restored_path_count=sum(r.effect == 'restored' for r in rows),
                    shortened_path_count=sum(r.effect == 'shortened' for r in rows),
                    improved_path_count=sum(r.effect in ('restored', 'shortened') for r in rows),
                    longer_path_count=sum(r.effect == 'longer' for r in rows),
                    lost_route_count=sum(r.effect == 'lost_route' for r in rows),
                    not_assessable_path_count=sum(r.effect == 'not_assessable' for r in rows),
                    baseline_available_path_count=sum(r.current.state == 'available' for r in old),
                    after_available_path_count=sum(r.after.state == 'available' for r in rows),
                    distance_saved_on_comparable_paths_meters=round(sum(r.distance_saved_meters or 0 for r in rows), 3)))
            # A management-entered amount wins. A null amount asks the backend
            # for the current source-backed estimate from this same frozen snapshot.
            costs = [(r.facility_id, r.estimated_cost_myr if r.estimated_cost_myr is not None
                      else by_facility[r.facility_id][0].estimated_cost_myr) for r in plan.repairs]
            subtotal = sum((cost for _, cost in costs if cost is not None), Decimal('0.00'))
            missing = [facility_id for facility_id, cost in costs if cost is None]
            total = None if missing else subtotal.quantize(Decimal('0.01'))
            budget_status = ('unknown_cost' if missing else 'not_set' if body.budget_myr is None
                             else 'within_budget' if total <= body.budget_myr else 'over_budget')
            results.append(PlanResult(id=plan.id, name=plan.name, total_estimated_cost_myr=total,
                known_estimated_subtotal_myr=subtotal.quantize(Decimal('0.01')),
                missing_cost_facility_ids=missing, budget_status=budget_status,
                repaired_issue_count=len(selected_issues), remaining_road_obstacle_count=len({i.issue_id for i in plan_snapshots[plan.id].items}),
                affected_major_path_count=len({r.path_id for r in impacts if r.reference_intersects_selected_repairs is True}),
                improved_major_path_count=len({r.path_id for r in impacts if r.effect in ('restored', 'shortened')}),
                facility_impacts=[FacilityImpact(facility_id=fid, facility_name=by_facility[fid][0].facility_name,
                    repaired_issue_ids=[i.id for i in by_facility[fid]], affects_routes=by_facility[fid][0].affects_routes,
                    reference_intersecting_major_path_ids=sorted(facility_hits[fid])) for fid in sorted(facilities, key=str)],
                summaries=summaries, paths=impacts))
        return CompareResponse(simulation_id=uuid4(), generated_at=datetime.now(timezone.utc), snapshot_at=snapshot.checked_at,
            budget_myr=body.budget_myr, baseline_road_obstacle_count=len({i.issue_id for i in before_snapshot.items}), routing_restrictions=restrictions, baseline=baseline, plans=results,
            warnings=[
                'Simulation only; do not use these routes for live navigation.',
                *(['Walking simulations share the resident app facility model, including hypothetical crossings, bridges, ramps and entrances; these are not field verified.'] if navigation.uses_resident_facilities else []),
                *(['Accessible comparisons use simulated step-free facilities from the resident demo map; these routes are not surveyed or safe to use as verified accessibility guidance.'] if navigation.uses_resident_facilities and 'accessible' in body.route_modes else []),
                'Paths are management-defined journeys, counted once across route modes.',
                'Affected paths cross selected damage zones on the damage-free reference route.',
                'Before and after routes share fixed endpoints.',
                'Facility zones are approximate unless linked to mapped road segments.',
                'Each plan keeps the shortest valid route around remaining damage.',
                'Unverified walking references and unassessed links do not count as accessible.',
                'MYR estimates prefer verified completed-repair medians, then provisional benchmarks; management overrides take precedence and missing prices remain unknown.',
                'Repair benefits are measured per plan within the KL East pilot.',
            ])
