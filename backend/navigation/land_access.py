"""Visibility for inferred outdoor access, using mapped physical obstacles.

Missing paths may be inferred across open land. They are never evidence of a
surveyed path or wheelchair access. An endpoint may leave its own building;
other buildings, fences and water remain obstacles.
"""
import math

from .zones import BoundsIndex


def bounds(points):
    return (min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points))


def intersection(a, b, c, d):
    """Parameters on two closed segments, including endpoint contact."""
    v, w = (b[0]-a[0], b[1]-a[1]), (d[0]-c[0], d[1]-c[1])
    det = v[0]*w[1]-v[1]*w[0]
    delta = (c[0]-a[0], c[1]-a[1])
    if abs(det) < 1e-18:
        length2 = v[0]*v[0]+v[1]*v[1]
        if length2 < 1e-24:
            return None
        if abs(delta[0]*v[1]-delta[1]*v[0]) > 1e-14:
            return None
        fractions = [((p[0]-a[0])*v[0]+(p[1]-a[1])*v[1])/length2 for p in (c,d)]
        lo, hi = max(0,min(fractions)), min(1,max(fractions))
        return (lo, 0.0) if lo <= hi+1e-9 else None
    t = (delta[0]*w[1]-delta[1]*w[0])/det
    u = (delta[0]*v[1]-delta[1]*v[0])/det
    return (max(0,min(1,t)), max(0,min(1,u))) if -1e-9 <= t <= 1+1e-9 and -1e-9 <= u <= 1+1e-9 else None


def in_ring(point, ring):
    x,y = point
    inside = False
    for a,b in zip(ring,ring[1:]):
        if (a[1]>y) != (b[1]>y) and x < a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]):
            inside = not inside
    return inside


def in_polygon(point, rings):
    return in_ring(point,rings[0]) and not any(in_ring(point,hole) for hole in rings[1:])


def through_polygon(a,b,rings):
    # Split at every boundary intersection, then inspect open intervals. This
    # handles concave footprints, holes, vertex crossings and boundary tangency.
    cuts = [0.0,1.0]
    for ring in rings:
        for c,d in zip(ring,ring[1:]):
            hit = intersection(a,b,c,d)
            if hit is not None: cuts.append(hit[0])
    cuts = sorted(set(cuts))
    return any(in_polygon((a[0]+(b[0]-a[0])*(lo+hi)/2,
                           a[1]+(b[1]-a[1])*(lo+hi)/2),rings)
               for lo,hi in zip(cuts,cuts[1:]) if hi-lo > 1e-8)


def stitch(parts):
    """Join OSM multipolygon members in either direction; omit incomplete rings."""
    pending = [list(part) for part in parts if len(part)>1]
    rings = []
    while pending:
        chain = pending.pop()
        while chain[0] != chain[-1]:
            for i,other in enumerate(pending):
                if chain[-1] == other[0]: chain.extend(other[1:])
                elif chain[-1] == other[-1]: chain.extend(reversed(other[:-1]))
                elif chain[0] == other[-1]: chain = other[:-1]+chain
                elif chain[0] == other[0]: chain = list(reversed(other[1:]))+chain
                else: continue
                pending.pop(i)
                break
            else: break
        if chain[0] == chain[-1] and len(chain)>=4: rings.append(chain)
    return rings


class LandAccess:
    def __init__(self, root, points, node_tags, ways, *, resident_access=False):
        from .roadside import forbidden, distance, xy
        self.distance, self.xy = distance, xy
        self.polygons = []
        self.walls = []
        self.water_lines = []
        self.blocked_nodes = []
        self.gates = []
        tags = lambda e: {t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
        by_id = {wid:(refs,t) for wid,refs,t in ways}

        def category(t):
            if t.get('building') not in {None,'no','roof'}: return 'building'
            if t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') == 'reservoir': return 'water'
            if t.get('access')=='no' or t.get('foot')=='no' or t.get('landuse')=='construction': return 'restricted'
            return None

        relation_members = set()
        for relation in root.findall('relation'):
            t = tags(relation); kind = category(t)
            if not kind or t.get('type') != 'multipolygon': continue
            members = [(m.attrib.get('role','outer') or 'outer',m.attrib['ref'])
                       for m in relation.findall('member') if m.attrib.get('type') == 'way' and m.attrib['ref'] in by_id]
            outer = stitch([by_id[ref][0] for role,ref in members if role=='outer'])
            inner = stitch([by_id[ref][0] for role,ref in members if role=='inner'])
            for ring in outer:
                if not all(n in points for n in ring): continue
                rings = [[points[n] for n in ring]]
                rings.extend([points[n] for n in hole] for hole in inner
                             if all(n in points for n in hole) and in_ring(points[hole[0]],rings[0]))
                self.polygons.append((kind,rings))
            if outer: relation_members.update(ref for _,ref in members)

        for wid,refs,t in ways:
            kind = category(t)
            if kind and wid not in relation_members and len(refs)>=4 and refs[0]==refs[-1] and all(n in points for n in refs):
                self.polygons.append((kind,[[points[n] for n in refs]]))
            if t.get('barrier') in {'wall','fence','retaining_wall','hedge','city_wall'}:
                self.walls.extend((points[a],points[b]) for a,b in zip(refs,refs[1:]) if a in points and b in points)
            if t.get('waterway') in {'river','stream','canal','drain','ditch'}:
                self.water_lines.extend((points[a],points[b]) for a,b in zip(refs,refs[1:]) if a in points and b in points)
        for nid,t in node_tags.items():
            if t.get('barrier') in {'gate','lift_gate','swing_gate','kissing_gate','entrance'}:
                if forbidden(t,resident_access=resident_access): self.blocked_nodes.append(points[nid])
                else: self.gates.append(points[nid])
            elif t.get('barrier') in {'wall','fence','retaining_wall','hedge'}:
                self.blocked_nodes.append(points[nid])
        self.polygon_index = BoundsIndex([bounds(rings[0]) for _,rings in self.polygons])
        self.wall_index = BoundsIndex([bounds(pair) for pair in self.walls])
        self.water_index = BoundsIndex([bounds(pair) for pair in self.water_lines])
        self.node_index = BoundsIndex([(p[0]-1e-5,p[1]-1e-5,p[0]+1e-5,p[1]+1e-5) for p in self.blocked_nodes])

    def buildings_at(self,point):
        return frozenset(i for i in self.polygon_index.candidates(point,point)
                         if self.polygons[i][0]=='building' and in_polygon(point,self.polygons[i][1]))

    def on_building_boundary(self,point,buildings):
        return any(self.segment_distance(point,a,b)<1 for i in buildings
                   for ring in self.polygons[i][1] for a,b in zip(ring,ring[1:]))

    def segment_distance(self,point,a,b):
        p,a,b = map(self.xy,(point,a,b)); dx,dy = b[0]-a[0],b[1]-a[1]
        length2 = dx*dx+dy*dy
        f = max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2)) if length2 else 0
        return math.hypot(p[0]-a[0]-f*dx,p[1]-a[1]-f*dy)

    def clear(self,a,b,*,own_buildings=frozenset()):
        for i in self.polygon_index.candidates(a,b):
            if i not in own_buildings and through_polygon(a,b,self.polygons[i][1]): return False
        for i in self.wall_index.candidates(a,b):
            c,d = self.walls[i]; hit = intersection(a,b,c,d)
            if hit is None: continue
            at = (a[0]+(b[0]-a[0])*hit[0],a[1]+(b[1]-a[1])*hit[0])
            transverse=abs((b[0]-a[0])*(d[1]-c[1])-(b[1]-a[1])*(d[0]-c[0]))>1e-18
            if not transverse or not any(self.distance(at,gate)<.5 for gate in self.gates): return False
        if any(intersection(a,b,*self.water_lines[i]) is not None for i in self.water_index.candidates(a,b)): return False
        if any(self.segment_distance(self.blocked_nodes[i],a,b)<.75 for i in self.node_index.candidates(a,b)): return False
        return True
