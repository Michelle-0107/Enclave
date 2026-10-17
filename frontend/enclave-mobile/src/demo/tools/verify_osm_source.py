"""Independently verify all bundled geometry/landmarks against the original OSM XML."""
import argparse,hashlib,json
from pathlib import Path
import xml.etree.ElementTree as ET
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('dataset',type=Path);args=parser.parse_args()
data=json.loads(args.dataset.read_text(encoding='utf-8'))
assert hashlib.sha256(args.source.read_bytes()).hexdigest()==data['provenance']['sourceXmlSha256']
root=ET.parse(args.source).getroot();tags=lambda e:{t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
nodes={e.attrib['id']:e for e in root.findall('node')};points={n:[float(e.attrib['lon']),float(e.attrib['lat'])] for n,e in nodes.items()}
ways={e.attrib['id']:e for e in root.findall('way')};covered=set()
for e in data['edges']:
    w=ways[e['osmWayId']];refs=[n.attrib['ref'] for n in w.findall('nd')];seq=e['osmNodeIds']
    forward=any(refs[i:i+len(seq)]==seq for i in range(len(refs)-len(seq)+1))
    backward=any(refs[i:i+len(seq)]==seq[::-1] for i in range(len(refs)-len(seq)+1))
    assert forward or backward,e['id']
    assert e['geometry']==[points[n] for n in seq],e['id']
    t=tags(w);assert e['highway']==t['highway'];assert e['mappedHasSteps']==(t['highway']=='steps')
    walking=t.get('oneway:foot','no')
    if t.get('foot:backward')=='no':walking='yes'
    if t.get('foot:forward')=='no':walking='-1'
    expected='both' if walking not in ('yes','1','true','-1') else ('forward' if (walking!='-1')==forward else 'backward')
    assert e['direction']==expected,e['id']
    assert not t.get('name') or e['roadName']==t['name']
    for a,b in zip(seq,seq[1:]):covered.add((e['osmWayId'],*sorted((a,b))))
for n in data['nodes']:assert n['coordinate']==points[n['id']]
for p in data['landmarks']:
    if p['osmType']=='node':element=nodes[p['osmId']];assert p['coordinate']==points[p['osmId']]
    else:
        element=ways[p['osmId']];refs=[n.attrib['ref'] for n in element.findall('nd')]
        if refs[0]==refs[-1]:refs=refs[:-1]
        assert p['coordinate']==[round(sum(points[n][i] for n in refs)/len(refs),7) for i in (0,1)]
    assert p['name']==tags(element)['name']
west,south,east,north=data['bbox']
def inside(n):p=points[n];return west<=p[0]<=east and south<=p[1]<=north
def forbidden(t):return t.get('foot') in ('no','private') or (t.get('access') in ('no','private','customers','destination') and t.get('foot') not in ('yes','designated','permissive'))
eligible=set()
for wid,w in ways.items():
    t=tags(w)
    if t.get('highway') not in ('footway','path','steps','pedestrian','living_street','service','residential','unclassified','tertiary','cycleway','track') or forbidden(t) or t.get('area')=='yes' or t.get('indoor')=='yes':continue
    refs=[n.attrib['ref'] for n in w.findall('nd')]
    for a,b in zip(refs,refs[1:]):
        if a not in points or b not in points or a==b or not inside(a) or not inside(b) or points[a]==points[b]:continue
        if forbidden(tags(nodes[a])) or forbidden(tags(nodes[b])) or tags(nodes[a]).get('locked')=='yes' or tags(nodes[b]).get('locked')=='yes':continue
        eligible.add((wid,*sorted((a,b))))
assert eligible==covered,{'missing':list(eligible-covered)[:5],'invented':list(covered-eligible)[:5]}
assert 'originId' not in data and 'destinationId' not in data
print(f"Verified all {len(covered)} eligible source segments in the whole bbox, {len(data['edges'])} compressed polylines, {len(data['nodes'])} junctions and {len(data['landmarks'])} real places. No invented road links or preset journey.")
