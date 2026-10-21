"""Explicit hypothetical step-free facilities; no benchmark inputs and no Live use."""
from collections import defaultdict
from copy import copy
import hashlib
import json
from .demo_network import demo_walking_graph,refresh_index
from .graph_cache import shared_graph_cache
from .roadside import Edge,distance,RoadsideGraph
from .land_access import intersection
from .provider import NavigationRejected

VERSION='demo-step-free-v1'
SPECIAL={'unmarked_crossing','demo_crossing','demo_footbridge','crossing'}

def edge_key(edge):
    return (edge.a,edge.b,edge.kind,edge.way_id,edge.direction,edge.grade)

def excluded_ways(dataset):
    return {str(e['osmWayId']) for e in dataset['edges'] if e.get('mappedHasSteps') is True or e.get('baseStepFree') is False}

def facility_for(area_id,edge):
    source={'a':edge.a,'b':edge.b,'kind':edge.kind,'wayId':edge.way_id,'direction':edge.direction,'grade':list(edge.grade)}
    digest=hashlib.sha256(json.dumps([area_id,source,edge.points],sort_keys=True,separators=(',',':')).encode()).hexdigest()[:24]
    identifier='simulated-sf-'+digest
    bridge=edge.kind=='demo_footbridge'
    kind='footbridge' if bridge else 'step_free_path' if edge.kind=='open_access' else 'crossing'
    name='Simulated lift-access footbridge' if bridge else 'Simulated step-free ramp connector' if kind=='step_free_path' else 'Simulated dropped-kerb crossing'
    return dict(id=identifier,kind=kind,name=name,routingSource='simulation',routingWayId=identifier,
        coordinate=[sum(p[i] for p in edge.points)/2 for i in (0,1)],geometry=[list(p) for p in edge.points],
        fieldVerified=False,stepFree=True,accessFeatures=['lifts_at_both_ends'] if bridge else ['paved_ramp'] if kind=='step_free_path' else ['dropped_kerbs_at_both_ends'],sourceEdge=source)

def building_entrances(area_id,graph,excluded):
    """One nearest eligible outdoor ramp per mapped building, independent of routes.

    Indoor travel to that entrance is an explicit demo assumption. The outdoor
    ramp is still <=20m and cannot cross another building, water, a wall or an
    unpermitted carriageway. Only buildings in the endpoint service window need
    entrances; no audit coordinates or results participate in placement.
    """
    result=[];pad=20.01/111000
    for building,(kind,rings) in enumerate(graph.land_access.polygons):
        if kind!='building':continue
        ring=rings[0];west=min(p[0] for p in ring);east=max(p[0] for p in ring)
        south=min(p[1] for p in ring);north=max(p[1] for p in ring)
        if not any(graph.endpoint_inside(p) for p in ring):continue
        choices=[]
        for index in sorted(graph.edge_index.candidates((west-pad,south-pad),(east+pad,north+pad))):
            edge=graph.edges[index]
            if edge.kind not in {'footpath','sidewalk','road_fallback','connection'} or edge.grade!=('0',False,False) or edge.way_id in excluded:continue
            for a,b in zip(ring,ring[1:]):
                boundary=Edge('a','b',(a,b),'','', '')
                for p in (a,b):
                    gap,f,q=graph.project(p,edge);choices.append((gap,index,f,q,tuple(p)))
                for f,q in ((0,edge.points[0]),(1,edge.points[1])):
                    gap,_,p=graph.project(q,boundary);choices.append((gap,index,f,q,p))
                hit=intersection(*edge.points,a,b)
                if hit is not None:
                    f=hit[0];q=tuple(a+(b-a)*f for a,b in zip(*edge.points));choices.append((0,index,f,q,q))
        for gap,index,f,q,p in sorted(choices):
            if gap>20+1e-6:break
            own=frozenset({building})
            if not graph.endpoint_inside(q) or not graph.endpoint_inside(p):continue
            if graph.land_access.buildings_at(q)&own and not graph.land_access.on_building_boundary(q,own):continue
            if not graph.access_clear(p,q,own_buildings=own,allow_road_endpoint=True):continue
            edge=graph.edges[index]
            record=facility_for(area_id,edge)
            digest=hashlib.sha256(json.dumps([area_id,ring,p,q],separators=(',',':')).encode()).hexdigest()[:24]
            record.update(id='simulated-sf-entrance-'+digest,routingWayId='simulated-sf-entrance-'+digest,
                kind='accessible_entrance',name='Simulated step-free building entrance',coordinate=list(p),
                geometry=[list(p),list(q)],buildingIndex=building,anchorFraction=f,
                accessFeatures=['entrance_ramp','assumed_indoor_step_free_access'])
            result.append(record);break
    return result

def add_building_entrances(graph,records):
    by_source={edge_key(e):i for i,e in enumerate(graph.edges)}
    cuts=defaultdict(list);added=[];graph.nodes=graph.nodes.copy()
    for record in records:
        source=record['sourceEdge'];key=(source['a'],source['b'],source['kind'],source['wayId'],source['direction'],tuple(source['grade']))
        index=by_source[key];edge=graph.edges[index];f=record['anchorFraction']
        p,q=map(tuple,record['geometry'])
        anchor=edge.a if f<1e-8 else edge.b if f>1-1e-8 else record['id']+':road'
        entrance=record['id']+':entrance'
        graph.nodes[anchor]=q;graph.nodes[entrance]=p
        if anchor not in (edge.a,edge.b):cuts[index].append((f,anchor,q))
        added.append(Edge(entrance,anchor,(p,q),record['name'],'demo_accessible_entrance',record['id']))
    edges=[]
    for index,edge in enumerate(graph.edges):
        entries=sorted([(0,edge.a,edge.points[0]),*cuts[index],(1,edge.b,edge.points[1])])
        edges.extend(Edge(a[1],b[1],(a[2],b[2]),edge.name,edge.kind,edge.way_id,edge.direction,edge.grade) for a,b in zip(entries,entries[1:]))
    graph.edges=edges+added
    lookup={e.way_id:i for i,e in enumerate(graph.edges) if e.kind=='demo_accessible_entrance'}
    graph.demo_building_entrances={r['buildingIndex']:lookup[r['id']] for r in records}

def generate_accessibility(area_id,graph,dataset):
    excluded=excluded_ways(dataset);parent={key:key for key in graph.nodes}
    def find(key):
        while parent[key]!=key:parent[key]=parent[parent[key]];key=parent[key]
        return key
    def join(a,b):
        a,b=find(a),find(b)
        if a==b:return False
        parent[b]=a;return True
    facilities={};gaps=[]
    for edge in graph.edges:
        if edge.kind=='steps' or edge.way_id in excluded:continue
        if edge.kind=='open_access':gaps.append(edge);continue
        if edge.kind in SPECIAL:
            if not graph.land_access.clear(*edge.points):continue
            item=facility_for(area_id,edge);facilities[item['id']]=item
        join(edge.a,edge.b)
    # Add only short hypothetical ramps needed to connect otherwise separate
    # recorded-road components. Existing road detours remain preferable.
    for edge in sorted(gaps,key=lambda e:(distance(*e.points),edge_key(e))):
        if distance(*edge.points)>20+1e-6 or not graph.land_access.clear(*edge.points):continue
        if not graph.access_clear(*edge.points,allow_road_endpoint=True):continue
        if join(edge.a,edge.b):
            item=facility_for(area_id,edge);facilities[item['id']]=item
    for item in building_entrances(area_id,graph,excluded):facilities[item['id']]=item
    return [facilities[key] for key in sorted(facilities)]

class SharedWalkingGraph(RoadsideGraph):
    """Ordinary walkers may use every modelled facility, including stairs.

    Registered building entrances are shared with the accessible graph. Buildings
    without a registered ramp keep their existing ordinary nearest-road access.
    """
    def snap_candidates(self, point):
        buildings=self.land_access.buildings_at(point)
        if not buildings:
            return super().snap_candidates(point)
        try:
            return super().snap_candidates(point)
        except NavigationRejected:
            # A registered ramp may be unreachable from this part of a building
            # (e.g. a concave footprint or an intervening wall). Ordinary walking
            # still has its own nearest usable road access; registration must
            # not remove it. The step-free graph keeps its entrance-only policy.
            view=copy(self)
            del view.demo_building_entrances
            return RoadsideGraph.snap_candidates(view,point)

def accessible_graph(base,facilities,dataset,*,include_ordinary=False):
    # Validate the checked-in manifest against its geographic generator. No
    # request can invent a crossing or silently label an ordinary graph accessible.
    area_id=dataset['demoAccessibility']['areaId']
    expected=generate_accessibility(area_id,base,dataset)
    policy=dataset['demoAccessibility']
    if (facilities!=expected or policy.get('version')!=VERSION or policy.get('source')!='simulation'
        or policy.get('fieldVerified') is not False or policy.get('outdoorApproachMeters')!=20
        or policy.get('buildingApproach')!='simulated_registered_entrances'):
        raise ValueError('Invalid simulated accessibility manifest')
    by_source={tuple([r['sourceEdge']['a'],r['sourceEdge']['b'],r['sourceEdge']['kind'],r['sourceEdge']['wayId'],r['sourceEdge']['direction'],tuple(r['sourceEdge']['grade'])]):r for r in facilities if r['kind']!='accessible_entrance'}
    excluded=excluded_ways(dataset);graph=copy(base);graph.edges=[];seen=set()
    if include_ordinary:graph.__class__=SharedWalkingGraph
    for edge in base.edges:
        if not include_ordinary and (edge.kind=='steps' or edge.way_id in excluded):continue
        if edge.kind in SPECIAL or edge.kind=='open_access':
            record=by_source.get(edge_key(edge))
            if record is None:
                if include_ordinary:graph.edges.append(edge)
                continue
            if record['id'] in seen:continue
            seen.add(record['id'])
            # A manifest-backed paved ramp is a modelled facility for ordinary
            # walking. Unmodelled open_access gaps remain fallback-only.
            kind=('ramp' if include_ordinary else 'demo_step_free_link') if edge.kind=='open_access' else 'demo_footbridge' if edge.kind=='demo_footbridge' else 'demo_crossing'
            graph.edges.append(Edge(edge.a,edge.b,edge.points,record['name'],kind,record['id'],edge.direction,edge.grade))
        else:graph.edges.append(edge)
    add_building_entrances(graph,[f for f in facilities if f['kind']=='accessible_entrance'])
    graph.navigation_facility_ids={**(getattr(base,'navigation_facility_ids',{}) if include_ordinary else {}),**{f['routingWayId']:f['id'] for f in facilities}}
    graph.demo_step_free_policy=VERSION
    graph.step_free_facility_way_ids=set(graph.navigation_facility_ids)
    refresh_index(graph)
    return graph

@shared_graph_cache(maxsize=2)
def demo_step_free_graph(area_id):
    from .areas import demo_area_dataset
    dataset=demo_area_dataset(area_id).dataset
    return accessible_graph(demo_walking_graph(area_id),dataset['accessibilityFacilities'],dataset)


@shared_graph_cache(maxsize=2)
def shared_demo_walking_graph(area_id):
    from .areas import demo_area_dataset
    dataset=demo_area_dataset(area_id).dataset
    return accessible_graph(demo_walking_graph(area_id),dataset['accessibilityFacilities'],dataset,include_ordinary=True)
