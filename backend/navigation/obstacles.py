"""Private, role-checked SQL RPC for reviewed report routing impact."""

from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from .contracts import Location
from .zones import MAX_OBSTACLES, valid_zone, zone_bounds, zone_ring

ReportState = Literal['pending','approved','in_progress','resolved','rejected']
Ticket = str


class ObstacleUnavailable(RuntimeError):
    pass


class ObstacleRejected(Exception):
    def __init__(self,status,message):
        self.status,self.message=status,message


class RoutingImpactUpdate(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    expected_version: int=Field(ge=0,le=2_000_000_000,strict=True,
        description='Use version from GET routing-impact; zero means no record yet.')
    expected_report_status: ReportState
    impact: Literal['blocked','none']
    center: Location | None=None
    half_width_meters: float | None=Field(default=None,ge=3,le=30,strict=True,allow_inf_nan=False,
        description='Half the side length of an exclusion square, in meters (3 to 30).')
    expires_at: datetime | None=None
    note: str=Field(min_length=1,max_length=1000,description='Management-only routing confirmation note.')

    @model_validator(mode='after')
    def validate_impact(self):
        if self.impact=='blocked':
            if (self.expected_report_status not in ('approved','in_progress') or self.center is None
                or self.half_width_meters is None or self.expires_at is None or self.expires_at.tzinfo is None):
                raise ValueError('Blocked areas require an approved active report, center, width, and timezone-aware expiry')
            now=datetime.now(timezone.utc)
            if not now+timedelta(minutes=1) <= self.expires_at <= now+timedelta(days=7):
                raise ValueError('Expiry must be between one minute and seven days from now')
            if not valid_zone(self.center.latitude,self.center.longitude,self.half_width_meters):
                raise ValueError('Entire blocked area must be inside the pilot window')
        elif self.center is not None or self.half_width_meters is not None or self.expires_at is not None:
            raise ValueError('Clearing an impact must omit center, width, and expiry')
        return self


class RoutingImpact(BaseModel):
    model_config=ConfigDict(extra='ignore')
    ticket_id: str=Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_-]+$')
    report_status: ReportState
    is_approved: bool=Field(strict=True)
    version: int=Field(ge=0,strict=True)
    impact: Literal['blocked','none']
    center: Location | None=None
    half_width_meters: float | None=Field(default=None,ge=3,le=30,strict=True,allow_inf_nan=False)
    expires_at: datetime | None=None
    note: str | None=Field(default=None,max_length=1000)
    updated_at: datetime | None=None

    @model_validator(mode='after')
    def consistent(self):
        if self.impact=='blocked':
            if (self.version<1 or self.center is None or self.half_width_meters is None or
                self.expires_at is None or self.expires_at.tzinfo is None or
                not valid_zone(self.center.latitude,self.center.longitude,self.half_width_meters)):
                raise ValueError('Invalid stored impact')
        elif any(v is not None for v in (self.center,self.half_width_meters,self.expires_at)):
            raise ValueError('Invalid cleared impact')
        return self

    @property
    def bounds(self):
        return zone_bounds(self.center.latitude,self.center.longitude,self.half_width_meters)


class ObstacleFeature(BaseModel):
    ticket_id: str
    version: int
    expires_at: datetime
    # An exterior GeoJSON polygon ring in [longitude, latitude] order.
    exclusion_ring: list[tuple[float,float]]


class ObstacleSnapshot(BaseModel):
    checked_at: datetime
    items: list[ObstacleFeature]


class ConfirmedObstacles:
    def __init__(self,settings,*,transport=None):
        self.url=settings.project_url+'/rest/v1/rpc/enclave_routing_obstacles'
        self.headers={'apikey':settings.api_key,'Content-Profile':'public'}
        if not settings.api_key.startswith('sb_secret_'):
            self.headers['Authorization']='Bearer '+settings.api_key
        self.client=httpx.AsyncClient(timeout=10,follow_redirects=False,trust_env=False,transport=transport)

    async def close(self):
        await self.client.aclose()

    async def call(self,action,actor_id,**args):
        try:
            response=await self.client.post(self.url,headers=self.headers,
                json={'p_action':action,'p_args':{**args,'actor_id':str(actor_id)}})
            if response.status_code!=200 or len(response.content)>1_048_576:
                raise ObstacleUnavailable()
            data=response.json()
            if not isinstance(data,dict):
                raise ObstacleUnavailable()
            failures={'forbidden':(403,'Routing impact access denied'),
                'not_found':(404,'Report not found'),
                'conflict':(409,'Report or routing impact changed; refresh before retrying'),
                'invalid':(422,'Invalid routing impact or expiry; confirm the area is near the report')}
            if data.get('state') in failures:
                raise ObstacleRejected(*failures[data['state']])
            if data.get('state')!='ok':
                raise ObstacleUnavailable()
            return data
        except (httpx.HTTPError,ValueError,TypeError,RecursionError):
            raise ObstacleUnavailable() from None

    async def get(self,actor_id,ticket_id):
        data=await self.call('get',actor_id,ticket_id=ticket_id)
        try:
            result=RoutingImpact.model_validate(data['item'])
            if result.ticket_id!=ticket_id:
                raise ValueError()
            return result
        except (ValueError,TypeError,KeyError,ValidationError):
            raise ObstacleUnavailable() from None

    async def update(self,actor_id,ticket_id,body):
        data=await self.call('set',actor_id,ticket_id=ticket_id,**body.model_dump(mode='json'))
        try:
            result=RoutingImpact.model_validate(data['item'])
            if (result.ticket_id!=ticket_id or result.version!=body.expected_version+1
                or result.report_status!=body.expected_report_status or result.impact!=body.impact
                or result.center!=body.center or result.half_width_meters!=body.half_width_meters
                or result.expires_at!=body.expires_at or result.note!=body.note):
                raise ValueError()
            return result
        except (ValueError,TypeError,KeyError,ValidationError):
            raise ObstacleUnavailable() from None

    async def active(self,actor_id):
        data=await self.call('active',actor_id)
        try:
            checked=datetime.fromisoformat(data['checked_at'].replace('Z','+00:00'))
            now=datetime.now(timezone.utc)
            if checked.tzinfo is None or not now-timedelta(seconds=60)<=checked<=now+timedelta(seconds=5):
                raise ValueError()
            rows=data['items']
            if not isinstance(rows,list) or len(rows)>MAX_OBSTACLES:
                raise ValueError()
            items=[]
            seen=set()
            for row in rows:
                record=RoutingImpact.model_validate(row)
                if (record.impact!='blocked' or record.report_status not in ('approved','in_progress')
                    or not record.is_approved or record.expires_at<=checked or record.ticket_id in seen):
                    raise ValueError()
                seen.add(record.ticket_id)
                items.append(ObstacleFeature(ticket_id=record.ticket_id,version=record.version,
                    expires_at=record.expires_at,exclusion_ring=zone_ring(record.bounds)))
            return ObstacleSnapshot(checked_at=checked,items=items)
        except (ValueError,TypeError,KeyError,AttributeError,ValidationError):
            raise ObstacleUnavailable() from None
