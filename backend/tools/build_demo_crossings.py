"""Rebuild explicit demo navigation facilities; never writes live OSM roads."""
from collections import Counter
import hashlib
import json
from pathlib import Path

from backend.navigation.areas import service_areas
from backend.navigation.demo_network import generate_facilities
from backend.navigation.roadside import RoadsideGraph
from backend.navigation.road_cache import write_graph,read_graph


def main():
    root=Path(__file__).resolve().parents[2];folder=root/'backend/data/demo_areas'
    datasets=[folder/f'{area.id}.json' for area in service_areas().items if area.resident_demo_supported]
    if all(path.exists() and json.loads(path.read_text(encoding='utf-8')).get('navigationFacilities') for path in datasets):
        # Rebuilding must retain published facility IDs and buffer crossings.
        from backend.tools.refresh_demo_routing import main as refresh
        return refresh()
    for area in service_areas().items:
        if not area.resident_demo_supported: continue
        source=folder/f'{area.id}.osm';cache=folder/f'{area.id}-routing.json.gz'
        if read_graph(cache,source,area.bbox) is None:
            write_graph(cache,RoadsideGraph(source,area.bbox,resident_access=True),source)
        facilities=generate_facilities(area.id)
        manifest={'version':1,'area_id':area.id,
                  'sourceXmlSha256':hashlib.sha256((folder/f'{area.id}.osm').read_bytes()).hexdigest(),
                  'placement':'Geographic road-segment sampling, 75 m spacing on each OSM way; parallel streets have independent crossings. No route-test endpoints or results used.',
                  'facilities':facilities}
        (folder/f'{area.id}-crossings.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        path=folder/f'{area.id}.json';dataset=json.loads(path.read_text(encoding='utf-8'))
        dataset['navigationFacilities']=facilities
        encoded=json.dumps(dataset,ensure_ascii=False,separators=(',',':'))+'\n'
        path.write_text(encoded,encoding='utf-8')
        if area.id==service_areas().default_area_id:
            (root/'frontend/enclave-mobile/src/demo/kl-east-demo.json').write_text(encoded,encoding='utf-8')
        print(area.id,dict(Counter((f['routingSource'],f['kind']) for f in facilities)),flush=True)


if __name__=='__main__': main()
