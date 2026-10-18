"""OSM pedestrian graph with separate road sides and explicit crossing connections.

Road-side geometry is an inferred offset from the surveyed OSM centerline, not a
surveyed sidewalk. No spatial nearest-neighbor links or crossings are invented.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import heapq
import json
import math
from pathlib import Path
from uuid import uuid4
import xml.etree.ElementTree as ET

from .contracts import Maneuver, RouteGeometry, RouteResponse
from .provider import NavigationRejected
from .zones import route_intersects_zone

ROADS = {'residential', 'living_street', 'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link'}
ALL_ROADS = ROADS | {'primary','primary_link','trunk','trunk_link','motorway','motorway_link','road'}
PATHS = {'footway', 'path', 'steps', 'pedestrian', 'cycleway'}
OFFSET = 3.0
SCALE = 111_195.08


def xy(p):
    return (p[0] * SCALE * math.cos(math.radians(3.0)), p[1] * SCALE)


def coordinate(p):
    return (p[0] / (SCALE * math.cos(math.radians(3.0))), p[1] / SCALE)


def distance(a, b):
    a, b = xy(a), xy(b)
    return math.hypot(a[0]-b[0], a[1]-b[1])


def crossing(tags):
    # A bare highway=crossing or an unmarked crossing is insufficient evidence.
    if tags.get('crossing') in {'no', 'unmarked', 'uncontrolled'} and tags.get('crossing:markings') not in {'zebra', 'yes', 'ladder', 'lines', 'surface'}:
        return tags.get('crossing:signals') == 'yes'
    return (tags.get('crossing') in {'zebra', 'marked', 'traffic_signals', 'controlled', 'pelican', 'toucan'}
            or tags.get('crossing:markings') in {'zebra', 'yes', 'ladder', 'lines', 'surface'}
            or tags.get('crossing:signals') == 'yes')


def forbidden(tags):
    return (tags.get('foot') in {'no', 'private', 'use_sidepath'} or tags.get('locked') == 'yes'
            or tags.get('access') in {'no', 'private', 'customers', 'destination'} and tags.get('foot') not in {'yes', 'designated', 'permissive'}
            or tags.get('barrier') in {'wall', 'fence', 'retaining_wall', 'hedge'} )


def level(tags):
    # Separate grade even if malformed OSM shares a node between a bridge and road.
    return (tags.get('layer', '0'), tags.get('bridge', 'no') not in {'no', 'false'}, tags.get('tunnel', 'no') not in {'no', 'false'})


def side_offset(a, b, side):
    a, b = xy(a), xy(b)
    dx, dy = b[0]-a[0], b[1]-a[1]
    length = math.hypot(dx, dy)
    return coordinate((a[0]-dy/length*OFFSET*side, a[1]+dx/length*OFFSET*side))


def proper_intersection(a, b, c, d):
    def cross(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    a, b, c, d = map(xy, (a, b, c, d))
    return cross(a,b,c)*cross(a,b,d) < -1e-8 and cross(c,d,a)*cross(c,d,b) < -1e-8


@dataclass(frozen=True)
class Edge:
    a: str
    b: str
    points: tuple
    name: str
    kind: str
    way_id: str
    direction: int = 0
    grade: tuple = ('0', False, False)


class RoadsideGraph:
    def __init__(self, source, bounds):
        root = ET.parse(source).getroot()
        tags = lambda e: {t.attrib['k']: t.attrib['v'] for t in e.findall('tag')}
        points = {n.attrib['id']: (float(n.attrib['lon']), float(n.attrib['lat'])) for n in root.findall('node')}
        node_tags = {n.attrib['id']: tags(n) for n in root.findall('node')}
        self.bounds = tuple(bounds)
        self.nodes = {}
        self.edges = []
        self.carriageways = []
        roads, paths = defaultdict(list), defaultdict(list)
        ways = [(w.attrib['id'], [n.attrib['ref'] for n in w.findall('nd')], tags(w)) for w in root.findall('way')]
        for wid, refs, t in ways:
            highway = t.get('highway')
            grade = level(t)
            # Nonwalkable roads remain barriers; ignoring a motorway/foot=no road
            # must never permit a footpath to cut across it without a facility.
            if highway in ALL_ROADS:
                for a,b in zip(refs,refs[1:]):
                    if a not in points or b not in points or distance(points[a],points[b])<0.05: continue
                    pa,pb=points[a],points[b]
                    if max(pa[0],pb[0])<bounds[0] or min(pa[0],pb[0])>bounds[2] or max(pa[1],pb[1])<bounds[1] or min(pa[1],pb[1])>bounds[3]: continue
                    self.carriageways.append((pa,pb,grade))
                    roads[(a,grade)].append((math.atan2(pb[1]-pa[1],(pb[0]-pa[0])*math.cos(math.radians(pa[1]))),0,None,t,wid))
                    roads[(b,grade)].append((math.atan2(pa[1]-pb[1],(pa[0]-pb[0])*math.cos(math.radians(pb[1]))),0,None,t,wid))
            if highway not in ROADS | PATHS or forbidden(t) or t.get('area') == 'yes' or t.get('indoor') == 'yes':
                continue
            # Traffic speed/road class is not evidence of pedestrian permission on highways.
            high_speed = t.get('maxspeed', '0').isdigit() and float(t.get('maxspeed', '0')) > 60
            if highway in ROADS and (t.get('motorroad') == 'yes' or high_speed):
                continue
            grade = level(t)
            direction = 1 if t.get('oneway:foot') in {'yes','1','true'} or t.get('foot:backward') == 'no' else -1 if t.get('oneway:foot') == '-1' or t.get('foot:forward') == 'no' else 0
            for index, (a,b) in enumerate(zip(refs, refs[1:])):
                if a not in points or b not in points or a == b or forbidden(node_tags[a]) or forbidden(node_tags[b]):
                    continue
                pa, pb = points[a], points[b]
                if not self.inside(pa) or not self.inside(pb) or distance(pa,pb) < 0.05:
                    continue
                eid = f'{wid}:{index}'
                name = t.get('name', 'mapped footpath' if highway in PATHS else 'mapped local road')
                if highway in ROADS:
                    for side in (1,-1):
                        na, nb = f'{eid}:a:{side}', f'{eid}:b:{side}'
                        qa, qb = side_offset(pa,pb,side), side_offset(pb,pa,-side)
                        self.nodes.update({na:qa, nb:qb})
                        side_key = 'left' if side == 1 else 'right'
                        sidewalk = t.get(f'sidewalk:{side_key}', t.get('sidewalk', 'unknown'))
                        if sidewalk in {'separate', 'use_sidepath'}:
                            continue
                        kind = 'sidewalk' if sidewalk in {'yes','both',side_key} else 'road_fallback'
                        self.add(na,nb,name,kind,wid,direction,grade)
                        roads[(a,grade)].append((math.atan2(pb[1]-pa[1],(pb[0]-pa[0])*math.cos(math.radians(pa[1]))), side, na, t, wid))
                        roads[(b,grade)].append((math.atan2(pa[1]-pb[1],(pa[0]-pb[0])*math.cos(math.radians(pb[1]))), -side, nb, t, wid))
                else:
                    # Each arm remains separate at road nodes until a permitted crossing is proven.
                    na, nb = f'p:{eid}:a', f'p:{eid}:b'
                    self.nodes.update({na:pa, nb:pb})
                    kind = 'crossing' if crossing(t) else 'footbridge' if grade[1] else 'underpass' if grade[2] else 'footpath'
                    self.add(na,nb,name,kind,wid,direction,grade)
                    paths[(a,grade)].append((na,pb,t)); paths[(b,grade)].append((nb,pa,t))
        # Bounded spatial index keeps crossing checks local instead of comparing
        # every pair in an entire township at each route request.
        self.barrier_index=defaultdict(set)
        for i,(a,b,_) in enumerate(self.carriageways):
            for cell in self.cells(a,b): self.barrier_index[cell].add(i)
        # Remove same-grade pedestrian ways cutting through a road away from a
        # shared OSM crossing node. Bridges/underpasses have distinct grades.
        self.edges = [e for e in self.edges if e.kind not in {'footpath','footbridge','underpass'} or not any(
            e.grade == g and proper_intersection(*e.points,c,d) for c,d,g in self.nearby(*e.points))]
        # Prefer separately mapped parallel sidewalks instead of adding a road
        # fallback over the same section. This preserves a distance objective;
        # the displayed shortest route is not secretly optimized for a penalty.
        pedestrian_edges=[e for e in self.edges if e.kind in {'footpath','footbridge','underpass'}]
        def parallel_path(edge):
            a,b=map(xy,edge.points); dx,dy=b[0]-a[0],b[1]-a[1]
            for path in pedestrian_edges:
                if path.grade != edge.grade: continue
                c,d=map(xy,path.points); ex,ey=d[0]-c[0],d[1]-c[1]; length2=ex*ex+ey*ey
                if length2<0.01 or abs(dx*ex+dy*ey)<0.95*math.hypot(dx,dy)*math.sqrt(length2): continue
                fractions=[((p[0]-c[0])*ex+(p[1]-c[1])*ey)/length2 for p in (a,b)]
                if all(-0.01<=f<=1.01 for f in fractions) and all(math.hypot(p[0]-c[0]-f*ex,p[1]-c[1]-f*ey)<10 for p,f in zip((a,b),fractions)):
                    middle=lambda p,q:((p[0]+q[0])/2,(p[1]+q[1])/2)
                    pa,pb=middle(*edge.points),middle(*path.points)
                    if any(edge.grade==g and proper_intersection(pa,pb,c,d) for c,d,g in self.nearby(pa,pb)): continue
                    return True
            return False
        self.edges=[e for e in self.edges if e.kind!='road_fallback' or not parallel_path(e)]
        used = {n for e in self.edges for n in (e.a,e.b)}
        roads=defaultdict(list,{key:[arm for arm in arms if arm[2] is None or arm[2] in used] for key,arms in roads.items()})
        road_nodes={nid for (nid,_),arms in roads.items() if arms}
        # A mapped bridge/underpass can meet its mapped ground-level approach
        # where no road uses that node; no geometric proximity join is allowed.
        path_nodes=defaultdict(list)
        for (nid,grade),arms in paths.items():
            for port,_,_ in arms:
                if port in used: path_nodes[nid].append((port,grade))
        for nid,arms in path_nodes.items():
            if nid not in road_nodes:
                for port,grade in arms[1:]:
                    self.add(arms[0][0],port,'mapped pedestrian connection','connection','',grade=grade)
        for key in set(roads) | set(paths):
            nid, grade = key
            arms = roads[key]
            pedestrians = [p for p in paths[key] if p[0] in used]
            if not arms:
                for p in pedestrians[1:]:
                    self.add(pedestrians[0][0],p[0],'mapped path connection','connection','',grade=grade)
                continue
            incident_roads={wid for _,_,_,_,wid in arms}
            # A crossing node at a multi-road junction does not identify which
            # carriageway it serves. Do not let one marker connect every road.
            if node_tags[nid].get('crossing') != 'no' and crossing(node_tags[nid]) and len(incident_roads)==1:
                hub = f'crossing:{nid}:{grade}'
                self.nodes[hub] = points[nid]
                for _,_,port,_,_ in arms:
                    if port is None: continue
                    self.add(port,hub,'mapped pedestrian crossing','crossing',nid,grade=grade)
                for port,_,_ in pedestrians:
                    self.add(port,hub,'mapped pedestrian crossing','crossing',nid,grade=grade)
                continue
            # Adjacent radial arms bound one continuous road-side corner. Never
            # jump across an intervening carriageway, including T junctions.
            headings = sorted(set(angle for angle,_,_,_,_ in arms))
            for i, start in enumerate(headings):
                end = headings[(i+1)%len(headings)]
                sweep = (end-start) % (2*math.pi)
                if len(headings) == 1 or sweep > math.pi + 1e-5:
                    continue
                left = [port for angle,side,port,_,_ in arms if angle==start and side==1]
                right = [port for angle,side,port,_,_ in arms if angle==end and side==-1]
                members = left+right
                for port, other, _ in pedestrians:
                    angle = math.atan2(other[1]-points[nid][1],(other[0]-points[nid][0])*math.cos(math.radians(points[nid][1])))
                    if 1e-5 < (angle-start)%(2*math.pi) < sweep-1e-5:
                        # Move the approach port to its own side of the road.
                        origin, target = xy(points[nid]), xy(other)
                        length = math.hypot(target[0]-origin[0],target[1]-origin[1])
                        self.nodes[port] = coordinate((origin[0]+(target[0]-origin[0])*min(OFFSET/length,0.25),origin[1]+(target[1]-origin[1])*min(OFFSET/length,0.25)))
                        members.append(port)
                for port in members[1:]:
                    self.add(members[0],port,'same-side road corner','connection','',grade=grade)
        # Rebuild coordinates after adjusting path access ports; disallow inferred
        # corner shortcuts that would cut a carriageway or leave the service area.
        self.edges = [Edge(e.a,e.b,(self.nodes[e.a],self.nodes[e.b]),e.name,e.kind,e.way_id,e.direction,e.grade) for e in self.edges]
        self.edges = [e for e in self.edges if all(self.inside(p) for p in e.points) and (e.kind != 'connection' or not any(e.grade==g and proper_intersection(*e.points,c,d) for c,d,g in self.nearby(*e.points)))]

    @staticmethod
    def cells(a,b):
        a,b=xy(a),xy(b)
        for x in range(math.floor(min(a[0],b[0])/50)-1,math.floor(max(a[0],b[0])/50)+2):
            for y in range(math.floor(min(a[1],b[1])/50)-1,math.floor(max(a[1],b[1])/50)+2): yield x,y

    def nearby(self,a,b):
        seen=set()
        for cell in self.cells(a,b): seen.update(self.barrier_index.get(cell,()))
        return (self.carriageways[i] for i in seen)

    def inside(self,p):
        w,s,e,n = self.bounds
        return w <= p[0] <= e and s <= p[1] <= n

    def add(self,a,b,name,kind,way_id,direction=0,grade=('0',False,False)):
        self.edges.append(Edge(a,b,(self.nodes[a],self.nodes[b]),name,kind,way_id,direction,grade))

    def snap(self,point):
        p = xy(point); best = None
        for index, edge in enumerate(self.edges):
            if edge.kind in {'connection','crossing'}: continue
            a,b = map(xy,edge.points); dx,dy = b[0]-a[0],b[1]-a[1]
            length2 = dx*dx+dy*dy
            if length2 < 0.0001: continue
            fraction = max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2))
            q = coordinate((a[0]+fraction*dx,a[1]+fraction*dy))
            gap = distance(point,q)
            if gap > 50 or any(edge.grade==g and proper_intersection(point,q,c,d) for c,d,g in self.nearby(point,q)): continue
            candidate = (gap,index,fraction,q)
            if best is None or candidate[:2] < best[:2]: best = candidate
        if best is None: raise NavigationRejected(422,'Choose a nearby mapped walking access on the same side of the road; no unchecked road crossing can be added.')
        return best

    def validate_accessible_crossings(self,geometry):
        def follows(a,b,edge):
            c,d=map(xy,edge.points); dx,dy=d[0]-c[0],d[1]-c[1]; length2=dx*dx+dy*dy
            if length2<0.01: return False
            for p in map(xy,(a,b)):
                f=max(0,min(1,((p[0]-c[0])*dx+(p[1]-c[1])*dy)/length2))
                if math.hypot(p[0]-c[0]-f*dx,p[1]-c[1]-f*dy)>5: return False
            return True
        for a,b in zip(geometry,geometry[1:]):
            for c,d,grade in self.nearby(a,b):
                if proper_intersection(a,b,c,d) and not any(
                        (edge.kind=='crossing' or edge.grade!=grade and edge.kind in {'footpath','footbridge','underpass'})
                        and follows(a,b,edge) for edge in self.edges):
                    raise NavigationRejected(422,'This surveyed route crosses a road without a matching mapped crossing, footbridge or underpass. It cannot be offered under the walking crossing policy.')
        # A polyline can cross exactly at an intermediate OSM vertex: neither
        # adjacent segment has a proper interior intersection in that case.
        for i,p in enumerate(geometry[1:-1],1):
            for c,d,grade in self.nearby(p,p):
                cp,dp,pp=map(xy,(c,d,p)); vx,vy=dp[0]-cp[0],dp[1]-cp[1]; length2=vx*vx+vy*vy
                if length2<0.01: continue
                f=((pp[0]-cp[0])*vx+(pp[1]-cp[1])*vy)/length2
                if not 0<=f<=1 or math.hypot(pp[0]-cp[0]-f*vx,pp[1]-cp[1]-f*vy)>0.2: continue
                def side(q):
                    q=xy(q); return (vx*(q[1]-cp[1])-vy*(q[0]-cp[0]))/math.sqrt(length2)
                before=next((q for q in reversed(geometry[:i]) if abs(side(q))>0.2),None)
                after=next((q for q in geometry[i+1:] if abs(side(q))>0.2),None)
                if before is None or after is None or side(before)*side(after)>=0: continue
                # Match the local crossing arms, not a remote point elsewhere
                # on a bridge or an unrelated nearby crossing marker.
                if not any((edge.kind=='crossing' or edge.grade!=grade and edge.kind in {'footpath','footbridge','underpass'})
                           and (follows(before,p,edge) or follows(p,after,edge)) for edge in self.edges):
                    raise NavigationRejected(422,'This surveyed route crosses a road at an unmarked map node. A mapped pedestrian crossing, footbridge or underpass is required.')

    def route(self,body,snapshot=None,boxes=(),area_id='kl-east-pilot',community_supported=True):
        if body.route_mode == 'accessible':
            raise NavigationRejected(422,'No field-verified step-free network is available in this service area. Ordinary road walking cannot be labelled wheelchair accessible.')
        origin=(body.origin.longitude,body.origin.latitude); target=(body.destination.longitude,body.destination.latitude)
        start,end = self.snap(origin),self.snap(target)
        adjacency=defaultdict(list)
        def link(a,b,edge,pa,pb):
            length=distance(pa,pb)
            if any(route_intersects_zone([pa,pb],box) for box in boxes): return
            if edge.direction != -1: adjacency[a].append((b,length,edge,pa,pb))
            if edge.direction != 1: adjacency[b].append((a,length,edge,pb,pa))
        for i,edge in enumerate(self.edges):
            cuts=[(0.0,edge.a,edge.points[0]),(1.0,edge.b,edge.points[1])]
            if i==start[1]: cuts.append((start[2],'@start',start[3]))
            if i==end[1]: cuts.append((end[2],'@end',end[3]))
            cuts.sort(key=lambda row:row[0])
            for a,b in zip(cuts,cuts[1:]): link(a[1],b[1],edge,a[2],b[2])
        queue=[(0.0,'@start')]; best={'@start':0.0}; previous={}
        while queue:
            cost,node=heapq.heappop(queue)
            if cost != best[node]: continue
            if node=='@end': break
            for to,length,edge,pa,pb in adjacency[node]:
                candidate=cost+length
                if candidate < best.get(to,float('inf')):
                    best[to]=candidate; previous[to]=(node,edge,pa,pb,length)
                    heapq.heappush(queue,(candidate,to))
        if '@end' not in previous:
            raise NavigationRejected(422,'No connected walking route satisfies the mapped-crossing requirement. A zebra crossing, pedestrian signal, footbridge or underpass may be missing from the mapped network; choose another public access on the same side.')
        selected=[]; cursor='@end'
        while cursor in previous:
            before,edge,pa,pb,length=previous[cursor]; selected.append((edge,pa,pb,length)); cursor=before
        selected.reverse()
        geometry=[selected[0][1]]; maneuvers=[]; total=0.0
        kinds=set(); crossing_ids=set()
        for edge,pa,pb,length in selected:
            if length < 0.01: continue
            kinds.add(edge.kind)
            if edge.kind=='crossing': crossing_ids.add(edge.way_id)
            begin=len(geometry)-1; geometry.append(pb)
            text=(f'Use the mapped pedestrian crossing at {edge.name}.' if edge.kind=='crossing' else
                  f'Walk along the road side of {edge.name} for {length:.0f} meters; a sidewalk is not recorded.' if edge.kind=='road_fallback' else
                  f'Continue along {edge.name} for {length:.0f} meters.')
            maneuver_type=1 if not maneuvers else 8
            if len(geometry)>2 and edge.kind!='crossing':
                a,b,c=map(xy,geometry[-3:]); v=(b[0]-a[0],b[1]-a[1]); w=(c[0]-b[0],c[1]-b[1])
                turn=math.degrees(math.atan2(v[0]*w[1]-v[1]*w[0],v[0]*w[0]+v[1]*w[1]))
                if abs(turn)>30:
                    maneuver_type=15 if turn>0 else 10
                    text=('Turn left. ' if turn>0 else 'Turn right. ')+text
            maneuvers.append(Maneuver(index=len(maneuvers),type=maneuver_type,instruction=text,spoken_instruction=text,
                distance_meters=length,duration_seconds=length/1.2,begin_shape_index=begin,end_shape_index=begin+1,
                distance_from_start_meters=total,coordinate=pa))
            total+=length
        if not maneuvers or len(maneuvers)>=1999 or len(geometry)>20_000 or total>30_000:
            raise NavigationRejected(422,'This walking route exceeds the supported routing limits.')
        maneuvers.append(Maneuver(index=len(maneuvers),type=4,instruction='You have arrived at your destination.',spoken_instruction='You have arrived at your destination.',
            distance_meters=0,duration_seconds=0,begin_shape_index=len(geometry)-1,end_shape_index=len(geometry)-1,distance_from_start_meters=total,coordinate=geometry[-1]))
        return RouteResponse(route_id=uuid4(),generated_at=datetime.now(timezone.utc),area=area_id,route_mode=body.route_mode,
            routing_engine='osm_roadside',geometry=RouteGeometry(coordinates=geometry),distance_meters=total,duration_seconds=total/1.2,
            origin_snap_distance_meters=start[0],destination_snap_distance_meters=end[0],maneuvers=maneuvers,data_source='openstreetmap_unverified',
            road_fallback_used='road_fallback' in kinds,crossing_policy='mapped_facilities_only',mapped_crossing_count=len(crossing_ids),
            community_issue_avoidance=('applied' if boxes else 'no_active_obstacles') if snapshot else 'not_applied',
            obstacle_snapshot_at=snapshot.checked_at if snapshot else None,obstacle_count=len(boxes),obstacle_source='community_reports' if snapshot else None,
            warnings=[
                'Real OpenStreetMap walking coverage; road-side positions are inferred, not surveyed sidewalks.',
                'Only recorded marked/signal crossings or grade-separated paths connect opposite road sides. Missing map data can prevent routing.',
                'Road walking and endpoint approaches are not field verified or certified accessible. Check traffic and local access before proceeding.',
                *(['Community damage coverage is not enabled in this temporary area.'] if not community_supported else [] )])


@lru_cache(maxsize=4)
def walking_graph(area_id):
    from .areas import find_area
    root=Path(__file__).resolve().parents[1]/'data/demo_areas'
    area=find_area(area_id)
    if area is None or not area.routing_supported:
        raise ValueError('Unknown live service area')
    source=root/(area.id+'.osm')
    metadata=json.loads((root/(area.id+'-source.json')).read_text(encoding='utf-8'))
    if hashlib.sha256(source.read_bytes()).hexdigest() != metadata['source_xml_sha256']:
        raise ValueError('Road source checksum mismatch')
    return RoadsideGraph(source,area.bbox)
