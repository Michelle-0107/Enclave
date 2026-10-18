"""Search a server-owned OSM place/address catalogue within one service area."""
from functools import lru_cache
import json
from pathlib import Path
import re
from typing import Literal
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field

from .areas import ServiceArea


class MapPlace(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    area_id: str
    name: str = Field(min_length=1, max_length=250)
    address: str = Field(max_length=1000)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    position_basis: str = Field(max_length=250)
    source: Literal['openstreetmap'] = 'openstreetmap'


class PlaceSearchResult(BaseModel):
    area_id: str
    items: list[MapPlace]
    storage: Literal['database', 'bundled_catalog']
    attribution: str = 'OpenStreetMap contributors (ODbL)'


class PlacesUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def bundled_places() -> tuple[MapPlace, ...]:
    path = Path(__file__).resolve().parents[1] / 'data' / 'map_places.json'
    return tuple(MapPlace.model_validate(row) for row in json.loads(path.read_text(encoding='utf-8')))


def inside(place: MapPlace, area: ServiceArea) -> bool:
    west, south, east, north = area.bbox
    return place.area_id == area.id and west <= place.longitude <= east and south <= place.latitude <= north


def search_catalog(query: str, area: ServiceArea, limit: int = 8) -> list[MapPlace]:
    tokens = re.findall(r'[^\W_]+', query.casefold())
    if not tokens:
        return []
    value = ' '.join(tokens)
    rows = [row for row in bundled_places() if inside(row, area)
            and all(token in (row.name + ' ' + row.address).casefold() for token in tokens)]
    return sorted(rows, key=lambda row: (row.name.casefold() != value,
                  not row.name.casefold().startswith(value), len(row.name), row.name, str(row.id)))[:limit]


class PlacesRepository:
    def __init__(self, settings, *, transport=None):
        self.url = settings.project_url + '/rest/v1/rpc/search_map_places'
        self.key = settings.api_key
        self.client = httpx.AsyncClient(timeout=8, follow_redirects=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    async def search(self, token: str, area: ServiceArea, query: str) -> PlaceSearchResult:
        try:
            response = await self.client.post(self.url,
                headers={'apikey': self.key, 'Authorization': 'Bearer ' + token},
                json={'p_area_id': area.id, 'p_query': query, 'p_limit': 8})
            # Older backends/databases remain usable during a rolling deployment.
            # Auth, connectivity and malformed responses must never masquerade as an empty result.
            if response.status_code == 404 and response.json().get('code') in ('PGRST202', 'PGRST205', '42P01'):
                return PlaceSearchResult(area_id=area.id, items=search_catalog(query, area), storage='bundled_catalog')
            if response.status_code != 200:
                raise PlacesUnavailable()
            payload = response.json()
            if not isinstance(payload, list) or len(payload) > 8:
                raise PlacesUnavailable()
            rows = [MapPlace.model_validate(row) for row in payload]
            if any(not inside(row, area) for row in rows) or len({row.id for row in rows}) != len(rows):
                raise PlacesUnavailable()
            if not rows:
                bundled = search_catalog(query, area)
                if bundled:
                    return PlaceSearchResult(area_id=area.id, items=bundled, storage='bundled_catalog')
            return PlaceSearchResult(area_id=area.id, items=rows, storage='database')
        except (httpx.RequestError, ValueError, TypeError, AttributeError):
            raise PlacesUnavailable() from None
