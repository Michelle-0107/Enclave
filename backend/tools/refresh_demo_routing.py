"""Refresh checksummed graphs and stable Demo approaches after topology changes."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from backend.navigation.areas import service_areas
from backend.navigation.demo_network import generate_facilities,generate_junction_facilities,overlay_graph
from backend.navigation.road_cache import write_graph
from backend.navigation.roadside import walking_graph,distance


def refresh_facilities(graph,facilities):
    result=deepcopy(facilities);changed=0;maximum=0
    by_way={}
    for edge in graph.edges:by_way.setdefault((edge.way_id,edge.kind,edge.grade),[]).append(edge)
    for facility in result:
        if facility['routingSource']!='simulation':continue
        for anchor in facility['anchors']:
            p=anchor['coordinate'];matches=[]
            for edge in by_way.get((anchor['wayId'],anchor['kind'],tuple(anchor['grade'])),[]):
                gap,f,q=graph.project(p,edge)
                if gap<=20+1e-6 and (gap<.05 or graph.access_clear(p,q,allow_road_endpoint=True)):
                    matches.append((gap,q))
            if not matches:raise ValueError(f'No valid same-way approach for {facility["id"]}; do not silently move it to another road')
            gap,q=min(matches);anchor['coordinate']=list(p if gap<.05 else q)
            changed+=gap>=.05;maximum=max(maximum,gap)
        facility['geometry']=[a['coordinate'] for a in facility['anchors']]
        if not graph.land_access.clear(*facility['geometry']):raise ValueError('Refreshed Demo facility intersects a mapped physical obstacle')
        facility['coordinate']=[sum(p[i] for p in facility['geometry'])/2 for i in (0,1)]
    return result,changed,maximum


def main():
    root=Path(__file__).resolve().parents[2];folder=root/'backend/data/demo_areas'
    prepared=[]
    for area in service_areas().items:
        if not area.resident_demo_supported:continue
        source=folder/f'{area.id}.osm';graph=walking_graph(area.id)
        path=folder/f'{area.id}.json';dataset=json.loads(path.read_text(encoding='utf-8'))
        facilities,changed,maximum=refresh_facilities(graph,dataset['navigationFacilities'])
        existing={f['id'] for f in facilities}
        # Uniform placement on recorded road segments in the extract buffer.
        # Existing in-window facility IDs stay stable; no benchmark input read.
        extra=[f for f in generate_facilities(area.id,include_buffer=True)
               if f['routingSource']=='simulation' and f['id'] not in existing
               and not graph.endpoint_inside(f['coordinate'])]
        facilities.extend(extra)
        junctions=generate_junction_facilities(graph,facilities,source)
        facilities.extend(junctions);overlay_graph(graph,facilities)
        dataset['navigationFacilities']=facilities
        manifest={'version':1,'area_id':area.id,'sourceXmlSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                  'placement':'Stable existing facility IDs; same-way approach refresh <=20 m; uniform 75 m spacing per OSM way in extract buffer; explicit hypothetical crossings at clear short public side-street junctions omitted by 20 m segment sampling. No benchmark endpoints/results used.','facilities':facilities}
        prepared.append((area,source,graph,dataset,manifest))
        print(area.id,'reanchored',changed,'max_anchor_shift_m',round(maximum,3),'new_buffer_demo_facilities',len(extra),'new_junction_crossings',len(junctions),flush=True)
    for area,source,graph,dataset,manifest in prepared:
        write_graph(folder/f'{area.id}-routing.json.gz',graph,source)
        (folder/f'{area.id}-crossings.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        encoded=json.dumps(dataset,ensure_ascii=False,separators=(',',':'))+'\n'
        (folder/f'{area.id}.json').write_text(encoded,encoding='utf-8')
        if area.id==service_areas().default_area_id:
            (root/'frontend/enclave-mobile/src/demo/kl-east-demo.json').write_text(encoded,encoding='utf-8')


if __name__=='__main__':main()
