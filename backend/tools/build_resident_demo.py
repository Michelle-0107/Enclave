"""Offline OSM-derived road graph for the entire Enclave pilot bbox.

Only facility/access condition annotations are fictional. No preset journey.
Build with build(source_xml, service_area, source_metadata). Areas are server-owned data; no frontend bounds.
"""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

def distance(a,b):
    x,y=map(math.radians,(a[1],b[1]))
    q=math.sin((y-x)/2)**2+math.cos(x)*math.cos(y)*math.sin(math.radians(b[0]-a[0])/2)**2
    return 12742017.6*math.asin(min(1,math.sqrt(q)))
def build(source, area, metadata, *, add_demo_facilities=False):
    BBOX = tuple(area['bbox'])
    def inside(p):
        return BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]
    root=ET.parse(source).getroot()
    tags=lambda e:{t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
    points={e.attrib['id']:[float(e.attrib['lon']),float(e.attrib['lat'])] for e in root.findall('node')}
    node_tags={e.attrib['id']:tags(e) for e in root.findall('node')}
    ways={e.attrib['id']:{'refs':[n.attrib['ref'] for n in e.findall('nd')],'tags':tags(e)} for e in root.findall('way')}
    def forbidden(t):
        return t.get('foot') in ('no','private') or (t.get('access') in ('no','private','customers','destination') and t.get('foot') not in ('yes','designated','permissive'))
    fixture_allowed={'footway','path','steps','pedestrian','living_street','service','residential','unclassified','tertiary','cycleway','track'}
    allowed=fixture_allowed
    atoms={}; adj=collections.defaultdict(list)
    for wid,w in sorted(ways.items()):
        t=w['tags']
        if t.get('highway') not in allowed or forbidden(t) or t.get('area')=='yes' or t.get('indoor')=='yes':continue
        for i,(a,b) in enumerate(zip(w['refs'],w['refs'][1:])):
            if a not in points or b not in points or not inside(points[a]) or not inside(points[b]) or a==b:continue
            if forbidden(node_tags[a]) or forbidden(node_tags[b]) or node_tags[a].get('locked')=='yes' or node_tags[b].get('locked')=='yes':continue
            if distance(points[a],points[b])<0.01:continue
            key=f'{wid}-{i}';atoms[key]=(a,b,wid,i);adj[a].append(key);adj[b].append(key)
    # Select facilities spatially, independent of any particular start/end or route.
    cells=collections.defaultdict(list)
    for key,(a,b,wid,i) in atoms.items():
        t=ways[wid]['tags'];length=distance(points[a],points[b])
        if t['highway'] not in fixture_allowed or t['highway']=='steps' or not 5 <= length <= 80:continue
        p=[(points[a][j]+points[b][j])/2 for j in (0,1)]
        cell=(min(7,int((p[0]-BBOX[0])/(BBOX[2]-BBOX[0])*8)),min(7,int((p[1]-BBOX[1])/(BBOX[3]-BBOX[1])*8)))
        cells[cell].append((hashlib.sha256(key.encode()).hexdigest(),key,p))
    selected=[]
    for cell in sorted(cells) if add_demo_facilities else []:
        count=0
        for _,key,p in sorted(cells[cell]):
            if any(distance(p,other[2])<55 for other in selected):continue
            selected.append((cell,key,p));count+=1
            if count==3:break
    kinds=['crossing','ramp','stairs','path_surface','footbridge','step_free_path']
    names=['Zebra crossing','Access ramp','Stair-only access','Pavement section','Bridge walkway','Step-free access']
    assignments={};facilities=[]
    for index,(cell,key,p) in enumerate(selected):
        a,b,wid,_=atoms[key];kind=kinds[index%6];fid=f'demo-{kind}-{key}'
        damaged=index%4==0;assignments[key]=fid
        road=ways[wid]['tags'].get('name','Mapped footpath' if ways[wid]['tags']['highway'] in ('footway','path') else 'Mapped local road')
        facilities.append({'id':fid,'name':names[index%6]+' · '+road,'kind':kind,'coordinate':p,
                           'damaged':damaged,'reporters':2 if damaged else 0,'source':'fictional_facility',
                           'restrictionRadiusMeters':3,'gridCell':list(cell),'edgeId':''})
    stops=set()
    for n,keys in adj.items():
        if len(keys)!=2 or len({atoms[k][2] for k in keys})!=1 or any(k in assignments for k in keys):stops.add(n)
    for w in ways.values():
        refs=w['refs']
        if refs[0] in adj:stops.add(refs[0])
        if refs[-1] in adj:stops.add(refs[-1])
        if refs[0]==refs[-1] and refs[len(refs)//2] in adj:stops.add(refs[len(refs)//2])
        repeated={n for n,c in collections.Counter(refs).items() if c>1}
        for i,n in enumerate(refs):
            if n in repeated:
                for other in refs[max(0,i-1):i+2]:
                    if other in adj:stops.add(other)
    by_facility={f['id']:f for f in facilities};visited=set();edges=[]
    for start in sorted(stops):
        for first in sorted(adj[start]):
            if first in visited:continue
            chain=[];refs=[start];cursor=start;key=first
            while True:
                visited.add(key);chain.append(key)
                a,b,wid,_=atoms[key];cursor=b if cursor==a else a;refs.append(cursor)
                if cursor in stops:break
                key=next(k for k in adj[cursor] if k!=key)
            if refs[0]==refs[-1]:raise ValueError('Closed path must be split at two real nodes.')
            t=ways[wid]['tags'];fid=assignments.get(first)
            assert len(chain)==1 or not any(k in assignments for k in chain)
            forward=atoms[first][0]==refs[0]
            # Generic oneway is a vehicle restriction, including on cycle/path ways.
            # Only an explicit pedestrian direction may force a walking detour.
            foot_oneway=t.get('oneway:foot','no')
            if t.get('foot:backward')=='no':foot_oneway='yes'
            if t.get('foot:forward')=='no':foot_oneway='-1'
            direction='both' if foot_oneway not in ('yes','1','true','-1') else ('forward' if (foot_oneway!='-1')==forward else 'backward')
            eid='osm-'+wid+'-'+refs[0]+'-'+refs[-1]
            steps=t['highway']=='steps'
            base_free=not steps and t.get('wheelchair')!='no' and t.get('surface') not in ('dirt','ground','rock','stepping_stones','sand','pebblestone','gravel')
            if t['highway'] in ('primary','primary_link','secondary','secondary_link') and t.get('wheelchair')!='yes':base_free=False
            edges.append({'id':eid,'start':refs[0],'end':refs[-1],'facilityId':fid,'mappedHasSteps':steps,
                          'baseStepFree':base_free,'direction':direction,'geometry':[points[n] for n in refs],
                          'osmNodeIds':refs,'osmWayId':wid,'highway':t['highway'],'layer':t.get('layer','0'),
                          'roadName':t.get('name','Mapped footpath' if t['highway'] in ('footway','path','steps','pedestrian') else 'Mapped local road'),
                          'accessBasis':'fictional_demo_assumption'})
            if fid:by_facility[fid]['edgeId']=eid
    assert len(visited)==len(atoms)
    landmarks=[]
    poi_keys=('amenity','shop','tourism','leisure','office','place','public_transport','railway','building','landuse')
    for nid,t in node_tags.items():
        if t.get('name') and inside(points[nid]) and any(k in t for k in poi_keys):
            landmarks.append({'id':'osm-node-'+nid,'osmType':'node','osmId':nid,'name':t['name'],'coordinate':points[nid],'positionBasis':'Mapped OSM point; road access selected separately'})
    for wid,w in ways.items():
        t=w['tags']
        if not t.get('name') or not any(k in t for k in poi_keys) or 'highway' in t:continue
        refs=w['refs'][:-1] if w['refs'][0]==w['refs'][-1] else w['refs']
        if not all(n in points for n in refs):continue
        p=[round(sum(points[n][i] for n in refs)/len(refs),7) for i in (0,1)]
        if inside(p):landmarks.append({'id':'osm-way-'+wid,'osmType':'way','osmId':wid,'name':t['name'],'coordinate':p,'positionBasis':'OSM outline vertex mean; label only, not an entrance'})
    # Stable real POI catalog; no fabricated residential/garden destinations.
    return {'version':3,'source':'osm_roads_with_fictional_facilities','fieldVerified':False,
            'name':area['name']+' resident demo','bbox':list(BBOX),'center':area['center'],
            'styleUrl':'https://tiles.openfreemap.org/styles/liberty',
            'provenance':{'geometrySource':'OpenStreetMap','extractUrl':metadata['source_url'],
                          'downloadedAt':metadata['downloaded_at'],'sourceXmlSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                          'license':'ODbL-1.0','attribution':'OpenStreetMap contributors',
                          'networkScope':'All eligible mapped segments inside the pilot bbox, including disconnected components; not an official township boundary',
                          'routingAccess':'Mapped pedestrian direction respected. Vehicle one-way does not restrict walking. Access assumptions and facilities are fictional; no certified wheelchair guidance.'},
            'nodes':[{'id':n,'coordinate':points[n]} for n in sorted(stops)],
            'landmarks':sorted(landmarks,key=lambda l:(l['name'],l['id'])),
            'facilities':facilities,'edges':sorted(edges,key=lambda e:e['id'])}
