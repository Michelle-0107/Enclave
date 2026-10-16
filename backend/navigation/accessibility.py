"""Distance routing over a surveyed step-free graph; unknown paths are excluded."""

from datetime import datetime,timezone,timedelta
import heapq
import json
import math
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel,ConfigDict,Field,model_validator

from .config import PILOT_BBOX,MAX_ROUTE_POINTS,in_bounds
from .contracts import RouteResponse,RouteGeometry,Maneuver,Longitude,Latitude
from .provider import NavigationRejected,NavigationUnavailable
from .zones import route_intersects_zone


def distance(a,b):
    lon1,lat1,lon2,lat2=map(math.radians,(*a,*b))
    n=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6_371_008.8*2*math.asin(min(1,math.sqrt(n)))


class NetworkNode(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id: str=Field(min_length=1,max_length=80)
    coordinate: tuple[Longitude,Latitude]


class NetworkEdge(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id: str=Field(min_length=1,max_length=80)
    start: str
    end: str
    name: str=Field(min_length=1,max_length=120)
    geometry: list[tuple[Longitude,Latitude]]=Field(min_length=2,max_length=2000)
    bidirectional: bool=Field(default=True,strict=True)
    assessment: Literal['accessible','inaccessible','unknown']
    has_steps: bool | None=Field(default=None,strict=True)
    step_free_connection: bool | None=Field(default=None,strict=True)
    verified_at: datetime | None=None
    valid_until: datetime | None=None
    evidence_reference: str | None=Field(default=None,max_length=200)

    def usable(self,now):
        return (self.assessment=='accessible' and self.has_steps is False and self.step_free_connection is True
            and self.verified_at is not None and self.verified_at.tzinfo is not None
            and self.valid_until is not None and self.valid_until.tzinfo is not None
            and self.verified_at<=now<self.valid_until and bool(self.evidence_reference))


class NetworkDocument(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version: Literal[1]=1
    source: Literal['field_survey','synthetic_demo']
    nodes: list[NetworkNode]=Field(max_length=5000)
    edges: list[NetworkEdge]=Field(max_length=10000)

    @model_validator(mode='after')
    def connected_geometry(self):
        nodes={n.id:n.coordinate for n in self.nodes}
        if len(nodes)!=len(self.nodes) or len({e.id for e in self.edges})!=len(self.edges): raise ValueError('Duplicate graph IDs')
        for n in self.nodes:
            if not in_bounds(*n.coordinate): raise ValueError('Node outside pilot')
        for e in self.edges:
            if e.start not in nodes or e.end not in nodes or e.start==e.end: raise ValueError('Invalid edge endpoints')
            if e.geometry[0]!=nodes[e.start] or e.geometry[-1]!=nodes[e.end] or any(not in_bounds(*p) for p in e.geometry):
                raise ValueError('Edge must follow surveyed geometry between its nodes')
        return self


class VerifiedNetwork:
    def __init__(self,path=None,*,document=None):
        self.path=Path(path) if path else Path(__file__).parent/'data/accessibility_network.json'
        self.document=document

    def load(self):
        try:
            if self.document is not None: return NetworkDocument.model_validate(self.document)
            if self.path.stat().st_size>5_000_000: raise ValueError()
            return NetworkDocument.model_validate(json.loads(self.path.read_text(encoding='utf-8')))
        except (OSError,ValueError,TypeError,RecursionError): raise NavigationUnavailable() from None

    def coverage(self):
        document=self.load(); now=datetime.now(timezone.utc)
        count=sum(edge.usable(now) for edge in document.edges)
        return {'accessible_network_available':bool(count),'verified_accessible_segments':count}

    def route(self,body,snapshot,boxes):
        document=self.load(); now=datetime.now(timezone.utc)
        if not document.edges:
            raise NavigationRejected(422,'No verified accessible network is available for this area; stairs and unknown paths cannot be assumed accessible')
        nodes={n.id:n.coordinate for n in document.nodes}
        adjacency={key:[] for key in nodes}
        for edge in document.edges:
            if not edge.usable(now) or any(route_intersects_zone(edge.geometry,b) for b in boxes): continue
            length=sum(distance(a,b) for a,b in zip(edge.geometry,edge.geometry[1:]))
            if length<=0: continue
            adjacency[edge.start].append((edge.end,length,edge,False))
            if edge.bidirectional: adjacency[edge.end].append((edge.start,length,edge,True))
        origin=(body.origin.longitude,body.origin.latitude); destination=(body.destination.longitude,body.destination.latitude)
        # Avoid inventing an unassessed approach across a kerb/steps. Endpoints must
        # be at surveyed nodes (50cm precision tolerance), not just near a road.
        starts=[key for key in nodes if distance(origin,nodes[key])<=0.5]
        ends={key for key in nodes if distance(destination,nodes[key])<=0.5}
        if not starts or not ends: raise NavigationRejected(422,'Start and destination must be on surveyed accessible network nodes')
        queue=[(0.0,key) for key in starts]; heapq.heapify(queue)
        best={key:0.0 for key in starts}; previous={}; chosen=None
        while queue:
            cost,node=heapq.heappop(queue)
            if cost!=best[node]: continue
            if node in ends: chosen=node; break
            for following,length,edge,reverse in adjacency[node]:
                candidate=cost+length
                if candidate<best.get(following,float('inf')):
                    best[following]=candidate; previous[following]=(node,edge,reverse)
                    heapq.heappush(queue,(candidate,following))
        if chosen is None or chosen not in previous:
            raise NavigationRejected(422,'No verified accessible route avoids the reported damage and inaccessible paths')
        selected=[]; cursor=chosen
        while cursor in previous:
            before,edge,reverse=previous[cursor]; selected.append((edge,reverse)); cursor=before
        selected.reverse(); geometry=[]; maneuvers=[]; cumulative=0.0
        if len(selected)>=2000: raise NavigationRejected(422,'Accessible route exceeds supported maneuver count')
        for index,(edge,reverse) in enumerate(selected):
            points=list(reversed(edge.geometry)) if reverse else edge.geometry
            begin=max(0,len(geometry)-1)
            if geometry: geometry.extend(points[1:])
            else: geometry.extend(points)
            length=sum(distance(a,b) for a,b in zip(points,points[1:]))
            kind=1 if index==0 else 8
            prefix='Start' if index==0 else 'Continue'
            if index:
                a,b,c=geometry[begin-1],geometry[begin],geometry[begin+1]
                v1=(b[0]-a[0],b[1]-a[1]); v2=(c[0]-b[0],c[1]-b[1])
                turn=math.degrees(math.atan2(v1[0]*v2[1]-v1[1]*v2[0],v1[0]*v2[0]+v1[1]*v2[1]))
                if abs(turn)>30: kind,prefix=(15,'Turn left') if turn>0 else (10,'Turn right')
            instruction=f'{prefix} along {edge.name} for {length:.0f} meters.'
            maneuvers.append(Maneuver(index=index,type=kind,instruction=instruction,spoken_instruction=instruction,
                distance_meters=length,duration_seconds=length,begin_shape_index=begin,end_shape_index=len(geometry)-1,
                distance_from_start_meters=cumulative,coordinate=points[0]))
            cumulative+=length
            if cumulative>30_000: raise NavigationRejected(422,'Accessible route exceeds supported distance')
        if len(geometry)>MAX_ROUTE_POINTS or any(route_intersects_zone([origin,*geometry,destination],b) for b in boxes):
            raise NavigationRejected(422,'No supported accessible route is available')
        maneuvers.append(Maneuver(index=len(maneuvers),type=4,instruction='You have arrived at your destination.',
            spoken_instruction='You have arrived at your destination.',distance_meters=0,duration_seconds=0,
            begin_shape_index=len(geometry)-1,end_shape_index=len(geometry)-1,distance_from_start_meters=cumulative,coordinate=geometry[-1]))
        synthetic=document.source=='synthetic_demo'
        return RouteResponse(route_id=uuid4(),generated_at=now,route_mode='accessible',routing_engine='verified_network',
            geometry=RouteGeometry(coordinates=geometry),distance_meters=cumulative,duration_seconds=cumulative,
            origin_snap_distance_meters=distance(origin,geometry[0]),destination_snap_distance_meters=distance(destination,geometry[-1]),
            maneuvers=maneuvers,data_source='synthetic_demo' if synthetic else 'verified_accessibility_network',
            field_verified=not synthetic,accessibility_status='synthetic_network' if synthetic else 'verified_network',
            community_issue_avoidance='applied' if boxes else 'no_active_obstacles',obstacle_count=len(boxes),
            obstacle_snapshot_at=snapshot.checked_at,obstacle_source='community_reports',warnings=[
                'Synthetic accessibility graph; not a real accessible path.' if synthetic else 'Uses only surveyed, currently valid accessible connections.',
                'Duration assumes 1 meter per second; conditions and personal pace vary.',
                'Restrictions are a snapshot; refresh the route when conditions change.'])
