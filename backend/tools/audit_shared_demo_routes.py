"""App-level regression audit on the original frozen walking-eligible samples."""
from collections import defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import time
from backend.navigation.areas import find_area,demo_area_dataset,service_areas
from backend.navigation.demo_network import demo_walking_graph
from backend.navigation.demo_routes import DemoRouteRequest,calculate_demo_routes
from backend.navigation.roadside import distance
from backend.tools.audit_demo_accessibility import FROZEN,CATEGORIES

ROOT=Path(__file__).resolve().parents[1]

def evaluate(sample,*,progress=False):
    rows=[]
    for i,case in enumerate(sample['cases']):
        area=find_area(case['area']);data=demo_area_dataset(area.id).dataset
        body=DemoRouteRequest(profile='walking',origin=dict(zip(('longitude','latitude'),case['origin'])),
            destination=dict(zip(('longitude','latitude'),case['destination'])),start_candidates=[])
        begin=time.perf_counter()
        response=calculate_demo_routes(area.id,area.bbox,body,data,demo_walking_graph(area.id))
        if response.adjusted_start or response.selected_origin!=body.origin:
            raise ValueError('Audit endpoints changed')
        options={item.mode:item.route for item in response.options}
        row={**case,'shortest':options.get('shortest') is not None,'avoid_damage':options.get('avoid_damage') is not None,'accessible':options.get('accessible') is not None,
             'ordered':True,'options':[item.model_dump(mode='json') for item in response.options]}
        accessible=options.get('accessible')
        if accessible:
            row['ordered']=all(options.get(mode) is not None and options[mode].distance_meters<=accessible.distance_meters+1e-6
                for mode in ('shortest','avoid_damage'))
        for mode,route in options.items():
            if route is None:continue
            if abs(sum(m.distance_meters for m in route.maneuvers)-route.distance_meters)>.001:
                raise ValueError('Distance does not match maneuvers')
            coordinates=route.geometry.coordinates
            # Roadside routing omits degenerate edges shorter than 1 cm from
            # maneuvers; allow 10 cm aggregate geometry precision, never metres.
            if abs(sum(distance(a,b) for a,b in zip(coordinates,coordinates[1:]))-route.distance_meters)>.1:
                raise ValueError('Distance does not match actual geometry')
            expected='synthetic_network' if mode=='accessible' else 'not_requested'
            if route.route_mode!=mode or route.accessibility_status!=expected or route.field_verified:
                raise ValueError('Invalid route mode or provenance')
        row['elapsed_ms']=round((time.perf_counter()-begin)*1000,2);rows.append(row)
        if progress and (i+1)%30==0:print(case['area'],case['category'],i+1,flush=True)
    groups=defaultdict(list)
    for row in rows:groups[row['area'],row['category']].append(row)
    return {'seed':sample['seed'],'cases':rows,'summary':[
        dict(area=area,category=category,total=len(cases),shortest=sum(r['shortest'] for r in cases),
             avoid_damage=sum(r['avoid_damage'] for r in cases),
             accessible=sum(r['accessible'] for r in cases),ordering_failures=sum(not r['ordered'] for r in cases))
        for (area,category),cases in sorted(groups.items())]}

def acceptance(reports):
    groups=[r for report in reports.values() for r in report['summary']]
    expected={(batch,area.id,category) for batch in FROZEN for area in service_areas().items if area.resident_demo_supported for category in CATEGORIES}
    actual={(batch,row['area'],row['category']) for batch,report in reports.items() for row in report['summary']}
    valid=set(reports)==set(FROZEN) and actual==expected and len(groups)==len(expected) and all(r['total']==30 for r in groups)
    return dict(passed=valid and all(r['shortest']>=29 and r.get('avoid_damage',0)>=29 and r['accessible']>=24 and not r['ordering_failures'] for r in groups),
        shortest=sum(r['shortest'] for r in groups),avoid_damage=sum(r.get('avoid_damage',0) for r in groups),accessible=sum(r['accessible'] for r in groups),total=sum(r['total'] for r in groups),
        ordering_failures=sum(r['ordering_failures'] for r in groups),walking_threshold=.95,step_free_threshold=.8)

def main():
    output=ROOT/'docs/api/shared-demo-route-audit';output.mkdir(exist_ok=True)
    reports={}
    for name,digest in FROZEN.items():
        raw=(ROOT/f'tests/fixtures/demo-routing/{name}-samples.json').read_bytes()
        if hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest()!=digest:raise ValueError('Frozen samples changed')
        result=evaluate(json.loads(raw),progress=True);result['sample_sha256']=digest
        result['algorithm_sha256']=hashlib.sha256(b''.join((ROOT/p).read_bytes().replace(b'\r\n',b'\n')
            for p in ('navigation/roadside.py','navigation/demo_network.py','navigation/demo_accessibility.py','navigation/demo_routes.py'))).hexdigest()
        result['dataset_sha256']={area.id:hashlib.sha256((ROOT/'data/demo_areas'/f'{area.id}.json').read_bytes().replace(b'\r\n',b'\n')).hexdigest()
                                  for area in service_areas().items if area.resident_demo_supported}
        reports[name]=result
        (output/f'{name}.json.gz').write_bytes(gzip.compress(json.dumps(result,separators=(',',':')).encode(),mtime=0))
        print(name,json.dumps(result['summary']),flush=True)
    gate=acceptance(reports)
    (output/'summary.json').write_text(json.dumps(dict(acceptance=gate,audits={name:{k:v for k,v in report.items() if k!='cases'}
        for name,report in reports.items()}),indent=2)+'\n',encoding='utf-8')
    print(json.dumps(gate),flush=True)
    if not gate['passed']:raise SystemExit('Shared routing audit failed; all failures retained')

if __name__=='__main__':main()
