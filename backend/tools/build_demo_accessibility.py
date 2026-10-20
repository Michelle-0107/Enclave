"""Build hypothetical accessibility facilities uniformly from existing roads, never audit endpoints."""
import json
from pathlib import Path
from collections import Counter
from backend.navigation.areas import service_areas,demo_area_dataset
from backend.navigation.demo_network import demo_walking_graph
from backend.navigation.roadside import walking_graph
from backend.navigation.road_cache import write_graph
from backend.navigation.demo_accessibility import generate_accessibility,VERSION,accessible_graph

def main():
    root=Path(__file__).resolve().parents[2]
    for area in service_areas().items:
        if not area.resident_demo_supported:continue
        dataset=demo_area_dataset(area.id).dataset.copy();graph=demo_walking_graph(area.id)
        source=root/'backend/data/demo_areas'/f'{area.id}.osm'
        write_graph(source.with_name(f'{area.id}-routing.json.gz'),walking_graph(area.id),source)
        facilities=generate_accessibility(area.id,graph,dataset)
        dataset['demoAccessibility']={'version':VERSION,'areaId':area.id,'source':'simulation','fieldVerified':False,
          'outdoorApproachMeters':20,'buildingApproach':'simulated_registered_entrances',
          'assumptions':'Hypothetical paved step-free roadside approaches within 20m where the existing access policy permits them; no other building, wall or water traversal. Each eligible building receives a nearest outdoor entrance ramp within 20m; indoor travel to it is hypothetically step-free, without surveyed indoor directions. Crossings have dropped kerbs; hypothetical bridges have lifts. Stairs remain excluded.',
          'placement':'All existing geographic crossing segments upgraded with hypothetical accessible access; shortest-first <=20m ramp connectors only between otherwise separate recorded-road components. No benchmark samples/results read.'}
        dataset['accessibilityFacilities']=facilities
        accessible_graph(graph,facilities,dataset)
        encoded=json.dumps(dataset,ensure_ascii=False,separators=(',',':'))+'\n'
        if len(encoded.encode())>4*1024*1024:raise ValueError('Demo dataset exceeds API size cap')
        (root/'backend/data/demo_areas'/f'{area.id}.json').write_text(encoded,encoding='utf-8',newline='\n')
        if area.id==service_areas().default_area_id:
            (root/'frontend/enclave-mobile/src/demo/kl-east-demo.json').write_text(encoded,encoding='utf-8',newline='\n')
        print(area.id,len(facilities),dict(Counter(f['kind'] for f in facilities)),len(encoded.encode()),'bytes',flush=True)

if __name__=='__main__':main()
