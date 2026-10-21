"""Explicit facility/incident grouping and two-distinct-resident map eligibility."""

from datetime import datetime,timezone,timedelta
from typing import Literal
from uuid import UUID

import httpx
from pydantic import BaseModel,ConfigDict,Field,ValidationError,model_validator

from .map import MapBounds,MapPagination,MapPoint
from .road_sections import RoadSection, catalog as road_catalog
from ..navigation.contracts import Location
from ..navigation.zones import MAX_OBSTACLES
from ..navigation.facility_segments import restriction_for

FacilityType=Literal['path_surface','ramp','stairs','kerb','crossing','elevator','streetlight','drainage','bench','other']
FaultKind=Literal['damage','obstruction']
ROAD_TYPES={'path_surface','ramp','stairs','kerb','crossing','elevator','streetlight','drainage'}
Ticket=str


class IssueUnavailable(RuntimeError):
    pass


class IssueRejected(Exception):
    def __init__(self,status,message): self.status,self.message=status,message


class FacilityCreate(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    name: str=Field(min_length=1,max_length=120)
    facility_type: FacilityType
    latitude: float=Field(ge=3.2171,le=3.2349,strict=True,allow_inf_nan=False)
    longitude: float=Field(ge=101.7211,le=101.7409,strict=True,allow_inf_nan=False)


class Facility(FacilityCreate):
    model_config=ConfigDict(extra='ignore')
    id: UUID
    created_at: datetime
    road_section: RoadSection | None = None
    report_target: Literal['facility','road_reference'] = 'facility'

    @model_validator(mode='after')
    def identify_road_reference(self):
        from ..navigation.road_bindings import road_reference_bindings
        reference = road_reference_bindings().get(self.id)
        if reference and abs(reference['latitude']-self.latitude)<1e-9 and abs(reference['longitude']-self.longitude)<1e-9:
            self.report_target = 'road_reference'
        return self


class OpenIssue(BaseModel):
    model_config=ConfigDict(extra='forbid')
    facility_id: UUID
    fault_kind: FaultKind='damage'
    report_ticket_id: str=Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_-]+$')


class JoinIssue(BaseModel):
    model_config=ConfigDict(extra='forbid')
    report_ticket_id: str=Field(min_length=1,max_length=128,pattern=r'^[A-Za-z0-9_-]+$')


class CommunityIssue(BaseModel):
    model_config=ConfigDict(extra='ignore')
    id: UUID
    facility_id: UUID
    facility_name: str=Field(min_length=1,max_length=120)
    facility_type: FacilityType
    latitude: float=Field(ge=3.2171,le=3.2349,strict=True,allow_inf_nan=False)
    longitude: float=Field(ge=101.7211,le=101.7409,strict=True,allow_inf_nan=False)
    fault_kind: FaultKind
    status: Literal['open','resolved']
    reporter_count: int=Field(ge=0,strict=True)
    affects_routes: bool=Field(strict=True)
    created_at: datetime
    resolved_at: datetime | None=None

    @model_validator(mode='after')
    def consistent(self):
        if self.affects_routes!=(self.facility_type in ROAD_TYPES) or (self.status=='open')!=(self.resolved_at is None):
            raise ValueError('Invalid incident projection')
        return self


class IssueLinked(BaseModel):
    issue: CommunityIssue
    deduplicated: bool
    community_visible: bool


class FacilityList(BaseModel):
    items: list[Facility]
    pagination: MapPagination


class IssueList(BaseModel):
    items: list[CommunityIssue]
    pagination: MapPagination


class IssueMapProperties(BaseModel):
    issue_id: UUID
    facility_id: UUID
    facility_name: str
    facility_type: FacilityType
    fault_kind: FaultKind
    reporter_count: int
    confirmation_threshold: Literal[2]=2
    status: Literal['open','resolved']
    affects_routes: bool
    reported_at: datetime
    resolved_at: datetime | None
    verification: Literal['community_reported']='community_reported'


class IssueMapFeature(BaseModel):
    type: Literal['Feature']='Feature'
    id: str
    geometry: MapPoint
    properties: IssueMapProperties


class IssueMapResponse(BaseModel):
    type: Literal['FeatureCollection']='FeatureCollection'
    features: list[IssueMapFeature]
    pagination: MapPagination


class CommunityObstacle(BaseModel):
    issue_id: UUID
    facility_id: UUID
    reporter_count: int=Field(ge=2,strict=True)
    exclusion_ring: list[tuple[float,float]]


class CommunityObstacleSnapshot(BaseModel):
    checked_at: datetime
    confirmation_threshold: Literal[2]=2
    source: Literal['community_reports']='community_reports'
    items: list[CommunityObstacle]


class CommunityIssues:
    def __init__(self,settings,*,transport=None):
        self.url=settings.project_url+'/rest/v1/rpc/enclave_community_issues'
        self.headers={'apikey':settings.api_key,'Content-Profile':'public'}
        if not settings.api_key.startswith('sb_secret_'): self.headers['Authorization']='Bearer '+settings.api_key
        self.client=httpx.AsyncClient(timeout=10,trust_env=False,follow_redirects=False,transport=transport)

    async def close(self): await self.client.aclose()

    async def call(self,action,actor_id,**args):
        try:
            async with self.client.stream('POST',self.url,headers=self.headers,
                json={'p_action':action,'p_args':{**args,'actor_id':str(actor_id)}}) as response:
                payload=bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload)>1_048_576: raise IssueUnavailable()
                if response.status_code!=200: raise IssueUnavailable()
                import json
                data=json.loads(payload)
            if not isinstance(data,dict): raise IssueUnavailable()
            if action=='open_road_issue' and data.get('road_reporting_version')!=1:
                raise IssueRejected(503,'Road section reporting is unavailable on this backend. Retry issue linking after the service is updated.')
            if action=='open_place_issue' and data.get('place_reporting_version')!=1:
                raise IssueRejected(503,'Place reporting needs SQL 022 on this database. Your report is saved; retry linking after the update.')
            errors={'forbidden':(403,'Active verified residency required'),
                'not_found':(404,'Facility, issue, or owned report not found'),
                'invalid':(422,'Invalid issue link; report must be near the selected facility'),
                'conflict':(409,'This evidence is already linked to another issue'),
                'closed':(409,'Issue has been repaired; submit fresh evidence to open a new incident')}
            if data.get('state') in errors: raise IssueRejected(*errors[data['state']])
            if data.get('state')!='ok': raise IssueUnavailable()
            return data
        except (httpx.HTTPError,ValueError,TypeError,RecursionError): raise IssueUnavailable() from None

    async def create_facility(self,actor_id,body):
        try:
            reserved=any(point.name==body.name and point.facility_type==body.facility_type
                and abs(point.latitude-body.latitude)<1e-9 and abs(point.longitude-body.longitude)<1e-9
                for point in road_catalog().values())
        except (ValueError,OSError):raise IssueUnavailable() from None
        if reserved:raise IssueRejected(409,'Use the existing road section report point instead of creating a duplicate facility')
        data=await self.call('create_facility',actor_id,**body.model_dump())
        try:
            item=Facility.model_validate(data['item'])
            if any(getattr(item,key)!=value for key,value in body.model_dump().items()): raise ValueError()
            return item
        except (KeyError,TypeError,ValueError): raise IssueUnavailable() from None

    async def link(self,actor_id,body,issue_id=None):
        values=body.model_dump(mode='json')
        if issue_id: values.update(issue_id=str(issue_id),fault_kind='damage')
        action='report_issue' if issue_id else 'open_issue'
        if not issue_id:
            try:point=road_catalog().get(body.facility_id)
            except (ValueError,OSError):raise IssueUnavailable() from None
            if getattr(self,'locations',None) is not None:
                from ..navigation.locations import LocationsNotInstalled,SharedLocation
                try:
                    rows=await self.locations.call('point',actor_id=str(actor_id),id=str(body.facility_id))
                    if len(rows)>1:raise IssueUnavailable()
                    if rows:
                        selected=SharedLocation.model_validate(rows[0])
                        if selected.id!=body.facility_id:raise IssueUnavailable()
                        if selected.kind=='place':
                            from ..navigation.road_bindings import road_reference_bindings
                            if selected.id in road_reference_bindings():
                                raise IssueRejected(422, 'Choose the road section at the actual issue pin instead of a whole-road reference')
                            action='open_place_issue'
                            point=None
                        if selected.kind=='road_section':
                            values['road_point']={'id':str(selected.id),'name':selected.name,'facility_type':'path_surface','latitude':selected.latitude,'longitude':selected.longitude}
                            action='open_road_issue'
                            point=None
                    elif point:
                        raise IssueRejected(503,'Road section missing from shared locations; confirm SQL 021 is installed')
                except LocationsNotInstalled:
                    pass
            if point:
                action='open_road_issue'
                values['road_point']={key:value for key,value in point.model_dump(mode='json').items()
                    if key in {'id','name','facility_type','latitude','longitude'}}
        data=await self.call(action,actor_id,**values)
        try:
            item=CommunityIssue.model_validate(data['issue'])
            if type(data['deduplicated']) is not bool or item.status!='open' or item.reporter_count<1: raise ValueError()
            if issue_id and item.id!=issue_id or not issue_id and item.facility_id!=body.facility_id: raise ValueError()
            return IssueLinked(issue=item,deduplicated=data['deduplicated'],community_visible=item.reporter_count>=2)
        except (ValueError,TypeError,KeyError): raise IssueUnavailable() from None

    async def listing(self,actor_id,action,*,bounds,limit,offset,include_resolved=False):
        data=await self.call(action,actor_id,west=bounds.west,south=bounds.south,east=bounds.east,north=bounds.north,
            limit=limit,offset=offset,include_resolved=include_resolved)
        try:
            if not isinstance(data['items'],list) or len(data['items'])>limit or type(data['has_more']) is not bool: raise ValueError()
            kind=Facility if action=='facilities' else CommunityIssue
            items=[kind.model_validate(row) for row in data['items']]
            if len({item.id for item in items})!=len(items) or any(not bounds.contains(item.longitude,item.latitude) for item in items): raise ValueError()
            if action!='facilities' and any((item.status=='resolved' and not include_resolved)
                or (action=='map' and item.reporter_count<2) for item in items): raise ValueError()
            pagination=MapPagination(limit=limit,offset=offset,returned=len(items),has_more=data['has_more'])
            if action=='facilities': return FacilityList(items=items,pagination=pagination)
            if action=='issues': return IssueList(items=items,pagination=pagination)
            features=[IssueMapFeature(id=str(item.id),geometry=MapPoint(coordinates=(item.longitude,item.latitude)),
                properties=IssueMapProperties(issue_id=item.id,facility_id=item.facility_id,
                    facility_name=item.facility_name,facility_type=item.facility_type,fault_kind=item.fault_kind,
                    reporter_count=item.reporter_count,status=item.status,affects_routes=item.affects_routes,
                    reported_at=item.created_at,resolved_at=item.resolved_at)) for item in items]
            return IssueMapResponse(features=features,pagination=pagination)
        except (ValueError,TypeError,KeyError,ValidationError): raise IssueUnavailable() from None

    async def active(self,actor_id):
        data=await self.call('obstacles',actor_id)
        try:
            now=datetime.now(timezone.utc); checked=datetime.fromisoformat(data['checked_at'].replace('Z','+00:00'))
            if checked.tzinfo is None or not now-timedelta(seconds=60)<=checked<=now+timedelta(seconds=5): raise ValueError()
            if not isinstance(data['items'],list) or len(data['items'])>MAX_OBSTACLES: raise ValueError()
            rows=[CommunityIssue.model_validate(row) for row in data['items']]
            if len({row.id for row in rows})!=len(rows) or any(row.status!='open' or row.reporter_count<2 or not row.affects_routes for row in rows): raise ValueError()
            restrictions = [restriction_for(row) for row in rows]
            items = [CommunityObstacle(issue_id=row.id,facility_id=row.facility_id,reporter_count=row.reporter_count,
                exclusion_ring=ring) for row,restriction in zip(rows,restrictions) for ring in restriction['exclusion_rings']]
            if len(items)>MAX_OBSTACLES: raise ValueError()
            return CommunityObstacleSnapshot(checked_at=checked,items=items)
        except (ValueError,KeyError,TypeError,AttributeError): raise IssueUnavailable() from None
