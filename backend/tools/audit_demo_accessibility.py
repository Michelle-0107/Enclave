"""Frozen app-level wheelchair audit; all 480 original cases remain in the denominator."""
from collections import defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import time
from backend.navigation.areas import find_area,demo_area_dataset,service_areas
from backend.navigation.demo_network import demo_walking_graph
from backend.navigation.demo_routes import calculate_demo_routes,DemoRouteRequest
from backend.navigation.provider import NavigationRejected

ROOT=Path(__file__).resolve().parents[1]
FROZEN={'walking-primary':'c741d589985b40954a484b03a69fedc291c71619eb68f2245942da016cb43ef8','walking-holdout':'df1e904cf559171f1e2c9837950314ff3e7f862238890e8b0af7f2d3222a2f2e'}
CATEGORIES=('cross_road','same_side','local_streets','long_distance')

def evaluate(sample,*,progress=False):
    rows=[]
    for i,case in enumerate(sample['cases']):
        area=find_area(case['area']);data=demo_area_dataset(area.id).dataset
        body=DemoRouteRequest(profile='wheelchair',origin=dict(zip(('longitude','latitude'),case['origin'])),destination=dict(zip(('longitude','latitude'),case['destination'])),start_candidates=[])
        row={**case,'success':False};begin=time.perf_counter()
        try:
            response=calculate_demo_routes(area.id,area.bbox,body,data,demo_walking_graph(area.id))
            option=response.options[0];route=option.route
            if route is None:raise NavigationRejected(422,option.unavailable_reason or 'No step-free route')
            if response.adjusted_start or response.start_adjustment_meters or response.selected_origin!=body.origin:raise ValueError('Audit endpoints were silently adjusted')
            if route.route_mode!='accessible' or route.accessibility_status!='synthetic_network' or route.field_verified:raise ValueError('Invalid accessibility provenance')
            if route.unmarked_crossing_count:raise ValueError('Step-free route traversed an unmarked road crossing')
            if abs(sum(m.distance_meters for m in route.maneuvers)-route.distance_meters)>.001:raise ValueError('Route distance does not match its maneuvers')
            row.update(success=True,distance_meters=route.distance_meters,duration_seconds=route.duration_seconds,geometry=route.geometry.coordinates,
                facility_ids=route.demo_facility_ids,maneuvers=[m.model_dump(mode='json') for m in route.maneuvers],warnings=route.warnings,
                origin_snap_meters=route.origin_snap_distance_meters,destination_snap_meters=route.destination_snap_distance_meters)
        except (NavigationRejected,ValueError) as error:row['reason']=getattr(error,'message',str(error))
        row['elapsed_ms']=round((time.perf_counter()-begin)*1000,2);rows.append(row)
        if progress and (i+1)%30==0:print(case['area'],case['category'],i+1,flush=True)
    groups=defaultdict(list)
    for row in rows:groups[row['area'],row['category']].append(row)
    summary=[dict(area=area,category=category,success=sum(r['success'] for r in cases),total=len(cases),rate=sum(r['success'] for r in cases)/len(cases)) for (area,category),cases in sorted(groups.items())]
    return dict(seed=sample['seed'],summary=summary,cases=rows)

def acceptance(reports):
    expected={(batch,area.id,category) for batch in FROZEN for area in service_areas().items if area.resident_demo_supported for category in CATEGORIES}
    actual={(batch,row['area'],row['category']) for batch,result in reports.items() for row in result['summary']}
    groups=[r for result in reports.values() for r in result['summary']]
    total=sum(r['total'] for r in groups);success=sum(r['success'] for r in groups)
    coverage=actual==expected and len(groups)==len(expected) and all(r['total']==30 for r in groups) and total==480
    passed=coverage and success*100>=total*80 and all(r['success']*100>=r['total']*80 for r in groups)
    return dict(passed=passed,overall_success=success,overall_total=total,overall_rate=success/total if total else 0,all_groups_at_least_80=coverage and all(r['success']*100>=r['total']*80 for r in groups),threshold=.8)

def main():
    output=ROOT/'docs/api/demo-step-free-audit';output.mkdir(exist_ok=True)
    reports={}
    for name,digest in FROZEN.items():
        raw=(ROOT/f'tests/fixtures/demo-routing/{name}-samples.json').read_bytes()
        if hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest()!=digest:raise ValueError('Frozen audit samples changed')
        result=evaluate(json.loads(raw),progress=True);result['sample_sha256']=digest
        result['algorithm_sha256']=hashlib.sha256(b''.join((ROOT/p).read_bytes().replace(b'\r\n',b'\n') for p in ('navigation/roadside.py','navigation/demo_accessibility.py','navigation/demo_routes.py'))).hexdigest()
        reports[name]=result
        (output/f'{name}.json.gz').write_bytes(gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
        print(name,json.dumps(result['summary']),flush=True)
    gate=acceptance(reports)
    (output/'summary.json').write_text(json.dumps(dict(acceptance=gate,audits={name:{k:v for k,v in r.items() if k!='cases'} for name,r in reports.items()}),indent=2)+'\n',encoding='utf-8')
    print(json.dumps(gate),flush=True)
    if not gate['passed']:raise SystemExit('80% step-free acceptance NOT PASSED; retained all failures')

if __name__=='__main__':main()
