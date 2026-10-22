"""OSM pedestrian graph with separate road sides and classified crossings.

Road-side geometry is an inferred offset from the surveyed OSM centerline, not a
surveyed sidewalk. Private local-road crossings follow the resident policy and
remain distinct from mapped pedestrian facilities.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from .graph_cache import shared_graph_cache
import hashlib
import heapq
import json
import math
from pathlib import Path
from uuid import uuid4
import xml.etree.ElementTree as ET

from .contracts import Maneuver, RouteGeometry, RouteResponse
from .provider import NavigationRejected
from .zones import BoundsIndex

ROADS = {'residential', 'living_street', 'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link'}
ALL_ROADS = ROADS | {'primary','primary_link','trunk','trunk_link','motorway','motorway_link','road'}
PATHS = {'footway', 'path', 'steps', 'pedestrian', 'cycleway'}
LOCAL_ROADS = {'residential', 'living_street', 'service', 'unclassified'}
LOCAL_CROSSING_SPACING = 25.0
OPEN_ACCESS_METERS = 20.0
ENDPOINT_ACCESS_METERS = 20.0
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


def forbidden(tags, *, resident_access=False):
    foot, access = tags.get('foot'), tags.get('access')
    permitted_foot = foot in {'yes', 'designated', 'permissive'}
    return (foot in {'no', 'use_sidepath'} or foot == 'private' and not resident_access
            or tags.get('locked') == 'yes'
            or access in {'no', 'customers', 'destination'} and not permitted_foot
            or access == 'private' and not (permitted_foot or resident_access)
            or tags.get('barrier') in {'wall', 'fence', 'retaining_wall', 'hedge'})


def private_local_crossing(tags):
    """Product policy for unmarked crossings; not evidence of a mapped facility."""
    if (tags.get('highway') not in LOCAL_ROADS
            or not (tags.get('access') == 'private' or tags.get('foot') == 'private')
            or forbidden(tags, resident_access=True) or tags.get('crossing') == 'no'
            or tags.get('motorroad') == 'yes' or level(tags) != ('0', False, False)):
        return False
    # Missing measurements use the minor residential-road classification. Known
    # high speed, multiple lanes, wide carriageways, or ambiguous values do not.
    for key, limit in (('maxspeed', 30), ('lanes', 2), ('width', 8)):
        value = tags.get(key)
        if value is None: continue
        try:
            numeric = value.removesuffix(' m') if key == 'width' else value
            number = float(numeric.removesuffix(' mph'))
            if key == 'maxspeed' and value.endswith(' mph'): number *= 1.609344
            if not math.isfinite(number) or number <= 0 or number > limit: return False
        except ValueError:
            return False
    return True


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


def coverage_bounds(root, service_bounds):
    """Use the downloaded road buffer for detours, not to admit new endpoints."""
    element = root.find('bounds')
    if element is None:
        return tuple(service_bounds)
    result = tuple(float(element.attrib[key]) for key in ('minlon','minlat','maxlon','maxlat'))
    w,s,e,n = result
    if (not all(math.isfinite(value) for value in result) or not -180 <= w < e <= 180
            or not -90 <= s < n <= 90 or w > service_bounds[0] or s > service_bounds[1]
            or e < service_bounds[2] or n < service_bounds[3]):
        raise ValueError('OSM extract must cover the endpoint service window')
    return result


class RoadsideGraph:
    def __init__(self, source, bounds, *, resident_access=False):
        root = ET.parse(source).getroot()
        tags = lambda e: {t.attrib['k']: t.attrib['v'] for t in e.findall('tag')}
        points = {n.attrib['id']: (float(n.attrib['lon']), float(n.attrib['lat'])) for n in root.findall('node')}
        node_tags = {n.attrib['id']: tags(n) for n in root.findall('node')}
        self.bounds = tuple(bounds)
        self.routing_bounds = coverage_bounds(root, self.bounds)
        bounds = self.routing_bounds
        self.nodes = {}
        self.edges = []
        self.carriageways = []
        self.private_way_ids = set()
        self.explicit_trunk_way_ids = set()
        local_segments = []
        roads, paths = defaultdict(list), defaultdict(list)
        ways = [(w.attrib['id'], [n.attrib['ref'] for n in w.findall('nd')], tags(w)) for w in root.findall('way')]
        for wid, refs, t in ways:
            highway = t.get('highway')
            explicit_trunk = highway == 'trunk' and t.get('access') == 'yes' and t.get('motorroad') != 'yes'
            walkable_road = highway in ROADS or explicit_trunk
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
            if not (walkable_road or highway in PATHS) or forbidden(t, resident_access=resident_access) or t.get('area') == 'yes' or t.get('indoor') == 'yes':
                continue
            if explicit_trunk:
                self.explicit_trunk_way_ids.add(wid)
            if t.get('access') == 'private' or t.get('foot') == 'private':
                self.private_way_ids.add(wid)
            # Traffic speed/road class is not evidence of pedestrian permission on highways.
            high_speed = t.get('maxspeed', '0').isdigit() and float(t.get('maxspeed', '0')) > 60
            if highway in ROADS and (t.get('motorroad') == 'yes' or high_speed):
                continue
            grade = level(t)
            direction = 1 if t.get('oneway:foot') in {'yes','1','true'} or t.get('foot:backward') == 'no' else -1 if t.get('oneway:foot') == '-1' or t.get('foot:forward') == 'no' else 0
            for index, (a,b) in enumerate(zip(refs, refs[1:])):
                if (a not in points or b not in points or a == b
                        or forbidden(node_tags[a], resident_access=resident_access)
                        or forbidden(node_tags[b], resident_access=resident_access)):
                    continue
                pa, pb = points[a], points[b]
                if not self.inside(pa) or not self.inside(pb) or distance(pa,pb) < 0.05:
                    continue
                eid = f'{wid}:{index}'
                name = t.get('name', 'mapped footpath' if highway in PATHS else 'mapped local road')
                if walkable_road:
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
                    if (resident_access and private_local_crossing(t)
                            and all(node_tags[n].get('crossing') != 'no' for n in (a,b))):
                        local_segments.append((eid, wid, pa, pb, name, grade))
                else:
                    # Each arm remains separate at road nodes until a permitted crossing is proven.
                    na, nb = f'p:{eid}:a', f'p:{eid}:b'
                    self.nodes.update({na:pa, nb:pb})
                    kind = 'steps' if highway == 'steps' else 'crossing' if crossing(t) else 'footbridge' if grade[1] else 'underpass' if grade[2] else 'footpath'
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
        prepared_paths=[]
        path_bounds=[]
        for path in pedestrian_edges:
            c,d=map(xy,path.points); ex,ey=d[0]-c[0],d[1]-c[1]
            prepared_paths.append((path,c,ex,ey,ex*ex+ey*ey))
            # The existing rule permits 1% extension and up to 10 m offset.
            # Index that whole envelope so no potentially matching path is lost.
            margin_x,margin_y=abs(ex)*0.01+10,abs(ey)*0.01+10
            west,south=coordinate((min(c[0],d[0])-margin_x,min(c[1],d[1])-margin_y))
            east,north=coordinate((max(c[0],d[0])+margin_x,max(c[1],d[1])+margin_y))
            path_bounds.append((west,south,east,north))
        path_index=BoundsIndex(path_bounds)
        def parallel_path(edge):
            a,b=map(xy,edge.points); dx,dy=b[0]-a[0],b[1]-a[1]
            for index in path_index.candidates(*edge.points):
                path,c,ex,ey,length2=prepared_paths[index]
                if path.grade != edge.grade: continue
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
        road_ports={port:(other,distance(*edge.points)) for edge in self.edges
                    if edge.kind in {'sidewalk','road_fallback'}
                    for port,other in ((edge.a,edge.b),(edge.b,edge.a))}
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
        for key in sorted(set(roads) | set(paths)):
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
                # The outer side of a bend has a sweep above 180 degrees, but
                # still belongs to one continuous road side. The geometric
                # carriageway check below rejects actual crossing shortcuts.
                if len(headings) == 1:
                    continue
                left = [port for angle,side,port,_,_ in arms if angle==start and side==1]
                right = [port for angle,side,port,_,_ in arms if angle==end and side==-1]
                if len(left)==len(right)==1:
                    self.join_corner(left[0],right[0],road_ports,grade)
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
        # A mapped road bridge/underpass ends at its shared OSM approach node.
        # Keep its two road sides continuous across that grade transition;
        # geometric intersections with unrelated roads still never connect.
        graded_roads=defaultdict(list)
        for (nid,grade),arms in roads.items():
            graded_roads[nid].extend((*arm,grade) for arm in arms)
        ground=('0',False,False)
        for nid,arms in graded_roads.items():
            if len({arm[-1] for arm in arms})<2: continue
            headings=sorted({arm[0] for arm in arms})
            for index,start in enumerate(headings):
                end=headings[(index+1)%len(headings)]
                left=[arm for arm in arms if arm[0]==start and arm[1]==1 and arm[2] is not None]
                right=[arm for arm in arms if arm[0]==end and arm[1]==-1 and arm[2] is not None]
                if len(left)!=1 or len(right)!=1: continue
                first,second=left[0],right[0];grades={first[-1],second[-1]}
                if ground not in grades or not any(grade[1] or grade[2] for grade in grades): continue
                self.join_corner(first[2],second[2],road_ports,ground)
                if any(grade in grades and proper_intersection(self.nodes[first[2]],self.nodes[second[2]],c,d)
                       for c,d,grade in self.nearby(self.nodes[first[2]],self.nodes[second[2]])): continue
                self.add(first[2],second[2],'mapped bridge approach','connection','',grade=ground)
        # Rebuild coordinates after adjusting path access ports; disallow inferred
        # corner shortcuts that would cut a carriageway or leave the service area.
        self.edges = [Edge(e.a,e.b,(self.nodes[e.a],self.nodes[e.b]),e.name,e.kind,e.way_id,e.direction,e.grade) for e in self.edges]
        self.edges = [e for e in self.edges if all(self.inside(p) for p in e.points) and (e.kind != 'connection' or not any(e.grade==g and proper_intersection(*e.points,c,d) for c,d,g in self.nearby(*e.points)))]
        self.add_local_crossings(local_segments)
        from .land_access import LandAccess
        self.land_access = LandAccess(root,points,node_tags,ways,resident_access=resident_access)
        self.add_open_access()
        self.components = self.connected_components()
        self.edge_index = BoundsIndex([(min(e.points[0][0],e.points[1][0]),min(e.points[0][1],e.points[1][1]),
                                       max(e.points[0][0],e.points[1][0]),max(e.points[0][1],e.points[1][1])) for e in self.edges])

    def connected_components(self):
        adjacency=defaultdict(list)
        for edge in self.edges:
            adjacency[edge.a].append(edge.b); adjacency[edge.b].append(edge.a)
        result={}
        for node in adjacency:
            if node in result: continue
            group=len(result); result[node]=group; pending=[node]
            while pending:
                for other in adjacency[pending.pop()]:
                    if other not in result: result[other]=group; pending.append(other)
        return result

    @staticmethod
    def project(point,edge):
        p,a,b=map(xy,(point,*edge.points)); dx,dy=b[0]-a[0],b[1]-a[1]
        length2=dx*dx+dy*dy
        f=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2)) if length2 else 0
        q=coordinate((a[0]+f*dx,a[1]+f*dy))
        return distance(point,q),f,q

    def access_clear(self,a,b,*,own_buildings=frozenset(),allow_road_endpoint=False):
        from .land_access import intersection
        if not self.land_access.clear(a,b,own_buildings=own_buildings): return False
        for c,d,grade in self.nearby(a,b):
            if grade != ('0',False,False): continue
            hit=intersection(a,b,c,d)
            if hit is None: continue
            at=(a[0]+(b[0]-a[0])*hit[0],a[1]+(b[1]-a[1])*hit[0])
            # A selected point may lie exactly on a road centreline. Contact
            # there does not authorize crossing a road farther along the link.
            if not allow_road_endpoint or min(distance(a,at),distance(b,at))>.01: return False
            middle=((a[0]+b[0])/2,(a[1]+b[1])/2)
            if self.land_access.segment_distance(middle,c,d)<.01 and distance(a,b)>.1: return False
        return True

    def add_open_access(self):
        """Connect disconnected ground approaches across clear gaps of at most 20 m.

        Dangling ports and closed-loop vertices can need repair. Indexed projections
        handle a long target path without requiring a nearby OSM vertex. Every
        inferred link remains an explicit edge, including for damage checks.
        """
        components=self.connected_components()
        degree=defaultdict(int); ports={}
        for edge in self.edges:
            for node in (edge.a,edge.b):
                degree[node]+=1
                if edge.grade==('0',False,False) and edge.kind in {'footpath','sidewalk','road_fallback','steps'}:
                    ports[node]=edge
        candidates=[(i,e) for i,e in enumerate(self.edges)
                    if e.grade==('0',False,False) and e.kind in {'footpath','sidewalk','road_fallback'}]
        from .land_access import bounds
        index=BoundsIndex([bounds(e.points) for _,e in candidates])
        cuts=defaultdict(list); links=[]; pairs=set()
        seen_positions=set(); seen_cells=set()
        for node in sorted(ports):
            if degree[node] not in (1,2): continue
            position=tuple(round(v,9) for v in self.nodes[node])
            if position in seen_positions: continue
            seen_positions.add(position)
            px,py=xy(self.nodes[node]); cell=(components[node],math.floor(px/15),math.floor(py/15))
            if degree[node]==2 and cell in seen_cells: continue
            seen_cells.add(cell)
            point=self.nodes[node]; delta=(OPEN_ACCESS_METERS+1e-6)/SCALE
            if not self.land_access.clear(point,point): continue
            nearby=index.candidates((point[0]-delta/math.cos(math.radians(3)),point[1]-delta),
                                    (point[0]+delta/math.cos(math.radians(3)),point[1]+delta))
            choices=defaultdict(list); best={}
            for j in nearby:
                i,edge=candidates[j]; group=components[edge.a]
                if group==components[node]: continue
                gap,f,q=self.project(point,edge)
                if not .05<gap<=OPEN_ACCESS_METERS+1e-6: continue
                choices[group].append((gap,i,f,q))
            for group,rows in choices.items():
                for gap,i,f,q in sorted(rows)[:8]:
                    if self.access_clear(point,q):
                        best[group]=(gap,i,f,q);break
            for gap,i,f,q in sorted(best.values())[:3]:
                edge=self.edges[i]
                target=edge.a if f<1e-8 else edge.b if f>1-1e-8 else f'open-access:{i}:{f:.9f}'
                pair=tuple(sorted((node,target)))
                if pair in pairs: continue
                pairs.add(pair); self.nodes[target]=q
                if target not in (edge.a,edge.b): cuts[i].append((f,target,q))
                links.append(Edge(node,target,(point,q),'inferred outdoor connection','open_access',''))
        rebuilt=[]
        for i,edge in enumerate(self.edges):
            entries=sorted(set([(0,edge.a,edge.points[0]),*cuts[i],(1,edge.b,edge.points[1])]))
            rebuilt.extend(Edge(a[1],b[1],(a[2],b[2]),edge.name,edge.kind,edge.way_id,edge.direction,edge.grade)
                           for a,b in zip(entries,entries[1:]))
        self.edges=[*rebuilt,*links]

    def join_corner(self,a,b,ports,grade):
        """Meet offset road sides at their intersection, rather than a backtrack.

        Connecting the untrimmed offsets with a diagonal creates two right
        turns for a left turn at an inside corner. Bounded mitres trim inside
        corners and extend outside corners without changing crossing policy.
        """
        if a not in ports or b not in ports: return
        other_a,length_a=ports[a]; other_b,length_b=ports[b]
        pa,pb,qa,qb=map(xy,(self.nodes[a],self.nodes[b],self.nodes[other_a],self.nodes[other_b]))
        def unit(p,q):
            length=math.hypot(q[0]-p[0],q[1]-p[1])
            return ((q[0]-p[0])/length,(q[1]-p[1])/length) if length>0.01 else (0,0)
        v,w=unit(pa,qa),unit(pb,qb)
        determinant=v[0]*w[1]-v[1]*w[0]
        if abs(determinant)<1e-5: return
        delta=(pb[0]-pa[0],pb[1]-pa[1])
        t=(delta[0]*w[1]-delta[1]*w[0])/determinant
        u=(delta[0]*v[1]-delta[1]*v[0])/determinant
        if abs(t)>OFFSET*4 or abs(u)>OFFSET*4 or t>length_a*.45 or u>length_b*.45: return
        corner=coordinate((pa[0]+t*v[0],pa[1]+t*v[1]))
        if not self.inside(corner): return
        for other in (other_a,other_b):
            if any(grade==g and proper_intersection(corner,self.nodes[other],c,d)
                   for c,d,g in self.nearby(corner,self.nodes[other])): return
        self.nodes[a]=self.nodes[b]=corner

    def add_local_crossings(self, segments):
        # Split paired sides of the SAME private road segment. There are no
        # proximity joins to other streets, opposite carriageways or buildings.
        by_start = {edge.a: edge for edge in self.edges if edge.kind in {'sidewalk','road_fallback'}}
        replacements = {}
        for eid, wid, pa, pb, name, grade in segments:
            sides = [by_start.get(f'{eid}:a:{side}') for side in (1,-1)]
            if any(edge is None for edge in sides): continue
            cuts = [[], []]
            count = max(1, math.ceil(distance(pa,pb)/LOCAL_CROSSING_SPACING))
            for index in range(count):
                fraction = (index+.5)/count
                positions = [tuple(a+(b-a)*fraction for a,b in zip(*edge.points)) for edge in sides]
                # Do not use a private lane crossing to cut any OTHER road.
                if any(grade==g and (c,d) not in ((pa,pb),(pb,pa)) and proper_intersection(*positions,c,d)
                       for c,d,g in self.nearby(*positions)):
                    continue
                for side in range(2):
                    node = f'local-crossing:{eid}:{index}:{side}'
                    self.nodes[node] = positions[side]
                    cuts[side].append((fraction,node,positions[side]))
                self.add(cuts[0][-1][1],cuts[1][-1][1],name,'unmarked_crossing',wid,grade=grade)
            for edge, entries in zip(sides,cuts):
                if not entries: continue
                entries = [(0,edge.a,edge.points[0]),*entries,(1,edge.b,edge.points[1])]
                replacements[edge] = [Edge(a[1],b[1],(a[2],b[2]),edge.name,edge.kind,
                    edge.way_id,edge.direction,edge.grade) for a,b in zip(entries,entries[1:])]
        self.edges = [part for edge in self.edges for part in replacements.get(edge,[edge])
                      if all(self.inside(p) for p in part.points)]

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
        w,s,e,n = self.routing_bounds
        return w <= p[0] <= e and s <= p[1] <= n

    def endpoint_inside(self,p):
        w,s,e,n = self.bounds
        return w <= p[0] <= e and s <= p[1] <= n

    def add(self,a,b,name,kind,way_id,direction=0,grade=('0',False,False)):
        self.edges.append(Edge(a,b,(self.nodes[a],self.nodes[b]),name,kind,way_id,direction,grade))

    def snap_candidates(self,point):
        buildings=self.land_access.buildings_at(point)
        if buildings and hasattr(self,'demo_building_entrances'):
            candidates=[]
            for building in sorted(buildings):
                index=self.demo_building_entrances.get(building)
                if index is None:continue
                entrance=self.edges[index].points[0]
                if self.access_clear(point,entrance,own_buildings=buildings,allow_road_endpoint=True):
                    candidates.append((distance(point,entrance),index,0.0,entrance))
            if not candidates:
                raise NavigationRejected(422,'No simulated step-free entrance is registered for this building.')
            return sorted(candidates)[:1]
        if not buildings:
            candidates=self._snap_candidates_within(point,buildings,ENDPOINT_ACCESS_METERS)
        else:
            # Building access has no arbitrary metre cap. Expand over the whole
            # declared routing area, stopping at the nearest usable mapped path.
            west,south,east,north=self.bounds
            reach=max(distance(point,corner) for corner in ((west,south),(west,north),(east,south),(east,north)))+1
            radius=ENDPOINT_ACCESS_METERS
            while True:
                radius=min(radius,reach)
                candidates=self._snap_candidates_within(point,buildings,radius)
                if candidates or radius>=reach: break
                radius*=2
            # Do not silently choose a more distant road just because it has a
            # connected route to the other endpoint. Building access is nearest.
            candidates=candidates[:1]
        if not candidates:
            raise NavigationRejected(422,'No mapped walking access is reachable under the 20 m outdoor gap or nearest-building-road rules. Choose another access point.')
        return candidates

    def _snap_candidates_within(self,point,buildings,radius):
        delta=(radius+1e-6)/SCALE; dx=delta/math.cos(math.radians(3))
        best={}
        for index in self.edge_index.candidates((point[0]-dx,point[1]-delta),(point[0]+dx,point[1]+delta)):
            edge=self.edges[index]
            if edge.kind in {'connection','unmarked_crossing','open_access','demo_crossing','demo_accessible_entrance'}: continue
            if distance(*edge.points)<.01: continue
            projected=self.project(point,edge)
            # Selecting a point on a genuine crossing must retain that crossing,
            # rather than snapping onto a nearby disconnected carriageway.
            if edge.kind=='crossing' and projected[0]>=.25: continue
            projections=[projected,
                         *[(distance(point,q),f,q) for f,q in ((0,edge.points[0]),(1,edge.points[1]))]]
            if edge.grade!=('0',False,False):
                # Elevated entrances can serve an endpoint in the building
                # they actually touch; proximity cannot raise an outdoor user
                # onto a bridge, tunnel or an unrelated floor.
                if edge.kind not in {'footbridge','underpass','demo_footbridge'}: continue
                projections=([projected] if projected[0]<.25 else [])+[
                    (distance(point,q),f,q) for f,q in ((0,edge.points[0]),(1,edge.points[1]))
                    if buildings and self.land_access.on_building_boundary(q,buildings)]
            if buildings:
                # A mapped ground path can run through a building footprint.
                # Associate to its boundary/outdoor section, not an indoor point.
                from .land_access import intersection
                for building in buildings:
                    for ring in self.land_access.polygons[building][1]:
                        for a,b in zip(ring,ring[1:]):
                            hit=intersection(*edge.points,a,b)
                            if hit is None: continue
                            fraction=hit[0]
                            q=tuple(a+(b-a)*fraction for a,b in zip(*edge.points))
                            projections.append((distance(point,q),fraction,q))
            for gap,fraction,q in projections:
                if not self.endpoint_inside(q): continue
                if (buildings and self.land_access.buildings_at(q)&buildings
                        and not self.land_access.on_building_boundary(q,buildings)): continue
                if gap>radius+1e-6 or not self.access_clear(point,q,own_buildings=buildings,allow_road_endpoint=True): continue
                candidate=(gap,index,fraction,q); group=self.components[edge.a]
                if group not in best or candidate[:2]<best[group][:2]: best[group]=candidate
        return sorted(best.values())

    def snap(self,point):
        return self.snap_candidates(point)[0]

    def matched_snaps(self,origin,target):
        starts=self.snap_candidates(origin); ends=self.snap_candidates(target)
        by_group={self.components[self.edges[e[1]].a]:e for e in ends}
        pairs=[(start,by_group[self.components[self.edges[start[1]].a]]) for start in starts
               if self.components[self.edges[start[1]].a] in by_group]
        if not pairs:
            raise NavigationRejected(422,'No connected walking route meets the road-crossing rules. Open-land access is allowed, but mapped barriers and roads without a permitted crossing still separate these locations.')
        # Select access independently of repairs and route mode. A damage zone
        # must not move the endpoints or silently pick an entrance beyond it.
        return min(pairs,key=lambda pair:(pair[0][0]+pair[1][0],pair[0][1],pair[1][1]))

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

    def route(self,body,snapshot=None,boxes=(),area_id='kl-east-pilot',community_supported=True,*,demo_mode=False,excluded_way_ids=()):
        if hasattr(self,'navigation_facility_ids') and not demo_mode:
            raise NavigationRejected(422,'Simulated infrastructure is available only in resident demo routing.')
        if body.route_mode == 'accessible' and not demo_mode:
            raise NavigationRejected(422,'No field-verified step-free network is available in this service area. Ordinary road walking cannot be labelled wheelchair accessible.')
        origin=(body.origin.longitude,body.origin.latitude); target=(body.destination.longitude,body.destination.latitude)
        if not all(self.endpoint_inside(point) for point in (origin,target)):
            raise NavigationRejected(422,'Choose both points inside the selected service area.')
        start,end = self.matched_snaps(origin,target)
        origin_building=bool(self.land_access.buildings_at(origin))
        target_building=bool(self.land_access.buildings_at(target))
        buildings=origin_building or target_building
        demo_step_free=demo_mode and getattr(self,'demo_step_free_policy',None)=='demo-step-free-v1'
        access_limit=ENDPOINT_ACCESS_METERS+1e-6 if demo_step_free else 5
        if body.route_mode=='accessible' and ((buildings and not demo_step_free) or (not origin_building and start[0]>access_limit) or (not target_building and end[0]>access_limit)):
            raise NavigationRejected(422,'The building exit or open-land approach is assumed, not verified step-free access.')
        adjacency=defaultdict(list)
        zone_index=BoundsIndex(boxes)
        def link(a,b,edge,pa,pb):
            if edge.way_id in excluded_way_ids:return
            if body.route_mode=='accessible':
                if edge.kind in {'steps','unmarked_crossing','open_access'}:return
                if edge.kind in {'demo_crossing','demo_footbridge','demo_step_free_link','demo_accessible_entrance'} and not (
                    demo_step_free and edge.way_id in self.step_free_facility_way_ids):return
            length=distance(pa,pb)
            if zone_index.intersects(pa,pb): return
            if edge.direction != -1: adjacency[a].append((b,length,edge,pa,pb))
            if edge.direction != 1: adjacency[b].append((a,length,edge,pb,pa))
        for i,edge in enumerate(self.edges):
            cuts=[(0.0,edge.a,edge.points[0]),(1.0,edge.b,edge.points[1])]
            if i==start[1]: cuts.append((start[2],'@start',start[3]))
            if i==end[1]: cuts.append((end[2],'@end',end[3]))
            cuts.sort(key=lambda row:row[0])
            for a,b in zip(cuts,cuts[1:]): link(a[1],b[1],edge,a[2],b[2])
        if zone_index.intersects(origin,start[3]) or zone_index.intersects(end[3],target):
            raise NavigationRejected(422,'A walking approach intersects a reported damaged area; choose another access point.')
        # Lexicographic cost: recorded roads/facilities first. Only when they
        # cannot connect the fixed endpoints do inferred <=20 m gaps participate.
        # The second component remains actual walked distance, never a reported penalty.
        queue=[((0.0,0.0),'@start')]; best={'@start':(0.0,0.0)}; previous={}
        while queue:
            cost,node=heapq.heappop(queue)
            if cost != best[node]: continue
            if node=='@end': break
            for to,length,edge,pa,pb in adjacency[node]:
                candidate=(cost[0]+(length if edge.kind in {'open_access','demo_step_free_link'} else 0.0),cost[1]+length)
                if candidate < best.get(to,(float('inf'),float('inf'))):
                    best[to]=candidate; previous[to]=(node,edge,pa,pb,length)
                    heapq.heappush(queue,(candidate,to))
        if '@end' not in previous:
            raise NavigationRejected(422,'No connected walking route meets the road-crossing rules. Private local roads may be crossed under the resident policy; other roads require a mapped crossing, footbridge or underpass. Try another access point.')
        selected=[]; cursor='@end'
        while cursor in previous:
            before,edge,pa,pb,length=previous[cursor]; selected.append((edge,pa,pb,length)); cursor=before
        selected.reverse()
        # Show and count outdoor approaches rather than silently teleporting a
        # user from open land to the path. Indoor travel remains an association
        # to the entrance: we have no surveyed floor plan or exit directions.
        start_approach=start[0]>5 and not origin_building
        end_approach=end[0]>5 and not target_building
        if start_approach:
            selected.insert(0,(Edge('@origin','@start',(origin,start[3]),'outdoor approach','open_access',''),origin,start[3],start[0]))
        if end_approach:
            selected.append((Edge('@end','@target',(end[3],target),'outdoor approach','open_access',''),end[3],target,end[0]))
        geometry=[selected[0][1]]; maneuvers=[]; total=0.0
        kinds=set(); crossing_ids=set(); unmarked_ids=set(); simulated_ids=set(); facility_ids=set()
        for edge,pa,pb,length in selected:
            if length < 0.01: continue
            kinds.add(edge.kind)
            if edge.kind in {'crossing','footbridge','underpass'}: crossing_ids.add(edge.way_id)
            if edge.kind=='unmarked_crossing': unmarked_ids.add((edge.a,edge.b))
            if edge.kind in {'demo_crossing','demo_footbridge'}: simulated_ids.add(edge.way_id)
            facility_id=getattr(self,'navigation_facility_ids',{}).get(edge.way_id)
            if facility_id: facility_ids.add(facility_id)
            begin=len(geometry)-1; geometry.append(pb)
            travel=f' for {length:.0f} meters' if length>=1 else ''
            text=(f'Use the mapped pedestrian crossing at {edge.name}.' if edge.kind=='crossing' else
                  f'Cross the private local road at {edge.name} when traffic is clear; this is an unmarked crossing.' if edge.kind=='unmarked_crossing' else
                  f'Walk along the road side of {edge.name}{travel}; a sidewalk is not recorded.' if edge.kind=='road_fallback' else
                  f'Use the mapped footbridge at {edge.name}{travel}.' if edge.kind=='footbridge' else
                  f'Use the mapped underpass at {edge.name}{travel}.' if edge.kind=='underpass' else
                  f'Use the simulated dropped-kerb crossing{travel}. This facility exists only in the demo.' if demo_step_free and edge.kind=='demo_crossing' else
                  f'Use the simulated zebra crossing{travel}. This facility exists only in the demo.' if edge.kind=='demo_crossing' else
                  f'Use the simulated lift-access footbridge{travel}. This facility exists only in the demo.' if demo_step_free and edge.kind=='demo_footbridge' else
                  f'Take the simulated footbridge{travel}. This facility exists only in the demo.' if edge.kind=='demo_footbridge' else
                  f'Use the simulated building entrance ramp{travel}. Indoor access to this entrance is assumed for the demo.' if edge.kind=='demo_accessible_entrance' else
                  f'Use the simulated step-free ramp connector{travel}. This facility exists only in the demo.' if edge.kind=='demo_step_free_link' else
                  f'Walk across the open area{travel}; this connection is inferred.' if edge.kind=='open_access' else
                  'Continue along the path.' if edge.kind=='connection' else
                  f'Continue along {edge.name}{travel}.')
            maneuver_type=1 if not maneuvers else 8
            if len(geometry)>2 and edge.kind not in {'crossing','unmarked_crossing','demo_crossing'}:
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
            origin_snap_distance_meters=0 if start_approach else start[0],destination_snap_distance_meters=0 if end_approach else end[0],maneuvers=maneuvers,data_source='openstreetmap_unverified',
            road_fallback_used='road_fallback' in kinds,
            crossing_policy='resident_local_roads' if unmarked_ids else 'mapped_facilities_only',
            mapped_crossing_count=len(crossing_ids),unmarked_crossing_count=len(unmarked_ids),
            simulated_crossing_count=len(simulated_ids),demo_facility_ids=sorted(facility_ids),
            accessibility_status='synthetic_network' if demo_mode and body.route_mode == 'accessible' else 'not_requested',
            community_issue_avoidance=('applied' if boxes else 'no_active_obstacles') if snapshot else 'not_applied',
            obstacle_snapshot_at=snapshot.checked_at if snapshot else None,obstacle_count=len({item.issue_id for item in snapshot.items}) if snapshot else 0,obstacle_source='community_reports' if snapshot else None,
            warnings=[
                'Real OpenStreetMap walking coverage; road-side positions are inferred, not surveyed sidewalks.',
                ('Includes unmarked private local-road crossings under the resident policy; these are not mapped zebra crossings or verified step-free connections.'
                 if unmarked_ids else 'Uses simulated crossing facilities; this route is for demo testing only.' if simulated_ids
                 else 'This route uses only mapped pedestrian facilities when crossing roads. Missing map data can prevent routing.'),
                'Road walking and endpoint approaches are not field verified or certified accessible. Check traffic and local access before proceeding.',
                *(['Includes roadside walking on trunk roads explicitly tagged access=yes under the selected product policy; no surveyed sidewalk or safe crossing is implied.']
                  if any(edge.way_id in self.explicit_trunk_way_ids for edge,_,_,_ in selected) else []),
                *(['Includes a detour along recorded roads in the OSM extract buffer outside the endpoint service window.']
                  if any(not self.endpoint_inside(point) for point in geometry) else []),
                *(['Includes inferred outdoor connections across open land; these are not mapped or field-verified footpaths.']
                  if 'open_access' in kinds else []),
                *(['Building endpoint access is assumed. The route begins or ends at the associated outdoor path or mapped building entrance; indoor directions are not provided.']
                  if buildings else []),
                *(['Indoor travel to or from the associated entrance is not included in the route distance.']
                  if buildings else []),
                *(['Includes private residential ways under the app resident-access policy for verified residents of supported service areas.']
                  if any(edge.way_id in self.private_way_ids for edge,_,_,_ in selected) else []),
                *(['Demo-only route: facility damage and step-free annotations are simulated and not field verified.'] if demo_mode else []),
                *(['Hypothetical dropped kerbs, lift-access bridges, paved ramp connectors and permitted outdoor approaches up to 20m; registered building entrance ramps assume indoor step-free access for this demo. No surveyed accessibility is implied.'] if demo_step_free else []),
                *(['Simulated bridges/crossings are fictional and must not be used as directions for a real road crossing.'] if simulated_ids else []),
                *(['Community damage coverage is not enabled in this temporary area.'] if not community_supported else [] )])


@shared_graph_cache(maxsize=4)
def walking_graph(area_id):
    """Resident/staff routing only; callers enforce authenticated API access.

    Active verified residents are treated as residents of every enabled service
    area. Private ways are included under that product policy; accounts currently
    have no per-township membership mapping.
    """
    from .areas import find_area
    root=Path(__file__).resolve().parents[1]/'data/demo_areas'
    area=find_area(area_id)
    if area is None or not area.routing_supported:
        raise ValueError('Unknown live service area')
    source=root/(area.id+'.osm')
    metadata=json.loads((root/(area.id+'-source.json')).read_text(encoding='utf-8'))
    if hashlib.sha256(source.read_bytes()).hexdigest() != metadata['source_xml_sha256']:
        raise ValueError('Road source checksum mismatch')
    from .road_cache import read_graph
    cached=read_graph(root/(area.id+'-routing.json.gz'),source,area.bbox)
    return cached if cached is not None else RoadsideGraph(source,area.bbox,resident_access=True)
