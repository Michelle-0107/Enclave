"""Actual KL East road routing with synthetic damage; no hosted data or network."""

import json
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
