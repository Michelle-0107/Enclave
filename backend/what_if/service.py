"""Compare independent hypothetical repairs against one immutable incident snapshot."""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from ..navigation.accessibility import VerifiedNetwork
from ..navigation.contracts import WalkingRouteRequest
from ..navigation.provider import NavigationRejected, NavigationUnavailable
from ..navigation.service import NavigationService
from ..navigation.zones import zone_bounds, zone_ring, route_intersects_zone
from ..reports.issues import CommunityObstacle, CommunityObstacleSnapshot
from .contracts import (BaselinePath, CompareResponse, FacilityImpact, ModeSummary,
                        PathImpact, PlanResult, RepairCandidates, RouteOutcome, WalkingReference)
from .repository import WhatIfRejected, WhatIfUnavailable


@dataclass(frozen=True)
class CalculatedRoute:
    route: object | None
    state: str
    reason: str | None = None


class WhatIfService:
    def __init__(self, repository, navigation, *, timeout_seconds=45):
        self.repository, self.navigation = repository, navigation
        self.timeout_seconds = timeout_seconds
        self._comparison_slot = asyncio.Lock()

    async def candidates(self, actor_id):
        snapshot = await self.repository.snapshot(actor_id)
        return RepairCandidates(snapshot_at=snapshot.checked_at, issues=snapshot.issues)

    async def compare(self, actor_id, body):
        # Authorize against the current database role before reading candidates or doing work.
        snapshot = await self.repository.snapshot(actor_id)
        if self._comparison_slot.locked():
            raise WhatIfRejected(429, 'Another repair comparison is running; retry shortly')
        async with self._comparison_slot:
            try:
                async with asyncio.timeout(self.timeout_seconds):
                    return await self._compare_snapshot(snapshot, body)
            except (TimeoutError, NavigationUnavailable):
                raise WhatIfUnavailable() from None

    async def _compare_snapshot(self, snapshot, body):
        by_facility = {}
        for issue in snapshot.issues:
            by_facility.setdefault(issue.facility_id, []).append(issue)
        for plan in body.plans:
            if any(r.facility_id not in by_facility for r in plan.repairs):
                raise WhatIfRejected(409, 'A selected facility has no current two-resident issue; refresh repair candidates')

        def obstacles(repaired=frozenset()):
            return CommunityObstacleSnapshot(checked_at=snapshot.checked_at, items=[
                CommunityObstacle(issue_id=i.id, facility_id=i.facility_id, reporter_count=i.reporter_count,
                                  exclusion_ring=zone_ring(zone_bounds(i.latitude, i.longitude, 5)))
                for i in snapshot.issues if i.affects_routes and i.facility_id not in repaired])

        before_snapshot = obstacles()
        reference_snapshot = CommunityObstacleSnapshot(checked_at=snapshot.checked_at, items=[])
        plan_snapshots = {p.id: obstacles({r.facility_id for r in p.repairs}) for p in body.plans}
        network = self.navigation.accessibility
        if 'accessible' in body.route_modes:
            if network is None:
                raise WhatIfUnavailable()
            # Freeze survey data and validity time too, so all plans use the same assumptions.
            network = VerifiedNetwork(document=network.load().model_dump(mode='json'),
                                      assessment_time=snapshot.checked_at)
        navigation = NavigationService(self.navigation.provider, accessibility=network)
        semaphore = asyncio.Semaphore(4)
        tasks = {}

        async def calculate(path, mode, selected_snapshot):
            key = (path.id, mode, tuple(sorted(str(i.issue_id) for i in selected_snapshot.items)))
            if key not in tasks:
                async def run():
                    async with semaphore:
                        request = WalkingRouteRequest(origin=path.origin, destination=path.destination, route_mode=mode)
                        try:
                            route = await navigation.route_with_snapshot(request, selected_snapshot)
                            return CalculatedRoute(route, 'available')
                        except NavigationRejected as error:
                            if error.status not in (409, 422):
                                raise
                            reason = 'blocked_endpoint' if error.status == 409 else 'no_supported_route'
                            return CalculatedRoute(None, 'no_route', reason)
                tasks[key] = asyncio.create_task(run())
            return await tasks[key]

        async def compare_path(path, mode):
            reference = await calculate(path, mode, reference_snapshot)
            if mode == 'accessible' and reference.route is None:
                unknown = CalculatedRoute(None, 'not_assessable', 'no_verified_accessible_reference')
                return path, mode, unknown, unknown, {p.id: unknown for p in body.plans}
            before = await calculate(path, mode, before_snapshot)
            after = {p.id: await calculate(path, mode, plan_snapshots[p.id]) for p in body.plans}
            # Every candidate was validated by NavigationService for this exact
            # origin/destination pair, mode, and frozen network. Revalidate its
            # whole geometry against each target's remaining damage zones.
            # A shared feasible pool makes relaxed restrictions monotonic without
            # clamping numbers or inventing a shorter geometry.
            pool = [item.route for item in [reference, before, *after.values()] if item.route is not None]
            def best_for(original, target_snapshot):
                bounds = [zone_bounds_from_ring(i.exclusion_ring) for i in target_snapshot.items]
                feasible = []
                for route in pool:
                    coordinates = [(path.origin.longitude, path.origin.latitude),
                                   *route.geometry.coordinates,
                                   (path.destination.longitude, path.destination.latitude)]
                    if not any(route_intersects_zone(coordinates, box) for box in bounds):
                        feasible.append(route)
                if not feasible:
                    return original
                route = min(feasible, key=lambda item: (item.distance_meters, item.duration_seconds))
                route = route.model_copy(update={
                    'obstacle_count': len(target_snapshot.items),
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
                return RouteOutcome(state=calculated.state, reason=calculated.reason, fallback=fallback)
            route = calculated.route
            geometry = route_geometry(route)
            return RouteOutcome(state='available', distance_meters=route.distance_meters,
                                duration_seconds=route.duration_seconds, geometry=geometry,
                                data_source=route.data_source, field_verified=route.field_verified)

        baseline = [BaselinePath(path_id=path.id, path_name=path.name, route_mode=mode,
                                 current=project(before, walking[path.id][1] if mode == 'accessible' and path.id in walking else None),
                                 reference_without_damage=project(reference))
                    for path, mode, reference, before, _ in comparisons]
        results = []
        for plan in body.plans:
            facilities = {r.facility_id for r in plan.repairs}
            selected_issues = [i for i in snapshot.issues if i.facility_id in facilities]
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
                        if issue.affects_routes and route_intersects_zone(coordinates, zone_bounds(issue.latitude, issue.longitude, 5)):
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
            subtotal = sum((r.estimated_cost_myr for r in plan.repairs if r.estimated_cost_myr is not None), Decimal('0.00'))
            missing = [r.facility_id for r in plan.repairs if r.estimated_cost_myr is None]
            total = None if missing else subtotal.quantize(Decimal('0.01'))
            budget_status = ('unknown_cost' if missing else 'not_set' if body.budget_myr is None
                             else 'within_budget' if total <= body.budget_myr else 'over_budget')
            results.append(PlanResult(id=plan.id, name=plan.name, total_estimated_cost_myr=total,
                known_estimated_subtotal_myr=subtotal.quantize(Decimal('0.01')),
                missing_cost_facility_ids=missing, budget_status=budget_status,
                repaired_issue_count=len(selected_issues), remaining_road_obstacle_count=len(plan_snapshots[plan.id].items),
                affected_major_path_count=len({r.path_id for r in impacts if r.reference_intersects_selected_repairs is True}),
                improved_major_path_count=len({r.path_id for r in impacts if r.effect in ('restored', 'shortened')}),
                facility_impacts=[FacilityImpact(facility_id=fid, facility_name=by_facility[fid][0].facility_name,
                    repaired_issue_ids=[i.id for i in by_facility[fid]], affects_routes=by_facility[fid][0].affects_routes,
                    reference_intersecting_major_path_ids=sorted(facility_hits[fid])) for fid in sorted(facilities, key=str)],
                summaries=summaries, paths=impacts))
        return CompareResponse(simulation_id=uuid4(), generated_at=datetime.now(timezone.utc), snapshot_at=snapshot.checked_at,
            budget_myr=body.budget_myr, baseline_road_obstacle_count=len(before_snapshot.items), baseline=baseline, plans=results,
            warnings=[
                'Simulation only: no reports, incidents, repair states, or saved scenarios were changed. Do not use hypothetical routes for live navigation.',
                'Major paths are management-defined origin/destination pairs, not measured user journeys or a count of physical road segments.',
                'Affected counts intersect selected facility zones with a reference route ignoring all incident damage; improved counts compare current versus this repair plan only.',
                'Each comparison rechecks all validated route candidates against remaining restrictions; a still-valid shorter route is retained when repairs only remove obstacles.',
                'Accessible fallback routes are unverified avoid-damage walking references only; they are excluded from accessible availability and improvement counts.',
                'Route modes are summarized separately. Overall path counts deduplicate the same path ID across modes; no resident population or traffic volume is inferred.',
                'Costs are management-entered estimates in MYR, not provider quotations. Missing costs remain unknown; amounts are serialized as decimal strings.',
                'Unknown, unassessed, or inaccessible links never become accessible merely because a damaged facility is repaired. Missing accessible reference routes are not assessable.',
                'Road geometry and damage zones retain the KL East pilot limitations. Joint repair benefits cannot be attributed independently to each selected facility.',
            ])
