"""One database-owned geography catalogue for residents and staff."""
from typing import Literal
from uuid import UUID
import httpx
from pydantic import BaseModel, Field
from fastapi import HTTPException

class SharedLocation(BaseModel):
    id: UUID
    area_id: str
    name: str = Field(min_length=1,max_length=250)
    address: str = ''
    latitude: float = Field(ge=-90,le=90,allow_inf_nan=False)
    longitude: float = Field(ge=-180,le=180,allow_inf_nan=False)
    kind: Literal['place','road_section','facility']
    source: Literal['openstreetmap','community']
    position_basis: str
    metadata: dict = Field(default_factory=dict)
    distance_meters: float | None = Field(default=None,ge=0,allow_inf_nan=False)

class LocationResult(BaseModel):
    area_id: str
    items: list[SharedLocation]
    storage: Literal['database'] = 'database'
    limit: int
    offset: int
    has_more: bool
    attribution: str = 'OpenStreetMap contributors (ODbL)'

class LocationsUnavailable(RuntimeError): pass
class LocationsNotInstalled(LocationsUnavailable): pass

class LocationsRepository:
    def __init__(self,settings,*,transport=None):
        self.url=settings.project_url+'/rest/v1/rpc/enclave_map_locations'
        self.headers={'apikey':settings.api_key,'Content-Profile':'public'}
        if not settings.api_key.startswith('sb_secret_'): self.headers['Authorization']='Bearer '+settings.api_key
        self.client=httpx.AsyncClient(timeout=8,follow_redirects=False,trust_env=False,transport=transport)

    async def close(self): await self.client.aclose()

    async def call(self,action,**args):
        try:
            response=await self.client.post(self.url,headers=self.headers,json={'p_action':action,'p_args':args})
            if response.status_code==404 and response.json().get('code') in ('PGRST202','PGRST205','42P01'): raise LocationsNotInstalled()
            if response.status_code!=200: raise LocationsUnavailable()
            data=response.json()
            if data.get('state')=='forbidden': raise HTTPException(403,'Active resident or staff access required')
            if data.get('state')=='invalid': raise HTTPException(422,'Invalid location lookup')
            if data.get('state')!='ok' or not isinstance(data.get('items'),list): raise LocationsUnavailable()
            return data['items']
        except (httpx.HTTPError,ValueError,TypeError,AttributeError): raise LocationsUnavailable() from None

    async def listing(self,action,actor_id,area,*,limit=20,offset=0,**args):
        rows=await self.call(action,actor_id=str(actor_id),area_id=area.id,limit=limit+1,offset=offset,**args)
        try:
            items=[SharedLocation.model_validate(p) for p in rows]
            w,s,e,n=area.bbox
            if len(items)>limit+1 or len({p.id for p in items})!=len(items) or any(p.area_id!=area.id or not(w<=p.longitude<=e and s<=p.latitude<=n) for p in items): raise LocationsUnavailable()
            return LocationResult(area_id=area.id,items=items[:limit],limit=limit,offset=offset,has_more=len(items)>limit)
        except ValueError: raise LocationsUnavailable() from None

    async def labels(self,records):
        if not records: return records
        try:
            values=await self.call('labels',points=[{'ticket_id':r.ticket_id,'latitude':r.latitude,'longitude':r.longitude} for r in records])
            if len(values)!=len(records): raise LocationsUnavailable()
            updates=[]
            for row in values:
                if not isinstance(row,dict): raise LocationsUnavailable()
                name=row.get('location_name'); address=row.get('location_address'); ident=row.get('location_id')
                if (name is not None and (not isinstance(name,str) or len(name)>300)) or (address is not None and (not isinstance(address,str) or len(address)>1000)): raise LocationsUnavailable()
                updates.append(dict(location_id=UUID(ident) if ident else None,location_name=name,location_address=address,location_storage='database'))
            return [r.model_copy(update=update) for r,update in zip(records,updates)]
        except (LocationsUnavailable,ValueError,TypeError):
            # Reading existing reports remains possible during rollout/outage, with explicit status.
            return [r.model_copy(update={'location_storage':'unavailable'}) for r in records]
