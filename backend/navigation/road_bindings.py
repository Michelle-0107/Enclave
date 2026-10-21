"""Canonical road references derived from OSM identity, never display-name matching."""
from functools import lru_cache
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5
import json
import xml.etree.ElementTree as ET
from .service import distance_meters

@lru_cache(maxsize=1)
def road_reference_bindings():
    from ..reports.road_sections import catalog, HIGHWAYS
    root = Path(__file__).resolve().parents[1]
    places = {row['id']: row for row in json.loads((root/'data/map_places.json').read_text(encoding='utf-8'))}
    by_way = {}
    for section in catalog().values():
        by_way.setdefault((section.road_section.area_id, section.road_section.osm_way_id), []).append(section)
    result = {}
    for area_id in sorted({key[0] for key in by_way}):
        document = ET.parse(root/'data/demo_areas'/f'{area_id}.osm').getroot()
        for way in document.findall('way'):
            tags = {tag.attrib['k']: tag.attrib['v'] for tag in way.findall('tag')}
            if tags.get('highway') not in HIGHWAYS or tags.get('area') == 'yes':
                continue
            ident = str(uuid5(NAMESPACE_URL, f"enclave:{area_id}:osm:way:{way.attrib['id']}"))
            place = places.get(ident)
            sections = by_way.get((area_id, way.attrib['id']), [])
            if not place or not sections:
                continue
            # This is an existing whole-road reference, not a new report target.
            # Bind legacy incidents to the closest actual section of the SAME OSM way.
            point = (place['longitude'], place['latitude'])
            section = min(sections, key=lambda s: distance_to_geometry(point, s.road_section.geometry))
            # A road-reference centroid may be off its polyline. Its OSM way UUID
            # still supplies the road identity; this creates no access connector.
            result[UUID(ident)] = dict(id=ident, latitude=place['latitude'], longitude=place['longitude'],
                section_id=str(section.id), road_section=section.road_section.model_dump(mode='json'))
    return result

def distance_to_geometry(point, geometry):
    import math
    sx = 111195.08 * math.cos(math.radians(point[1])); sy = 111195.08
    best = float('inf')
    for a, b in zip(geometry, geometry[1:]):
        ax, ay = (a[0]-point[0])*sx, (a[1]-point[1])*sy
        dx, dy = (b[0]-a[0])*sx, (b[1]-a[1])*sy
        length = dx*dx + dy*dy
        t = max(0, min(1, -(ax*dx+ay*dy)/length)) if length else 0
        best = min(best, math.hypot(ax+t*dx, ay+t*dy))
    return best

def bound_road_section(facility_id, latitude, longitude):
    from ..reports.road_sections import catalog
    point = catalog().get(facility_id)
    if point and abs(point.latitude-latitude)<1e-9 and abs(point.longitude-longitude)<1e-9:
        return point.road_section, 'mapped_road_section'
    reference = road_reference_bindings().get(facility_id)
    if reference and abs(reference['latitude']-latitude)<1e-9 and abs(reference['longitude']-longitude)<1e-9:
        from ..reports.road_sections import RoadSection
        return RoadSection.model_validate(reference['road_section']), 'mapped_road_reference'
    return None, None
