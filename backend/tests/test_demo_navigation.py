"""Demo facilities are navigable infrastructure, isolated from live routing."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.navigation.areas import demo_area_dataset, service_areas
from backend.navigation.demo_network import demo_walking_graph
from backend.navigation.provider import NavigationRejected
from backend.navigation.roadside import walking_graph, RoadsideGraph
from backend.navigation.road_cache import read_graph, write_graph
from backend.tests.test_roadside import body,p
from backend.tools.benchmark_demo_routes import evaluate

ROOT=Path(__file__).resolve().parents[1]


class DemoNavigationTests(unittest.TestCase):
    def test_frozen_walking_eligible_audits_pass_ninety_five_percent_in_every_group(self):
        import hashlib
        # Hash LF-normalized bytes so a Git checkout on Linux and Windows
        # verifies the same frozen sample content.
        expected={'walking-primary':('20261022','c741d589985b40954a484b03a69fedc291c71619eb68f2245942da016cb43ef8'),
                  'walking-holdout':('20261023','df1e904cf559171f1e2c9837950314ff3e7f862238890e8b0af7f2d3222a2f2e')}
        total=success=0
        for name,(seed,digest) in expected.items():
            raw=(ROOT/f'tests/fixtures/demo-routing/{name}-samples.json').read_bytes()
            self.assertEqual(hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest(),digest)
            sample=json.loads(raw);self.assertEqual(str(sample['seed']),seed)
            result=evaluate(sample,demo=True)
            self.assertEqual(len(result['summary']),8)
            for row in result['summary']:
                with self.subTest(batch=name,area=row['area'],category=row['category']):
                    self.assertEqual(row['total'],30)
                    self.assertGreaterEqual(row['success']*100,row['total']*95)
                    total+=row['total'];success+=row['success']
        self.assertEqual(total,480);self.assertGreater(success*100,total*95)

    def test_bundled_caches_match_the_current_algorithm_and_osm_files(self):
        for area in service_areas().items:
            root=ROOT/'data/demo_areas'
            self.assertIsNotNone(read_graph(root/f'{area.id}-routing.json.gz',root/f'{area.id}.osm',area.bbox))

    def test_both_areas_live_and_demo_graphs_have_no_inferred_links_over_twenty_metres(self):
        from backend.navigation.roadside import distance
        for area in service_areas().items:
            for factory in (walking_graph,demo_walking_graph):
                with self.subTest(area=area.id,graph=factory.__name__):
                    graph=factory(area.id)
                    self.assertTrue(any(edge.kind=='open_access' for edge in graph.edges))
                    self.assertTrue(all(distance(*edge.points)<=20+1e-6
                                        for edge in graph.edges if edge.kind=='open_access'))

    def test_cache_signature_survives_windows_to_linux_line_endings(self):
        from backend.navigation.road_cache import signature
        with patch('backend.navigation.road_cache.Path.read_bytes',return_value=b'code\nnext line\n'):
            linux=signature()
        with patch('backend.navigation.road_cache.Path.read_bytes',return_value=b'code\r\nnext line\r\n'):
            self.assertEqual(signature(),linux)

    def test_every_simulated_facility_has_a_real_graph_edge_and_mapped_approaches(self):
        for area in service_areas().items:
            graph=demo_walking_graph(area.id); live=walking_graph(area.id)
            facilities=demo_area_dataset(area.id).dataset['navigationFacilities']
            simulated=[f for f in facilities if f['routingSource']=='simulation']
            edges={e.way_id:e for e in graph.edges if e.kind.startswith('demo_')}
            self.assertGreater(len(simulated),30)
            self.assertEqual(set(edges),{f['id'] for f in simulated})
            self.assertFalse(any(e.kind.startswith('demo_') for e in live.edges))
            for f in simulated:
                edge=edges[f['id']]
                self.assertEqual(graph.components[edge.a],graph.components[edge.b])
                self.assertTrue(live.land_access.clear(*edge.points))
                self.assertEqual(graph.navigation_facility_ids[edge.way_id],f['id'])
            with self.assertRaises(NavigationRejected): graph.route(body(p(0,0),p(10,10)))

    def test_frozen_random_routes_enforce_the_twenty_metre_policy_without_replacing_failures(self):
        paths=[ROOT/'data/demo_areas/random-route-samples.json',ROOT/'tests/fixtures/demo-routing/holdout-samples.json']
        for path in paths:
            sample=json.loads(path.read_text(encoding='utf-8'));result=evaluate(sample,demo=True)
            for row in result['summary']:
                with self.subTest(seed=sample['seed'],area=row['area'],category=row['category']):
                    self.assertEqual(row['total'],30)
            # The stricter 20 m policy takes priority over the previous route-
            # availability target. The separate audit preserves these legacy
            # failures; its new 95% gate uses frozen walking-eligible samples.
            # Never add long shortcuts
            # merely to satisfy that score.
            for row in result['cases']:
                if not row['success']:
                    self.assertTrue(row['reason'])
                for step in row.get('maneuvers',[]):
                    if 'open area' in step['instruction']:
                        self.assertLessEqual(step['distance_meters'],20+1e-6)
            # No duplicate journey was substituted for a failed one.
            pairs={(r['area'],tuple(r['origin']),tuple(r['destination'])) for r in sample['cases']}
            self.assertEqual(len(pairs),len(sample['cases']))

    def test_independent_facility_samples_actually_traverse_the_named_facility(self):
        sample=json.loads((ROOT/'tests/fixtures/demo-routing/facility-samples.json').read_text(encoding='utf-8'))
        result=evaluate(sample,demo=True)
        for row in result['summary']:
            with self.subTest(area=row['area'],category=row['category']):
                self.assertGreaterEqual(row['rate'],.95)

    def test_json_cache_roundtrip_and_source_or_algorithm_mismatch_fall_back(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'roads.osm';cache=Path(folder)/'roads.json.gz'
            a,b=p(-80,0),p(80,0)
            source.write_text(f'<osm><node id="a" lon="{a[0]}" lat="{a[1]}"/><node id="b" lon="{b[0]}" lat="{b[1]}"/><way id="1"><nd ref="a"/><nd ref="b"/><tag k="highway" v="footway"/></way></osm>')
            bounds=(101.795,2.999,101.815,3.018)
            graph=RoadsideGraph(source,bounds,resident_access=True)
            write_graph(cache,graph,source);loaded=read_graph(cache,source,bounds)
            self.assertIsNotNone(loaded);self.assertEqual(loaded.edges,graph.edges)
            self.assertEqual(loaded.route(body(a,b)).geometry,graph.route(body(a,b)).geometry)
            data=json.loads(gzip.decompress(cache.read_bytes()));data['algorithm']='stale'
            cache.write_bytes(gzip.compress(json.dumps(data).encode()))
            self.assertIsNone(read_graph(cache,source,bounds))
            write_graph(cache,graph,source);source.write_text(source.read_text()+'\n')
            self.assertIsNone(read_graph(cache,source,bounds))
            cache.write_bytes(b'not a cache');self.assertIsNone(read_graph(cache,source,bounds))

    def test_health_identifies_the_routing_revision_without_disclosing_configuration(self):
        from backend.tests.test_navigation import NavigationTests
        fixture=NavigationTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        response=fixture.client().get('/health')
        self.assertEqual(response.json(),{'status':'ok'})
        self.assertEqual(response.headers['x-enclave-routing-revision'],'demo-crossings-v1')
        self.assertEqual(fixture.client().get('/health/routing').json(),{'routing_revision':'demo-crossings-v1'})
