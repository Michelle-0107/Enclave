"""Canonical facility source-road bindings; never guess an unrelated nearest road.

Input records remain community-reported/unverified. Geometry is used only for
matching source identity, type and coordinates: authored demo facilities, canonical
100m sections and legacy OSM road references. Other facilities retain point zones.
"""

from functools import lru_cache
import json
import math
from pathlib import Path

from .contracts import RouteGeometry
from .service import distance_meters
from .zones import zone_bounds, zone_ring, valid_zone


@lru_cache(maxsize=1)
def authored_bindings():
    document = json.loads((Path(__file__).parents[1]/'data/kl_east_report_facilities.json').read_text())
    result = {}
    for item in document['facilities']:
        geometry = RouteGeometry.model_validate(item['affected_segment'])
        if len(geometry.coordinates)>100 or sum(distance_meters(a,b) for a,b in zip(geometry.coordinates,geometry.coordinates[1:]))>100:
            raise ValueError('Demo source segment exceeds supported length')
        result[item['id']] = (item, geometry)
    return result


def restriction_for(issue):
    geometry = None
    binding_source = 'point_only'
    binding = authored_bindings().get(str(issue.facility_id))
    if binding:
        item, candidate = binding
        if (item['facility_type']==issue.facility_type and
            abs(item['latitude']-issue.latitude)<1e-9 and abs(item['longitude']-issue.longitude)<1e-9):
            geometry = candidate
            binding_source = 'mapped_demo_segment'
    if geometry is None and issue.facility_type == 'path_surface':
        from .road_bindings import bound_road_section
        section, source = bound_road_section(issue.facility_id, issue.latitude, issue.longitude)
        if section is not None:
            geometry = RouteGeometry(type='LineString', coordinates=section.geometry)
            binding_source = source
    # Keep the original point coverage, plus cover the complete bound segment
    # with tightly spaced local squares. Never extend to an adjacent road merely
    # to manufacture a simulated improvement.
    centers = [(issue.longitude,issue.latitude)]
    if geometry is not None:
        for a,b in zip(geometry.coordinates,geometry.coordinates[1:]):
            steps = max(1,math.ceil(distance_meters(a,b)/5))
            centers.extend((a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps) for k in range(steps+1))
    rings = []
    for lon,lat in centers:
        if not valid_zone(lat,lon,5):
            raise ValueError('Facility restriction is outside the pilot')
        ring = zone_ring(zone_bounds(lat,lon,5))
        if ring not in rings:
            rings.append(ring)
    return dict(issue_id=issue.id,facility_id=issue.facility_id,facility_name=issue.facility_name,
        latitude=issue.latitude,longitude=issue.longitude,binding_source=binding_source,
        affected_segment=geometry,exclusion_rings=rings)
