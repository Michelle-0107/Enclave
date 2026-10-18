"""Server-owned pilot coverage; no changes to the team's environment contract."""

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit


@dataclass(frozen=True)
class NavigationSettings:
    # A local, separately operated Valhalla service. Deployment owners may inject
    # their private routing-service URL through create_app(navigation_settings=...).
    # Never accept a provider URL from a request or add keys to the mobile app.
    provider_url: str = 'http://127.0.0.1:8002'
    source: Literal['openstreetmap_unverified', 'synthetic_demo'] = 'openstreetmap_unverified'
    # Trusted compatibility setting for engine-reader fixtures; resident live routes default to strict crossings.
    crossing_policy: Literal['mapped_facilities_only','provider_default'] = 'mapped_facilities_only'

    def __post_init__(self):
        if self.crossing_policy not in ('mapped_facilities_only','provider_default'):
            raise ValueError('Unsupported pedestrian crossing policy')
        parsed = urlsplit(self.provider_url)
        if (parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('','/')):
            raise ValueError('Use a trusted HTTP(S) routing service origin')
        object.__setattr__(self,'provider_url',self.provider_url.rstrip('/'))


# Deliberate development window, NOT the legal or management boundary of KL East.
PILOT_BBOX = (101.721, 3.217, 101.741, 3.235)
EXTRACT_BBOX = (101.719, 3.212, 101.745, 3.240)
MAP_CENTER = (101.7308667, 3.2253785)  # OSM node 9555390383, KL East Mall.
MAX_ROUTE_POINTS = 20_000
MAX_PROVIDER_BYTES = 2 * 1024 * 1024
MAX_SNAP_METERS = 50.0


def in_bounds(longitude, latitude, bounds=PILOT_BBOX):
    west,south,east,north = bounds
    return west <= longitude <= east and south <= latitude <= north
