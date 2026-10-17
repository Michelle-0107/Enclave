"""Bounded Valhalla pedestrian directions reader with generic errors."""

import json

import httpx

from .config import MAX_PROVIDER_BYTES,MAX_ROUTE_POINTS,NavigationSettings


class NavigationUnavailable(RuntimeError):
    pass


class NavigationRejected(Exception):
    def __init__(self,status,message):
        self.status,self.message = status,message


def decode_polyline6(value):
    if not isinstance(value,str) or not value or len(value) > MAX_ROUTE_POINTS*14:
        raise ValueError('Invalid route shape')
    cursor=0
    latitude=longitude=0
    points=[]
    while cursor < len(value):
        deltas=[]
        for _ in range(2):
            number=shift=0
            while True:
                if cursor >= len(value) or shift > 30:
                    raise ValueError('Invalid route shape')
                byte=ord(value[cursor])-63
                cursor+=1
                if not 0 <= byte <= 63:
                    raise ValueError('Invalid route shape')
                number |= (byte & 31) << shift
                if byte < 32:
                    break
                shift+=5
            deltas.append(~(number >> 1) if number & 1 else number >> 1)
        latitude+=deltas[0]
        longitude+=deltas[1]
        if not -90_000_000 <= latitude <= 90_000_000 or not -180_000_000 <= longitude <= 180_000_000:
            raise ValueError('Invalid route coordinates')
        points.append((longitude/1_000_000,latitude/1_000_000))
        if len(points)>MAX_ROUTE_POINTS:
            raise ValueError('Route shape too large')
    if len(points)<2:
        raise ValueError('Route shape too short')
    return points


class ValhallaProvider:
    def __init__(self,settings: NavigationSettings,*,transport=None):
        self.settings=settings
        self.client=httpx.AsyncClient(timeout=12,follow_redirects=False,trust_env=False,transport=transport)

    async def close(self):
        await self.client.aclose()

    async def route(self,body,*,exclude_polygons=None,fixed_snap=False):
        payload={'locations':[{'lat':p.latitude,'lon':p.longitude,'type':'break','radius':50,'search_cutoff':100}
                              for p in (body.origin,body.destination)],
                 'costing':'pedestrian','directions_options':{'units':'kilometers','language':'en-US'},
                 'costing_options':{'pedestrian':{'shortest':True}},
                 'directions_type':'instructions'}
        if fixed_snap:
            for location in payload['locations']:
                location.update(radius=0,node_snap_tolerance=0)
        if exclude_polygons:
            payload['exclude_polygons']=exclude_polygons
        try:
            async with self.client.stream('POST',self.settings.provider_url+'/route',json=payload) as response:
                content=bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content)>MAX_PROVIDER_BYTES:
                        raise NavigationUnavailable()
                data=json.loads(content,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite response')))
                if not isinstance(data,dict):
                    raise NavigationUnavailable()
                if response.status_code in (400,404) and data.get('error_code') in (170,171,172,173,442,443,444):
                    raise NavigationRejected(422,'No walking route is available for these locations')
                if response.status_code != 200:
                    raise NavigationUnavailable()
                return data
        except (httpx.HTTPError,ValueError,TypeError,RecursionError,OverflowError):
            raise NavigationUnavailable() from None
