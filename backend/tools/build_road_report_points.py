"""Build immutable ~100m road reporting sections from existing local OSM sources.

No network, reports, users or database changes. Re-run explicitly after reviewing
an OSM source update; existing linked facility rows are never silently relocated.
"""
import hashlib,json
from pathlib import Path
from backend.navigation.areas import service_areas
from backend.reports.road_sections import generate

def main():
    root=Path(__file__).resolve().parents[1];points=[];sources={}
    for area in service_areas().items:
        if not area.enabled or not area.community_issues_supported:continue
        source=root/'data/demo_areas'/f'{area.id}.osm'
        metadata=json.loads((source.parent/f'{area.id}-source.json').read_text())
        digest=hashlib.sha256(source.read_bytes()).hexdigest()
        if digest!=metadata['source_xml_sha256']:raise ValueError('Source checksum mismatch')
        created_at=json.loads((source.parent/f'{area.id}.json').read_text())['provenance']['downloadedAt']
        generated=generate(area,source,created_at);points.extend(point.model_dump(mode='json') for point in generated)
        sources[area.id]=digest;print(area.id,len(generated),'road report sections',flush=True)
    path=root/'data/reporting/road_sections.json';path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps({'version':1,'section_length_meters':100,'license':'ODbL-1.0','attribution':'OpenStreetMap contributors','source_sha256':sources,'points':points},
        ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')

if __name__=='__main__':main()
