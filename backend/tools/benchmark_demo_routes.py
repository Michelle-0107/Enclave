"""Seeded, fixed-sample routing audit. Failures stay in the denominator."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import random
import statistics
import time
import xml.etree.ElementTree as ET

from backend.navigation.areas import service_areas
from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.roadside import distance, walking_graph, xy, coordinate
from backend.navigation.provider import NavigationRejected

ROOT=Path(__file__).resolve().parents[1]
CATEGORIES=('cross_road','same_side','local_streets','long_distance')


def samples(seed=20261019,count=30,*,walking_eligible=False):
    rng=random.Random(seed); result=[]
    for area in service_areas().items:
        if not area.resident_demo_supported: continue
        graph=walking_graph(area.id)
        paths=[e for e in graph.edges if e.kind in {'footpath','sidewalk','road_fallback'} and e.grade==('0',False,False) and distance(*e.points)>15
               and all(graph.endpoint_inside(p) for p in e.points)]
        roads=[e for e in paths if e.kind in {'sidewalk','road_fallback'}]
        root=ET.parse(ROOT/'data/demo_areas'/f'{area.id}.osm').getroot()
        minor_ids={way.attrib['id'] for way in root.findall('way')
                   if any(t.attrib['k']=='highway' and t.attrib['v'] in {'residential','service','living_street','unclassified'} for t in way.findall('tag'))}
        minor_roads=[e for e in roads if e.way_id in minor_ids]
        sampled_roads=graph.carriageways
        if walking_eligible:
            # Eligibility uses mapped walking coverage and endpoint access only.
            # Never compare components or call route() while choosing samples.
            road_ids={e.way_id for e in roads}
            points={n.attrib['id']:(float(n.attrib['lon']),float(n.attrib['lat'])) for n in root.findall('node')}
            segments=set()
            for way in root.findall('way'):
                if way.attrib['id'] not in road_ids: continue
                refs=[n.attrib['ref'] for n in way.findall('nd')]
                segments.update((points[a],points[b]) for a,b in zip(refs,refs[1:]) if a in points and b in points)
            sampled_roads=[(a,b,g) for a,b,g in graph.carriageways if (a,b) in segments
                           and all(graph.endpoint_inside(p) for p in (a,b))]
        def at(edge):
            t=rng.uniform(.15,.85)
            return tuple(a+(b-a)*t for a,b in zip(*edge.points))
        def valid(point):
            if not graph.endpoint_inside(point): return False
            if not graph.land_access.clear(point,point,own_buildings=graph.land_access.buildings_at(point)): return False
            if walking_eligible:
                try: graph.snap_candidates(point)
                except NavigationRejected: return False
            return True
        for category in CATEGORIES:
            seen=set(); rows=[]; attempts=0
            while len(rows)<count and attempts<100_000:
                attempts+=1
                if category=='cross_road':
                    c,d,grade=rng.choice(sampled_roads)
                    if grade!=('0',False,False) or distance(c,d)<20: continue
                    c,d=xy(c),xy(d);length=distance(coordinate(c),coordinate(d));t=rng.uniform(.2,.8)
                    vx,vy=(d[0]-c[0])/length,(d[1]-c[1])/length
                    center=(c[0]+t*(d[0]-c[0]),c[1]+t*(d[1]-c[1]))
                    a=coordinate((center[0]-vy*8,center[1]+vx*8))
                    b=coordinate((center[0]+vy*8,center[1]-vx*8))
                elif category=='same_side':
                    edge=rng.choice(roads)
                    lo,hi=rng.uniform(.05,.30),rng.uniform(.70,.95)
                    a=tuple(x+(y-x)*lo for x,y in zip(*edge.points))
                    b=tuple(x+(y-x)*hi for x,y in zip(*edge.points))
                    if distance(a,b)<15: continue
                else:
                    one,two=rng.sample(minor_roads if category=='local_streets' else paths,2)
                    if one.way_id==two.way_id: continue
                    a,b=at(one),at(two);gap=distance(a,b)
                    if category=='local_streets' and not 50<=gap<=500: continue
                    if category=='long_distance' and gap<800: continue
                if not all(valid(point) for point in (a,b)): continue
                key=tuple(round(v,7) for point in (a,b) for v in point)
                if key in seen: continue
                seen.add(key)
                if rng.random()<.5: a,b=b,a
                rows.append({'id':f'{area.id}-{category}-{len(rows)+1:02d}','area':area.id,'category':category,
                             'origin':list(a),'destination':list(b)})
            if len(rows)!=count: raise RuntimeError(f'Cannot sample {count} distinct {area.id}/{category} pairs')
            result.extend(rows)
    return {'seed':seed,'per_category_per_area':count,'walking_eligible':walking_eligible,'eligibility':
            ('Endpoints inside the service window on mapped walking/roadside coverage; cross-road samples use roads with mapped walking access. Both endpoints must independently satisfy the existing 20 m outdoor/nearest-building access policy. Known physical endpoint obstacles excluded. No connected-component or route-success filtering.' if walking_eligible else
             'Mapped ground walking/roadside points or opposite sides of a sampled road; known physical endpoint obstacles excluded. No connected-component or route-success filtering.'),
            'cases':result}


def evaluate(sample,*,demo=False):
    if demo:
        from backend.navigation.demo_network import demo_walking_graph
        factory=demo_walking_graph
    else: factory=walking_graph
    results=[]
    for case in sample['cases']:
        graph=factory(case['area'])
        a,b=case['origin'],case['destination']; begin=time.perf_counter()
        row={**case,'success':False}
        try:
            route=graph.route(WalkingRouteRequest(origin={'longitude':a[0],'latitude':a[1]},destination={'longitude':b[0],'latitude':b[1]}),demo_mode=demo,area_id=case['area'])
            if case['category']=='cross_road':
                # Availability and actual facility traversal are separate:
                # a valid walk around a dead-end road need not cross its lanes.
                crossed=(route.mapped_crossing_count+route.unmarked_crossing_count+getattr(route,'simulated_crossing_count',0)>0
                         or any('footbridge' in m.instruction.lower() or 'underpass' in m.instruction.lower() for m in route.maneuvers))
                row['crossing_traversed']=crossed
            if case.get('facility_expected_id') and case['facility_expected_id'] not in route.demo_facility_ids:
                raise ValueError('Route did not traverse the specified navigation facility')
            row.update(success=True,distance_meters=round(route.distance_meters,2),
                       mapped_crossings=route.mapped_crossing_count,simulated_crossings=getattr(route,'simulated_crossing_count',0),
                       facility_ids=route.demo_facility_ids,geometry=route.geometry.coordinates,
                       maneuvers=[m.model_dump(mode='json') for m in route.maneuvers])
        except (NavigationRejected,ValueError) as failure:
            row['reason']=getattr(failure,'message',str(failure))
        row['elapsed_ms']=round((time.perf_counter()-begin)*1000,2); results.append(row)
    groups=defaultdict(list)
    for row in results: groups[(row['area'],row['category'])].append(row)
    summary=[{'area':area,'category':category,'success':sum(r['success'] for r in rows),'total':len(rows),
              'rate':round(sum(r['success'] for r in rows)/len(rows),4),
              'crossing_traversals':sum(r.get('crossing_traversed',False) for r in rows),
              'median_ms':round(statistics.median(r['elapsed_ms'] for r in rows),2),'max_ms':max(r['elapsed_ms'] for r in rows)}
             for (area,category),rows in sorted(groups.items())]
    return {'seed':sample['seed'],'demo_overlay':demo,'eligibility':sample['eligibility'],'summary':summary,'cases':results}


def facility_samples(seed=20261021):
    from backend.navigation.areas import demo_area_dataset
    rng=random.Random(seed);cases=[]
    for area in service_areas().items:
        if not area.resident_demo_supported: continue
        facilities=demo_area_dataset(area.id).dataset['navigationFacilities']
        groups=defaultdict(list)
        for facility in facilities: groups[(facility['routingSource'],facility['kind'])].append(facility)
        for (source,kind),rows in sorted(groups.items()):
            for f in rng.sample(rows,min(30,len(rows))):
                a,b=f['geometry'][0],f['geometry'][-1]
                if rng.random()<.5: a,b=b,a
                cases.append({'id':f['id'],'facility_expected_id':f['id'],'area':area.id,
                              'category':f'{source}_{kind}','origin':a,'destination':b})
    return {'seed':seed,'eligibility':'Independent facility sample; all mapped facilities up to 30 per kind and 30 simulated facilities per kind, without reachability filtering. Exact facility ID must occur on the returned route.','cases':cases}


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--samples',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True); parser.add_argument('--demo',action='store_true')
    args=parser.parse_args()
    if args.samples.exists(): sample=json.loads(args.samples.read_text(encoding='utf-8'))
    else:
        sample=samples();args.samples.parent.mkdir(parents=True,exist_ok=True)
        args.samples.write_text(json.dumps(sample,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    result=evaluate(sample,demo=args.demo);args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['summary'],indent=2),flush=True)
