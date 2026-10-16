"""Loopback-only local Valhalla gateway, separate from the JWT-protected backend."""

from contextlib import asynccontextmanager
import json
from pathlib import Path
import sys
from threading import Lock
from typing import Literal

from fastapi import FastAPI,HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field,model_validator

from .zones import MAX_OBSTACLES,zone_bounds,valid_zone

ROOT=Path(__file__).resolve().parent


class EngineLocation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    lat: float=Field(ge=-90,le=90,allow_inf_nan=False)
    lon: float=Field(ge=-180,le=180,allow_inf_nan=False)
    type: Literal['break']='break'
    radius: Literal[50]=50
    search_cutoff: Literal[100]=100


class DirectionsOptions(BaseModel):
    model_config=ConfigDict(extra='forbid')
    units: Literal['kilometers']='kilometers'
    language: Literal['en-US']='en-US'


class EngineRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    locations: list[EngineLocation]=Field(min_length=2,max_length=2)
    costing: Literal['pedestrian']='pedestrian'
    directions_options: DirectionsOptions
    directions_type: Literal['instructions']='instructions'
    costing_options: dict = Field(default_factory=lambda:{'pedestrian':{'shortest':True}})
    exclude_polygons: list[list[tuple[float,float]]]=Field(default_factory=list,max_length=MAX_OBSTACLES)

    @model_validator(mode='after')
    def exclusion_squares(self):
        if self.costing_options!={'pedestrian':{'shortest':True}}:
            raise ValueError('Only distance-based walking costs are supported')
        # Only small, server-created pilot rectangles; reject arbitrary polygons.
        for ring in self.exclude_polygons:
            if len(ring)!=5 or ring[0]!=ring[-1]:
                raise ValueError('Invalid exclusion square')
            w,s=ring[0]; e,n=ring[2]
            if ring!=[(w,s),(e,s),(e,n),(w,n),(w,s)] or not w<e or not s<n:
                raise ValueError('Invalid exclusion square')
            lat,lon=(s+n)/2,(w+e)/2
            half=(n-s)*111195.08/2
            if not 2.9999<=half<=30.0001 or not valid_zone(lat,lon,min(30,max(3,half))):
                raise ValueError('Invalid exclusion square')
            expected=zone_bounds(lat,lon,half)
            if abs(expected[0]-w)>1e-9 or abs(expected[2]-e)>1e-9:
                raise ValueError('Invalid exclusion square')
        return self


@asynccontextmanager
async def lifespan(app):
    pointer=ROOT/'.runtime/engine.json'
    if not pointer.exists():
        raise RuntimeError('Run python -m backend.navigation.prepare before starting the local engine')
    metadata=json.loads(pointer.read_text(encoding='utf-8'))
    config=Path(metadata['config_path']).resolve()
    if (ROOT/'.runtime').resolve() not in config.parents:
        raise RuntimeError('Routing configuration must stay within its owned runtime directory')
    sys.path.insert(0,str(ROOT/'.runtime/packages'))
    import valhalla
    app.state.actor=valhalla.Actor(str(config))
    app.state.error_type=valhalla.ValhallaError
    app.state.lock=Lock()
    yield


app=FastAPI(title='Enclave private local routing engine',lifespan=lifespan,docs_url=None,redoc_url=None)


@app.get('/health')
def health():
    return {'status':'ok','engine':'valhalla','scope':'kl-east-pilot'}


@app.post('/route')
def route(body: EngineRequest):
    try:
        with app.state.lock:
            return app.state.actor.route(body.model_dump())
    except app.state.error_type as error:
        return JSONResponse(status_code=400 if error.http_code in (400,404) else 503,
            content={'error_code':error.code,'error':'Walking route unavailable'})
    except RuntimeError:
        raise HTTPException(503,'Routing engine unavailable') from None


if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8002)
