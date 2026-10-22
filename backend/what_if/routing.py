"""Use the resident facility model for hypothetical walking comparisons only."""
from starlette.concurrency import run_in_threadpool

from ..navigation.demo_accessibility import demo_step_free_graph, shared_demo_walking_graph
from ..navigation.provider import NavigationRejected,NavigationUnavailable
from ..navigation.service import NavigationService
from ..navigation.zones import point_in_zone


class SimulationNavigation(NavigationService):
    @property
    def uses_resident_facilities(self):
        return (self.provider.settings.source!='synthetic_demo'
                and self.provider.settings.crossing_policy=='mapped_facilities_only')

    async def route_with_snapshot(self,body,snapshot=None):
        # Provider-reader fixtures keep their explicitly selected provider policy.
        if body.route_mode not in ('avoid_damage', 'accessible') or not self.uses_resident_facilities:
            return await super().route_with_snapshot(body,snapshot)
        area=self.validate_locations(body)
        self.validate_area_mode(area,body.route_mode)
        if snapshot is None:raise NavigationUnavailable()
        boxes=[]
        origin=(body.origin.longitude,body.origin.latitude)
        target=(body.destination.longitude,body.destination.latitude)
        for item in snapshot.items:
            ring=item.exclusion_ring
            bounds=(ring[0][0],ring[0][1],ring[2][0],ring[2][1])
            if point_in_zone(origin,bounds) or point_in_zone(target,bounds):
                raise NavigationRejected(409,'Origin or destination is inside a community-reported damaged area; choose another point')
            boxes.append(bounds)
        try:
            graph=await run_in_threadpool(
                demo_step_free_graph if body.route_mode=='accessible' else shared_demo_walking_graph,
                area.id)
        except (OSError,ValueError):
            raise NavigationUnavailable() from None
        # Facilities are registered in the validated manifest. The step-free
        # graph excludes stairs and unassessed links; both retain the <=20m
        # endpoint policy and all barrier checks.
        # Static demo damage is not applied: the one database snapshot supplies
        # every restriction for all plans, including approved/unselected issues.
        return await run_in_threadpool(graph.route,body,snapshot,boxes,area.id,
                                       area.community_issues_supported,demo_mode=True)
