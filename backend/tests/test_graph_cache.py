"""Concurrent cold routing loads must share memory instead of rebuilding per caller."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import threading
import unittest
from unittest.mock import patch

from backend.navigation.graph_cache import shared_graph_cache
from backend.navigation.roadside import walking_graph


class GraphCacheTests(unittest.TestCase):
    def test_concurrent_first_call_loads_once_and_returns_identical_graph(self):
        started, release = threading.Event(), threading.Event()
        calls = []

        @shared_graph_cache()
        def load(area):
            calls.append(area)
            started.set()
            if not release.wait(3):
                raise AssertionError('load not released')
            return object()

        with ThreadPoolExecutor(max_workers=4) as pool:
            pending = [pool.submit(load, 'kl-east-pilot') for _ in range(4)]
            try:
                self.assertTrue(started.wait(2))
            finally:
                release.set()
            values = [future.result(3) for future in pending]
        self.assertEqual(calls, ['kl-east-pilot'])
        self.assertTrue(all(value is values[0] for value in values))
        self.assertEqual(load.cache_info().misses, 1)
        load.cache_clear()
        self.assertIsNot(load('kl-east-pilot'), values[0])

    def test_failed_load_can_retry_and_distinct_areas_do_not_share_graphs(self):
        calls = []

        @shared_graph_cache(maxsize=2)
        def load(area):
            calls.append(area)
            if len(calls) == 1:
                raise ValueError('source unavailable')
            return object()

        with self.assertRaises(ValueError):
            load('kl-east-pilot')
        first = load('kl-east-pilot')
        self.assertIs(load('kl-east-pilot'), first)
        self.assertIsNot(load('kajang-prima-saujana'), first)
        self.assertEqual(calls, ['kl-east-pilot', 'kl-east-pilot', 'kajang-prima-saujana'])

    def test_live_and_demo_entry_points_share_concurrent_cold_loads(self):
        from backend.navigation.demo_network import demo_walking_graph
        for loader, dependency in [(walking_graph, 'backend.navigation.road_cache.read_graph'),
                (demo_walking_graph, 'backend.navigation.demo_network.overlay_graph')]:
            with self.subTest(loader=loader.__name__):
                loader.cache_clear()
                self.addCleanup(loader.cache_clear)
                graph = object()
                with patch(dependency, return_value=graph) as read:
                    with ThreadPoolExecutor(max_workers=4) as pool:
                        values = list(pool.map(loader, ['kl-east-pilot'] * 4))
                self.assertEqual(read.call_count, 1)
                self.assertTrue(all(value is graph for value in values))

    def test_cold_two_path_three_plan_comparison_loads_one_graph_and_returns_all_results(self):
        from backend.tests.test_what_if import WhatIfTests, issue, F2, I2
        from backend.navigation import road_cache
        fixture = WhatIfTests(); fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.issues = [issue(facility_id='9272512f-4ee5-5d0b-b0ed-5cbb30ec7af7',
            facility_name='[DEMO] KL East 04 - Mall north pavement',latitude=3.22608585,longitude=101.73009065),
            issue(id=I2,facility_id=F2,latitude=3.22649,longitude=101.730755)]
        payload = {'paths':[
            {'id':'p1','name':'1','origin':{'latitude':3.226586,'longitude':101.729647},'destination':{'latitude':3.226211,'longitude':101.730629}},
            {'id':'p2','name':'2','origin':{'latitude':3.226673,'longitude':101.729446},'destination':{'latitude':3.225162,'longitude':101.730849}}],
            'plans':[{'id':f'plan{n}','name':f'Plan {n}','repairs':[{'facility_id':fid} for fid in fids]}
                for n,fids in enumerate([[fixture.issues[0]['facility_id']],[F2],[fixture.issues[0]['facility_id'],F2]])],
            'route_modes':['avoid_damage','accessible'],'include_geometry':True}
        client=fixture.client()
        client.app.state.navigation.provider.settings=replace(client.app.state.navigation.provider.settings,crossing_policy='mapped_facilities_only')
        walking_graph.cache_clear();self.addCleanup(walking_graph.cache_clear)
        with self.assertLogs('uvicorn.error',level='INFO') as logs, patch.object(road_cache,'read_graph',wraps=road_cache.read_graph) as read:
            response=client.post('/api/v1/management/what-if/compare',json=payload,
                headers={'Authorization':'Bearer manager-fixture','Origin':'https://enclavehomes.app'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(read.call_count,1)
        self.assertEqual(response.headers['access-control-allow-origin'],'https://enclavehomes.app')
        output='\n'.join(logs.output)
        self.assertIn('enclave_compare received trace=',output)
        self.assertIn('enclave_compare response trace=',output)
        self.assertIn('status=200 elapsed_ms=',output)
        for private in ['manager-fixture','3.226586','101.729647',fixture.issues[0]['facility_id']]:
            self.assertNotIn(private,output)
        result=response.json()
        self.assertEqual(len(result['baseline']),4)
        self.assertEqual(len(result['plans']),3)
        for plan in result['plans']:
            self.assertEqual(len(plan['paths']),4)
            self.assertEqual({row['path_id'] for row in plan['paths']},{'p1','p2'})


if __name__ == '__main__':
    unittest.main()
