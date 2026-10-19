"""A cold demo routing graph must not stall health checks on the ASGI event loop."""

import asyncio
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx

from backend.navigation.demo_routes import DemoRouteOption, DemoRouteResponse
from backend.tests import test_navigation as fixtures


class DemoRoutingStartupTests(unittest.TestCase):
    def test_health_remains_responsive_while_the_first_graph_loads(self):
        fixture = fixtures.NavigationTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        app = fixture.client().app
        started, release = threading.Event(), threading.Event()
        threads = {}

        def dataset(area_id):
            threads['dataset'] = threading.get_ident()
            return SimpleNamespace(dataset={})

        def graph(area_id):
            threads['graph'] = threading.get_ident()
            started.set()
            release.wait(3)
            return object()

        def calculate(area_id, bounds, request, dataset, graph):
            threads['calculate'] = threading.get_ident()
            return DemoRouteResponse(
                area_id=area_id, requested_origin=request.origin, selected_origin=request.origin,
                start_adjustment_meters=0, adjusted_start=False,
                options=[DemoRouteOption(mode='shortest', unavailable_reason='Synthetic fixture')],
            )

        async def check():
            loop_thread = threading.get_ident()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                pending = asyncio.create_task(client.post('/api/v1/navigation/areas/kl-east-pilot/demo-routes',
                    headers={'Authorization': 'Bearer fixture-resident'}, json={
                        'origin': {'longitude': 101.7304, 'latitude': 3.2254},
                        'destination': {'longitude': 101.7312, 'latitude': 3.2260},
                    }))
                try:
                    self.assertTrue(await asyncio.wait_for(asyncio.to_thread(started.wait, 2), 2.5))
                    self.assertFalse(pending.done(), 'Graph loading must yield the event loop')
                    health = await asyncio.wait_for(client.get('/health'), 1)
                    self.assertEqual(health.status_code, 200)
                    self.assertFalse(pending.done(), 'Health must finish before the cold graph finishes')
                finally:
                    release.set()
                    response = await asyncio.wait_for(pending, 2)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(set(threads), {'dataset', 'graph', 'calculate'})
                self.assertTrue(all(thread != loop_thread for thread in threads.values()))

        with patch('backend.app.demo_area_dataset', dataset), patch('backend.app.walking_graph', graph), \
                patch('backend.app.calculate_demo_routes', calculate):
            asyncio.run(check())


if __name__ == '__main__':
    unittest.main()
