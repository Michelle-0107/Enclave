"""Resolve selected map points to nearby named OSM road sections."""

import math
import re

import httpx
from pydantic import BaseModel, ConfigDict, Field


class LocationName(BaseModel):
    model_config = ConfigDict(extra='forbid')
    matched: bool
    name: str | None = Field(default=None, min_length=1, max_length=250)


class LocationNamesUnavailable(RuntimeError):
    pass


def _distance_to_segment(point, start, end):
    """Return a local metric distance from a lon/lat point to one segment."""
    reference_latitude = math.radians(point[1])
    scale_x = 111_320 * math.cos(reference_latitude)
    scale_y = 110_574
    px, py = point[0] * scale_x, point[1] * scale_y
    ax, ay = start[0] * scale_x, start[1] * scale_y
    bx, by = end[0] * scale_x, end[1] * scale_y
    dx, dy = bx - ax, by - ay
    length_squared = dx * dx + dy * dy
    ratio = 0 if length_squared == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length_squared))
    return math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy))


def _geometry_distance(point, coordinates):
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    best = None
    previous = None
    for coordinate in coordinates:
        if (not isinstance(coordinate, list) or len(coordinate) < 2
                or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in coordinate[:2])
                or abs(coordinate[0]) > 180 or abs(coordinate[1]) > 90):
            return None
        current = (float(coordinate[0]), float(coordinate[1]))
        if previous is not None:
            distance = _distance_to_segment(point, previous, current)
            best = distance if best is None else min(best, distance)
        previous = current
    return best


class MapLocationNamesRepository:
    """Read only the nearby portion of the shared map-location catalog."""

    def __init__(self, settings, *, transport=None):
        self.url = settings.project_url + '/rest/v1/map_locations'
        self.key = settings.api_key
        self.client = httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    async def resolve(self, area, latitude, longitude):
        west, south, east, north = area.bbox
        if not west <= longitude <= east or not south <= latitude <= north:
            return LocationName(matched=False)

        # Road seed rows are midpoint-indexed and each section is at most 100 m;
        # this window contains sections that can pass within the 25 m match limit.
        radius_meters = 80
        latitude_delta = radius_meters / 110_574
        longitude_delta = radius_meters / max(1, 111_320 * math.cos(math.radians(latitude)))
        params = [
            ('select', 'area_id,name,latitude,longitude,kind,active,metadata'),
            ('area_id', 'eq.' + area.id), ('active', 'eq.true'), ('kind', 'eq.road_section'),
            ('latitude', 'gte.' + str(max(south, latitude - latitude_delta))),
            ('latitude', 'lte.' + str(min(north, latitude + latitude_delta))),
            ('longitude', 'gte.' + str(max(west, longitude - longitude_delta))),
            ('longitude', 'lte.' + str(min(east, longitude + longitude_delta))),
            ('limit', '500'),
        ]
        try:
            headers = {'apikey': self.key, 'Accept-Profile': 'public'}
            if not self.key.startswith('sb_secret_'):
                headers['Authorization'] = 'Bearer ' + self.key
            response = await self.client.get(self.url, headers=headers, params=params)
            if response.status_code == 404:
                try:
                    code = response.json().get('code')
                except (ValueError, AttributeError):
                    code = None
                if code in ('PGRST205', '42P01'):
                    return LocationName(matched=False)
            if response.status_code != 200:
                raise LocationNamesUnavailable()
            rows = response.json()
            if not isinstance(rows, list) or len(rows) > 500 or not all(isinstance(row, dict) for row in rows):
                raise LocationNamesUnavailable()
        except (httpx.HTTPError, ValueError, TypeError):
            raise LocationNamesUnavailable() from None

        point = (longitude, latitude)
        nearest = None
        for row in rows:
            if row.get('area_id') != area.id or row.get('kind') != 'road_section' or row.get('active') is not True:
                raise LocationNamesUnavailable()
            metadata = row.get('metadata')
            section = metadata.get('road_section') if isinstance(metadata, dict) else None
            if not isinstance(section, dict):
                continue
            name = section.get('road_name')
            if not isinstance(name, str):
                continue
            name = re.sub(r'\s+', ' ', name).strip()
            if not name or name.casefold().startswith('unnamed'):
                continue
            distance = _geometry_distance(point, section.get('geometry'))
            if distance is not None and (nearest is None or distance < nearest[0]):
                nearest = (distance, name)
        if nearest is None or nearest[0] > 25:
            return LocationName(matched=False)
        return LocationName(matched=True, name=nearest[1])


__all__ = ['LocationName', 'LocationNamesUnavailable', 'MapLocationNamesRepository']
