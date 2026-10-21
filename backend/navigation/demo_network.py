"""Explicit, server-owned simulated crossing overlay. Never used by live routing."""
from collections import defaultdict
from copy import copy
from .graph_cache import shared_graph_cache
import math
import heapq
from pathlib import Path
import xml.etree.ElementTree as ET

from .roadside import Edge, walking_graph, distance, xy, coordinate, level, ALL_ROADS, LOCAL_ROADS, OFFSET, forbidden
from .land_access import intersection
from .zones import BoundsIndex


def refresh_index(graph):
    graph.components=graph.connected_components()
    graph.edge_index=BoundsIndex([(min(e.points[0][0],e.points[1][0]),min(e.points[0][1],e.points[1][1]),
                                  max(e.points[0][0],e.points[1][0]),max(e.points[0][1],e.points[1][1])) for e in graph.edges])


def mapped_facilities(graph):
    groups=defaultdict(list)
    for edge in graph.edges:
        if edge.kind in {'crossing','footbridge','underpass'}: groups[(edge.kind,edge.way_id)].append(edge)
    result=[]
    for (kind,way),edges in sorted(groups.items()):
        # Representative geometry comes from real graph segments. Membership
        # uses the full way ID, not proximity to an unrelated marker.
        edge=max(edges,key=lambda e:distance(*e.points)); geometry=list(edge.points)
        nodes=list({p for edge in edges for p in edge.points})
        if len(nodes)>2:
            start,end=max(((a,b) for a in nodes for b in nodes),key=lambda pair:distance(*pair))
            adjacency=defaultdict(list)
            for edge in edges:
                a,b=edge.points;length=distance(a,b)
                adjacency[a].append((b,length));adjacency[b].append((a,length))
            best={start:0};queue=[(0,start)];previous={}
            while queue:
                cost,node=heapq.heappop(queue)
                if cost!=best[node]: continue
                if node==end: break
                for to,length in adjacency[node]:
                    if cost+length<best.get(to,float('inf')):
                        best[to]=cost+length;previous[to]=node;heapq.heappush(queue,(cost+length,to))
            if end in previous:
                geometry=[end]
                while geometry[-1]!=start: geometry.append(previous[geometry[-1]])
                geometry.reverse()
        result.append({'id':f'mapped-{kind}-{way}','kind':kind,'name':f'Mapped {kind.replace("_"," ")}',
                       'routingSource':'openstreetmap','routingWayId':way,
                       'coordinate':list(geometry[len(geometry)//2]) if len(geometry)>2 else [(geometry[0][i]+geometry[-1][i])/2 for i in (0,1)],
                       'geometry':geometry,'fieldVerified':False})
    return result


def generate_facilities(area_id,*,spacing=75,include_buffer=False,source=None):
    """Uniform geographic placement; never consumes benchmark endpoints/results."""
    base=walking_graph(area_id)
    source=source or Path(__file__).resolve().parents[1]/'data/demo_areas'/f'{area_id}.osm'
    root=ET.parse(source).getroot()
    points={n.attrib['id']:(float(n.attrib['lon']),float(n.attrib['lat'])) for n in root.findall('node')}
    candidates=[]
    for way in root.findall('way'):
        tags={t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}
        if tags.get('highway') not in ALL_ROADS or level(tags)!=('0',False,False): continue
        refs=[n.attrib['ref'] for n in way.findall('nd')]
        for j,(a,b) in enumerate(zip(refs,refs[1:])):
            if a not in points or b not in points or distance(points[a],points[b])<20: continue
            inside=base.inside if include_buffer else base.endpoint_inside
            if not all(inside(p) for p in (points[a],points[b])): continue
            count=max(1,math.ceil(distance(points[a],points[b])/100))
            for k in range(count):
                t=(k+.5)/count
                center=tuple(x+(y-x)*t for x,y in zip(points[a],points[b]))
                candidates.append((center,way.attrib['id'],j,k,points[a],points[b],tags))
    placed=[]; result=mapped_facilities(base)
    mapped_coordinates=[f['coordinate'] for f in result]
    for center,wid,j,k,a,b,tags in sorted(candidates):
        if any(distance(center,p)<10 for p in mapped_coordinates): continue
        # Parallel streets need their own crossing; a marker on the next road
        # cannot serve an isolated side of this one.
        if any(other_way==wid and distance(center,p)<spacing for other_way,p in placed): continue
        ax,ay=xy(a);bx,by=xy(b);length=math.hypot(bx-ax,by-ay)
        normal=(-(by-ay)/length,(bx-ax)/length);cx,cy=xy(center)
        kind='footbridge' if tags.get('highway') in {'primary','primary_link','trunk','trunk_link','motorway','motorway_link','secondary','secondary_link'} else 'crossing'
        nearby=base.edge_index.candidates(coordinate((cx-100,cy-100)),coordinate((cx+100,cy+100)))
        anchors=[None,None]
        for index in nearby:
            edge=base.edges[index]
            if edge.grade!=('0',False,False) or edge.kind not in {'footpath','sidewalk','road_fallback'}: continue
            gap,f,q=base.project(center,edge)
            if not 2<gap<90: continue
            qx,qy=xy(q);side=(qx-cx)*normal[0]+(qy-cy)*normal[1]
            if abs(side)<2: continue
            slot=0 if side>0 else 1
            if anchors[slot] is None or gap<anchors[slot][0]: anchors[slot]=(gap,index,f,q)
        if any(a is None for a in anchors): continue
        left,right=anchors;qa,qb=left[3],right[3]
        if not 5<distance(qa,qb)<=180 or not base.land_access.clear(qa,qb): continue
        if kind=='crossing':
            # A simulated zebra crossing serves this carriageway only. Divided
            # or intersecting carriageways need an explicit simulated bridge.
            if any(grade==('0',False,False) and (c,d) not in ((a,b),(b,a))
                   and intersection(qa,qb,c,d) is not None for c,d,grade in base.nearby(qa,qb)):
                kind='footbridge'
        identifier=f'simulated-{kind}-{wid}-{j}-{k}'
        anchor_rows=[]
        for _,index,_,q in anchors:
            edge=base.edges[index]
            anchor_rows.append({'wayId':edge.way_id,'kind':edge.kind,'grade':list(edge.grade),'coordinate':list(q)})
        result.append({'id':identifier,'kind':kind,'name':'Simulated '+('zebra crossing' if kind=='crossing' else 'footbridge'),
                       'routingSource':'simulation','routingWayId':identifier,'fieldVerified':False,
                       'coordinate':[(qa[i]+qb[i])/2 for i in (0,1)],'geometry':[list(qa),list(qb)],'anchors':anchor_rows})
        placed.append((wid,center))
    return result


def generate_junction_facilities(base, facilities, source):
    """Fill short public side-street mouths omitted by 20m segment sampling.

    These are explicit hypothetical crossings, never new live walking rights.
    Placement uses only OSM road identity/junction geometry and the existing
    facility inventory. Both approaches must be on that road's ground graph;
    buildings, water, walls, forbidden nodes and other carriageways stay blocked.
    """
    root = ET.parse(source).getroot()
    points = {n.attrib['id']: (float(n.attrib['lon']), float(n.attrib['lat'])) for n in root.findall('node')}
    node_tags = {n.attrib['id']: {t.attrib['k']: t.attrib['v'] for t in n.findall('tag')} for n in root.findall('node')}
    ways = []
    arms = defaultdict(set)
    for way in root.findall('way'):
        tags = {t.attrib['k']: t.attrib['v'] for t in way.findall('tag')}
        if tags.get('highway') not in ALL_ROADS or level(tags) != ('0', False, False):
            continue
        refs = [n.attrib['ref'] for n in way.findall('nd')]
        ways.append((way.attrib['id'], refs, tags))
        for a, b in zip(refs, refs[1:]):
            if a in points and b in points:
                arms[a].add(b)
                arms[b].add(a)
    by_way = defaultdict(list)
    for index, edge in enumerate(base.edges):
        if edge.kind in {'sidewalk', 'road_fallback'} and edge.grade == ('0', False, False):
            by_way[edge.way_id].append((index, edge))
    existing = defaultdict(list)
    for facility in facilities:
        way_id = facility.get('sourceRoadWayId')
        for prefix in ('simulated-crossing-', 'simulated-footbridge-'):
            if facility['id'].startswith(prefix):
                way_id = facility['id'][len(prefix):].split('-', 1)[0]
        if way_id:
            existing[way_id].append(facility['coordinate'])
    placed = defaultdict(list)
    result = []
    for way_id, refs, tags in ways:
        if (tags.get('highway') not in LOCAL_ROADS or tags.get('access') == 'private'
                or tags.get('foot') == 'private' or forbidden(tags, resident_access=True)
                or tags.get('crossing') == 'no'):
            continue
        for a, b in zip(refs, refs[1:]):
            if a not in points or b not in points:
                continue
            length = distance(points[a], points[b])
            if not 2 * OFFSET <= length < 20:
                continue
            if any(forbidden(node_tags[n], resident_access=True) or node_tags[n].get('crossing') == 'no' for n in (a,b)):
                continue
            for node, other in ((a, b), (b, a)):
                if len(arms[node]) < 3:
                    continue
                fraction = min(8 / length, .5)
                center = tuple(x + (y-x) * fraction for x,y in zip(points[node], points[other]))
                if not base.endpoint_inside(center):
                    continue
                if (any(distance(center,p) < 25 for p in existing[way_id])
                        or any(distance(center,p) < 20 for p in placed[way_id])):
                    continue
                ax,ay = xy(points[node]); bx,by = xy(points[other]); cx,cy = xy(center)
                anchors = [None, None]
                for index, edge in by_way[way_id]:
                    gap, fraction, q = base.project(center, edge)
                    if not 1 < gap < 8:
                        continue
                    qx,qy = xy(q)
                    side = 0 if (bx-ax)*(qy-cy) - (by-ay)*(qx-cx) > 0 else 1
                    if anchors[side] is None or gap < anchors[side][0]:
                        anchors[side] = (gap,index,q)
                if any(anchor is None for anchor in anchors):
                    continue
                qa,qb = [anchor[2] for anchor in anchors]
                if not 3 < distance(qa,qb) < 15 or not base.land_access.clear(qa,qb):
                    continue
                if any(grade == ('0', False, False) and (c,d) not in ((points[a],points[b]),(points[b],points[a]))
                       and intersection(qa,qb,c,d) is not None for c,d,grade in base.nearby(qa,qb)):
                    continue
                identifier = f'simulated-junction-crossing-{way_id}-{node}-{other}'
                result.append(dict(id=identifier, kind='crossing', name='Simulated junction crossing',
                    routingSource='simulation', routingWayId=identifier, sourceRoadWayId=way_id,
                    junctionNodeId=node, fieldVerified=False,
                    coordinate=[(qa[i]+qb[i])/2 for i in (0,1)], geometry=[list(qa),list(qb)],
                    anchors=[dict(wayId=base.edges[index].way_id, kind=base.edges[index].kind,
                                  grade=list(base.edges[index].grade), coordinate=list(q)) for _,index,q in anchors]))
                placed[way_id].append(center)
    return result


def overlay_graph(base,facilities):
    graph=copy(base); graph.nodes=base.nodes.copy(); cuts=defaultdict(list); added=[]
    by_way=defaultdict(list)
    for i,edge in enumerate(base.edges): by_way[(edge.way_id,edge.kind,edge.grade)].append((i,edge))
    graph.navigation_facility_ids={f['routingWayId']:f['id'] for f in facilities}
    for facility in facilities:
        if facility['routingSource']!='simulation': continue
        anchors=[]
        for side,anchor in enumerate(facility['anchors']):
            choices=[]
            for i,edge in by_way[(anchor['wayId'],anchor['kind'],tuple(anchor['grade']))]:
                gap,f,q=base.project(anchor['coordinate'],edge)
                if gap<.05: choices.append((gap,i,f,q))
            if not choices: raise ValueError(f'Simulated facility lost its mapped approach: {facility["id"]}')
            _,i,f,q=min(choices); edge=base.edges[i]
            node=edge.a if f<1e-8 else edge.b if f>1-1e-8 else f'{facility["id"]}:entry:{side}'
            graph.nodes[node]=q
            if node not in (edge.a,edge.b): cuts[i].append((f,node,q))
            anchors.append((node,q))
        if not base.land_access.clear(anchors[0][1],anchors[1][1]):
            raise ValueError('Simulated crossing intersects a mapped physical obstacle')
        grade=('1',True,False) if facility['kind']=='footbridge' else ('0',False,False)
        added.append(Edge(anchors[0][0],anchors[1][0],(anchors[0][1],anchors[1][1]),facility['name'],
                          'demo_footbridge' if facility['kind']=='footbridge' else 'demo_crossing',facility['routingWayId'],grade=grade))
    graph.edges=[]
    for i,edge in enumerate(base.edges):
        entries=sorted([(0,edge.a,edge.points[0]),*cuts[i],(1,edge.b,edge.points[1])])
        graph.edges.extend(Edge(a[1],b[1],(a[2],b[2]),edge.name,edge.kind,edge.way_id,edge.direction,edge.grade)
                           for a,b in zip(entries,entries[1:]))
    graph.edges.extend(added); refresh_index(graph)
    return graph


@shared_graph_cache(maxsize=4)
def demo_walking_graph(area_id):
    from .areas import demo_area_dataset
    facilities=demo_area_dataset(area_id).dataset.get('navigationFacilities',[])
    return overlay_graph(walking_graph(area_id),facilities)
