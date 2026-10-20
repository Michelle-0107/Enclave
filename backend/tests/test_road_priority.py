"""Recorded-road preference and extract-buffer detours without changing endpoints."""
from pathlib import Path
import tempfile
import unittest

from backend.navigation.roadside import Edge, RoadsideGraph, distance
from backend.navigation.provider import NavigationRejected
from backend.navigation.road_cache import write_graph, read_graph
from backend.tests.test_roadside import osm_graph, p, body


class RoadPriorityTests(unittest.TestCase):
    def test_only_explicitly_permitted_trunk_roads_gain_same_side_fallback(self):
        for extras,allowed in (({},False),({'access':'yes'},True),({'access':'private'},False),
                               ({'access':'yes','foot':'no'},False),({'access':'yes','motorroad':'yes'},False),
                               ({'access':'yes','foot':'use_sidepath'},False)):
            with self.subTest(tags=extras):
                graph=osm_graph({'a':(-100,0),'b':(100,0)},[(['a','b'],{'highway':'trunk',**extras})])
                if not allowed:
                    with self.assertRaises(NavigationRejected):graph.route(body(p(-80,3),p(80,3)))
                    continue
                route=graph.route(body(p(-80,3),p(80,3)))
                self.assertAlmostEqual(route.distance_meters,160,places=2)
                self.assertTrue(route.road_fallback_used)
                self.assertTrue(any('trunk roads explicitly tagged access=yes' in w for w in route.warnings))
                with self.assertRaises(NavigationRejected):graph.route(body(p(-80,3),p(80,-3)))
        for highway in ('motorway','motorway_link','trunk_link'):
            graph=osm_graph({'a':(-100,0),'b':(100,0)},[(['a','b'],{'highway':highway,'access':'yes'})])
            with self.assertRaises(NavigationRejected):graph.route(body(p(-80,3),p(80,3)))

    def test_recorded_road_bridge_preserves_same_side_ground_approaches(self):
        graph=osm_graph({'a':(-100,0),'b':(-20,0),'c':(20,0),'d':(100,0)},
                        [(['a','b'],{'highway':'service'}),
                         (['b','c'],{'highway':'service','bridge':'yes','layer':'1'}),
                         (['c','d'],{'highway':'service'})])
        route=graph.route(body(p(-80,3),p(80,3)))
        self.assertAlmostEqual(route.distance_meters,160,places=2)
        self.assertFalse(any('open area' in m.instruction for m in route.maneuvers))
        with self.assertRaises(NavigationRejected):graph.route(body(p(-80,3),p(80,-3)))

    def detour(self):
        graph=osm_graph({'a':(0,0),'b':(100,0),'c':(100,15),'d':(0,15)},
                        [(['a','b','c','d'],{'highway':'footway'})])
        a=min(graph.nodes,key=lambda n:distance(graph.nodes[n],p(0,0)))
        b=min(graph.nodes,key=lambda n:distance(graph.nodes[n],p(0,15)))
        # An inferred shortcut can coexist with a mapped detour once other
        # mapped facilities have joined previously disconnected components.
        graph.edges.append(Edge(a,b,(graph.nodes[a],graph.nodes[b]),'short gap','open_access',''))
        return graph

    def test_recorded_detour_wins_over_a_short_inferred_shortcut(self):
        graph=self.detour()
        for a,b in ((p(0,0),p(0,15)),(p(0,15),p(0,0))):
            route=graph.route(body(a,b))
            self.assertAlmostEqual(route.distance_meters,215,places=2)
            self.assertFalse(any('open area' in m.instruction for m in route.maneuvers))

    def test_blocked_recorded_detour_falls_back_to_an_unblocked_short_gap(self):
        graph=self.detour();west,south=p(40,-2);east,north=p(60,2)
        route=graph.route(body(p(0,0),p(0,15),'avoid_damage'),boxes=[(west,south,east,north)])
        self.assertAlmostEqual(route.distance_meters,15,places=2)
        self.assertTrue(any('open area' in m.instruction for m in route.maneuvers))
        self.assertLessEqual(max(m.distance_meters for m in route.maneuvers if 'open area' in m.instruction),20)
        repaired=graph.route(body(p(0,0),p(0,15),'avoid_damage'))
        self.assertAlmostEqual(repaired.distance_meters,215,places=2)
        self.assertEqual(route.geometry.coordinates[0],repaired.geometry.coordinates[0])
        self.assertEqual(route.geometry.coordinates[-1],repaired.geometry.coordinates[-1])
        with self.assertRaises(NavigationRejected):
            graph.route(body(p(0,0),p(0,15),'accessible'),boxes=[(west,south,east,north)],demo_mode=True)

    def test_buffer_preserves_a_recorded_detour_but_never_accepts_outside_endpoints(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'roads.osm';cache=Path(folder)/'roads.json.gz'
            lo,hi=p(-200,-200),p(200,200);a,b=p(-100,-100),p(100,100)
            nodes={n:p(*q) for n,q in {'a':(-50,0),'b':(-50,150),'c':(50,150),'d':(50,0)}.items()}
            source.write_text(f'<osm><bounds minlon="{lo[0]}" minlat="{lo[1]}" maxlon="{hi[0]}" maxlat="{hi[1]}"/>'+
                              ''.join(f'<node id="{n}" lon="{q[0]}" lat="{q[1]}"/>' for n,q in nodes.items())+
                              '<way id="1"><nd ref="a"/><nd ref="b"/><nd ref="c"/><nd ref="d"/><tag k="highway" v="footway"/></way></osm>')
            bounds=(a[0],a[1],b[0],b[1]);graph=RoadsideGraph(source,bounds)
            write_graph(cache,graph,source);loaded=read_graph(cache,source,bounds)
            self.assertIsNotNone(loaded)
            for graph in (graph,loaded):
                route=graph.route(body(nodes['a'],nodes['d']))
                self.assertAlmostEqual(route.distance_meters,400,places=2)
                self.assertTrue(any('extract buffer' in w for w in route.warnings))
                self.assertFalse(any(e.kind=='open_access' for e in graph.edges))
                with self.assertRaises(NavigationRejected):graph.route(body(nodes['b'],nodes['d']))
