"""Checksummed JSON topology cache: fast startup, no executable pickle data."""
from collections import defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from .land_access import LandAccess
from .zones import BoundsIndex


def signature():
    folder=Path(__file__).parent
    return hashlib.sha256(b''.join((folder/name).read_bytes().replace(b'\r\n',b'\n')
                                  for name in ('roadside.py','land_access.py','zones.py','road_cache.py'))).hexdigest()


def write_graph(path,graph,source):
    payload={'version':1,'algorithm':signature(),'source':hashlib.sha256(source.read_bytes()).hexdigest(),
             'bounds':graph.bounds,'nodes':graph.nodes,'private_way_ids':sorted(graph.private_way_ids),
             'routing_bounds':graph.routing_bounds,
             'explicit_trunk_way_ids':sorted(graph.explicit_trunk_way_ids),
             'carriageways':graph.carriageways,
             'edges':[[e.a,e.b,e.points,e.name,e.kind,e.way_id,e.direction,e.grade] for e in graph.edges]}
    # Deterministic compression makes rebuilds reviewable and reproducible.
    path.write_bytes(gzip.compress(json.dumps(payload,separators=(',',':')).encode(),mtime=0))


def read_graph(path,source,bounds):
    from .roadside import RoadsideGraph,Edge,coverage_bounds
    try:
        if not path.is_file(): return None
        with gzip.open(path,'rb') as file:
            raw=file.read(64*1024*1024+1)
        if len(raw)>64*1024*1024: return None
        data=json.loads(raw)
        if (data['version']!=1 or data['algorithm']!=signature()
                or data['source']!=hashlib.sha256(source.read_bytes()).hexdigest()
                or data['bounds']!=list(bounds)): return None
        graph=RoadsideGraph.__new__(RoadsideGraph)
        graph.bounds=tuple(bounds);graph.nodes={n:tuple(p) for n,p in data['nodes'].items()}
        graph.routing_bounds=tuple(data['routing_bounds'])
        graph.private_way_ids=set(data['private_way_ids'])
        graph.explicit_trunk_way_ids=set(data['explicit_trunk_way_ids'])
        graph.edges=[Edge(a,b,tuple(map(tuple,points)),name,kind,way,direction,tuple(grade))
                     for a,b,points,name,kind,way,direction,grade in data['edges']]
        graph.carriageways=[(tuple(a),tuple(b),tuple(grade)) for a,b,grade in data['carriageways']]
        graph.barrier_index=defaultdict(set)
        for i,(a,b,_) in enumerate(graph.carriageways):
            for cell in graph.cells(a,b): graph.barrier_index[cell].add(i)
        root=ET.parse(source).getroot()
        if graph.routing_bounds != coverage_bounds(root,bounds): return None
        tags=lambda e:{t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
        points={n.attrib['id']:(float(n.attrib['lon']),float(n.attrib['lat'])) for n in root.findall('node')}
        node_tags={n.attrib['id']:tags(n) for n in root.findall('node')}
        ways=[(w.attrib['id'],[n.attrib['ref'] for n in w.findall('nd')],tags(w)) for w in root.findall('way')]
        graph.land_access=LandAccess(root,points,node_tags,ways,resident_access=True)
        graph.components=graph.connected_components()
        graph.edge_index=BoundsIndex([(min(e.points[0][0],e.points[1][0]),min(e.points[0][1],e.points[1][1]),
                                      max(e.points[0][0],e.points[1][0]),max(e.points[0][1],e.points[1][1])) for e in graph.edges])
        return graph
    except (OSError,ValueError,KeyError,TypeError,EOFError):
        return None
