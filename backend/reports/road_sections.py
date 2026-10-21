"""Stable OSM road-section reporting points, independent of routing permissions.

Sections independently group resident evidence and never declare a road safe.
Qualified damage uses the canonical section geometry in resident and What-if
restrictions; report-point visibility does not control routing.
"""
from collections import Counter, defaultdict
from datetime import datetime
from functools import lru_cache
import hashlib
import json
from pathlib import Path
from uuid import UUID, uuid5
import xml.etree.ElementTree as ET

from pydantic import BaseModel, ConfigDict, Field
from ..navigation.service import distance_meters
from ..navigation.areas import find_area

ROOT=Path(__file__).resolve().parents[1]
CATALOG=ROOT/'data/reporting/road_sections.json'
NAMESPACE=UUID('e7754f48-7979-49e2-8c4b-a28a1b2c538a')
HIGHWAYS={'residential','living_street','service','unclassified','tertiary','tertiary_link',
          'secondary','secondary_link','primary','primary_link','trunk','trunk_link',
          'motorway','motorway_link','road','track','footway','path','steps','pedestrian','cycleway'}
# SQL 009's existing community-reporting guard window, not a new service area.
REPORT_BOUNDS=(101.7211,3.2171,101.7409,3.2349)

class RoadSection(BaseModel):
    model_config=ConfigDict(extra='forbid',frozen=True)
    area_id: str
    road_name: str
    osm_way_id: str=Field(pattern=r'^\d+$')
    highway: str
    section_index: int=Field(ge=1)
    length_meters: float=Field(gt=0,le=100.01)
    geometry: list[tuple[float,float]]=Field(min_length=2,max_length=500)
    field_verified: bool=False

class RoadPoint(BaseModel):
    model_config=ConfigDict(extra='forbid',frozen=True)
    id: UUID
    name: str=Field(min_length=1,max_length=120)
    facility_type: str='path_surface'
    latitude: float=Field(ge=3.2171,le=3.2349)
    longitude: float=Field(ge=101.7211,le=101.7409)
    created_at: datetime
    road_section: RoadSection

def clip(a,b,bounds):
    w,s,e,n=bounds;dx=b[0]-a[0];dy=b[1]-a[1];lo,hi=0.,1.
    for p,q in ((-dx,a[0]-w),(dx,e-a[0]),(-dy,a[1]-s),(dy,n-a[1])):
        if abs(p)<1e-15:
            if q<0:return None
        else:
            t=q/p
            if p<0:lo=max(lo,t)
            else:hi=min(hi,t)
            if lo>hi:return None
    return tuple((a[0]+dx*t,a[1]+dy*t) for t in (lo,hi))

def split_line(points,spacing=100.):
    """Follow actual polyline length, with an independent final short section."""
    if spacing<=0:raise ValueError('Positive spacing required')
    current=[points[0]];used=0.
    for target in points[1:]:
        start=current[-1];remaining=distance_meters(start,target)
        while used+remaining>=spacing-1e-7 and remaining>1e-7:
            fraction=min(1.,(spacing-used)/remaining)
            end=tuple(start[i]+(target[i]-start[i])*fraction for i in (0,1))
            current.append(end);yield current
            current=[end];used=0.;start=end;remaining=distance_meters(start,target)
        if remaining>1e-7:current.append(target);used+=remaining
    if used>0.01:yield current

def midpoint(points):
    halfway=sum(distance_meters(a,b) for a,b in zip(points,points[1:]))/2
    for a,b in zip(points,points[1:]):
        length=distance_meters(a,b)
        if length and halfway<=length:return tuple(a[i]+(b[i]-a[i])*halfway/length for i in (0,1))
        halfway-=length
    return points[-1]

def generate(area,source,created_at):
    root=ET.parse(source).getroot()
    nodes={n.attrib['id']:(float(n.attrib['lon']),float(n.attrib['lat'])) for n in root.findall('node')}
    ways=[];owners=defaultdict(set)
    for way in root.findall('way'):
        tags={t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}
        if tags.get('highway') not in HIGHWAYS or tags.get('area')=='yes':continue
        refs=[n.attrib['ref'] for n in way.findall('nd')]
        if len(refs)<2 or any(n not in nodes for n in refs):continue
        ways.append((way.attrib['id'],tags,refs))
        for node in refs:owners[node].add(way.attrib['id'])
    bounds=tuple(max(a,b) if i<2 else min(a,b) for i,(a,b) in enumerate(zip(area.bbox,REPORT_BOUNDS)))
    if bounds[0]>=bounds[2] or bounds[1]>=bounds[3]:return []
    result=[];labels=Counter()
    for wid,tags,refs in sorted(ways,key=lambda row:int(row[0])):
        fragments=[];chain=[]
        for left,right in zip(refs,refs[1:]):
            clipped=clip(nodes[left],nodes[right],bounds)
            if not clipped:
                if len(chain)>1:fragments.append(chain)
                chain=[];continue
            a,b=clipped
            if distance_meters(a,b)<.01:continue
            if chain and distance_meters(chain[-1],a)>.01:
                fragments.append(chain);chain=[]
            if not chain:chain=[a]
            chain.append(b)
            if len(owners[right])>1 or b!=nodes[right]:
                fragments.append(chain);chain=[]
        if len(chain)>1:fragments.append(chain)
        road_name=tags.get('name') or 'Unnamed '+tags['highway'].replace('_',' ')+' road'
        ordinal=0
        for fragment in fragments:
            anchor=','.join(f'{v:.8f}' for v in fragment[0])
            for index,geometry in enumerate(split_line(fragment)):
                ordinal+=1;labels[road_name]+=1;center=midpoint(geometry)
                identifier=uuid5(NAMESPACE,f'{area.id}:{wid}:{anchor}:{index}')
                # Clamp floating point boundary noise only, never relocate a point.
                lon=min(bounds[2],max(bounds[0],center[0]));lat=min(bounds[3],max(bounds[1],center[1]))
                result.append(RoadPoint(id=identifier,name=f'{road_name[:85]} · Section {labels[road_name]}',
                    latitude=lat,longitude=lon,created_at=created_at,road_section=RoadSection(
                        area_id=area.id,road_name=road_name,osm_way_id=wid,highway=tags['highway'],section_index=ordinal,
                        length_meters=round(sum(distance_meters(a,b) for a,b in zip(geometry,geometry[1:])),4),
                        geometry=geometry)))
    return result

@lru_cache(maxsize=1)
def catalog():
    document=json.loads(CATALOG.read_text(encoding='utf-8'))
    if document.get('version')!=1 or document.get('section_length_meters')!=100 or document.get('license')!='ODbL-1.0':raise ValueError('Invalid road point catalog')
    for area_id,digest in document['source_sha256'].items():
        area=find_area(area_id)
        if not area or not area.community_issues_supported:raise ValueError('Unsupported reporting area')
        if hashlib.sha256((ROOT/'data/demo_areas'/f'{area_id}.osm').read_bytes()).hexdigest()!=digest:
            raise ValueError('Road point source checksum mismatch')
    points=[RoadPoint.model_validate(row) for row in document['points']]
    if len({p.id for p in points})!=len(points):raise ValueError('Duplicate road point identifiers')
    for point in points:
        section=point.road_section;area=find_area(section.area_id)
        if not area or section.area_id not in document['source_sha256'] or section.field_verified or point.facility_type!='path_surface':raise ValueError('Invalid road point scope')
        if any(not(REPORT_BOUNDS[0]-1e-10<=p[0]<=REPORT_BOUNDS[2]+1e-10 and REPORT_BOUNDS[1]-1e-10<=p[1]<=REPORT_BOUNDS[3]+1e-10) for p in section.geometry):raise ValueError('Road section outside report bounds')
        if distance_meters((point.longitude,point.latitude),midpoint(section.geometry))>.02:raise ValueError('Road point lost its centerline')
    return {point.id:point for point in points}

def nearby(latitude,longitude):
    return sorted((point for point in catalog().values() if distance_meters((longitude,latitude),(point.longitude,point.latitude))<=100),
                  key=lambda point:(distance_meters((longitude,latitude),(point.longitude,point.latitude)),str(point.id)))
