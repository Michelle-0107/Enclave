"""Actual KL East road routing with synthetic damage; no hosted data or network."""

import json
from dataclasses import replace
from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient
import httpx

from backend.what_if.demo import create_demo_app, sample_request

ROOT = Path(__file__).resolve().parents[1] / 'navigation'


@unittest.skipUnless((ROOT / '.runtime/engine.json').is_file(), 'Prepare the optional local road graph first')
class WhatIfNativeTests(unittest.TestCase):
    def test_actual_engine_repair_comparison_reduces_kl_east_detour(self):
        sys.path.insert(0, str(ROOT / '.runtime/packages'))
        import valhalla
        actor = valhalla.Actor(json.loads((ROOT / '.runtime/engine.json').read_text())['config_path'])
        def engine(request):
            try:
                return httpx.Response(200, json=actor.route(json.loads(request.content)))
            except valhalla.ValhallaError as error:
                return httpx.Response(400, json={'error_code': error.code})
        app = create_demo_app(navigation_transport=httpx.MockTransport(engine))
        with TestClient(app) as client:
            app.state.navigation.provider.settings=replace(app.state.navigation.provider.settings,crossing_policy='provider_default')
            response = client.post('/api/v1/management/what-if/compare', json=sample_request(),
                                   headers={'Authorization': 'Bearer demo-management-token'})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        plan = result['plans'][0]
        self.assertEqual(plan['affected_major_path_count'], 1)
        self.assertEqual(plan['improved_major_path_count'], 1)
        self.assertEqual(plan['paths'][0]['effect'], 'shortened')
        self.assertGreater(plan['paths'][0]['distance_saved_meters'], 30)
        self.assertEqual(plan['paths'][1]['effect'], 'not_assessable')
        self.assertFalse(plan['paths'][0]['after']['field_verified'])
        print('Real KL East engine: current %.1fm; simulated repair %.1fm; saved %.1fm.' % (
            result['baseline'][0]['current']['distance_meters'], plan['paths'][0]['after']['distance_meters'],
            plan['paths'][0]['distance_saved_meters']))


    def test_user_path3_fixed_endpoints_and_authored_segment(self):
        from backend.tests.test_what_if import WhatIfTests, issue
        from backend.navigation.zones import route_intersects_zone
        case = WhatIfTests()
        case.setUp()
        case.issues = [issue(facility_id='9272512f-4ee5-5d0b-b0ed-5cbb30ec7af7',
            facility_name='[DEMO] KL East 04 - Mall north pavement',latitude=3.22608585,longitude=101.73009065)]
        sys.path.insert(0, str(ROOT / '.runtime/packages'))
        import valhalla
        actor = valhalla.Actor(json.loads((ROOT / '.runtime/engine.json').read_text())['config_path'])
        case.engine_override = lambda data: httpx.Response(200,json=actor.route(data))
        payload = {'paths':[{'id':'path3','name':'User Path 3',
            'origin':{'latitude':3.226307,'longitude':101.730720},
            'destination':{'latitude':3.226325,'longitude':101.729904}}],
            'plans':[{'id':'repair','name':'Repair pavement','repairs':[{'facility_id':case.issues[0]['facility_id']}]}],
            'route_modes':['avoid_damage'],'include_geometry':True}
        response = case.compare(case.client(),payload)
        self.assertEqual(response.status_code,200,response.text)
        result = response.json(); before=result['baseline'][0]; after=result['plans'][0]['paths'][0]
        self.assertEqual(result['routing_restrictions'][0]['binding_source'],'mapped_demo_segment')
        self.assertIsNotNone(result['routing_restrictions'][0]['affected_segment'])
        for route in (before['current'], after['after']):
            coordinates=route['geometry']['coordinates']
            for point,target in zip((coordinates[0],coordinates[-1]),(before['comparison_origin'],before['comparison_destination'])):
                from backend.navigation.service import distance_meters
                self.assertLessEqual(distance_meters(point,(target['longitude'],target['latitude'])),1)
        for ring in result['routing_restrictions'][0]['exclusion_rings']:
            box=(ring[0][0],ring[0][1],ring[2][0],ring[2][1])
            self.assertFalse(route_intersects_zone(before['current']['geometry']['coordinates'],box))
        self.assertLessEqual(after['after']['distance_meters'],before['current']['distance_meters'])
        print('User Path 3 fixed endpoints: before %.1fm; after %.1fm; %s.' % (
            before['current']['distance_meters'],after['after']['distance_meters'],after['effect']))
