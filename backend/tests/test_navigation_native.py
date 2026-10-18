"""Optional real Valhalla integration using the bundled public road snapshot only."""

import asyncio
import json
from pathlib import Path
import sys
import unittest

import httpx

from backend.navigation.config import NavigationSettings
from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.provider import ValhallaProvider
from backend.navigation.service import NavigationService

ROOT=Path(__file__).resolve().parents[1]/'navigation'


@unittest.skipUnless((ROOT/'.runtime/engine.json').is_file(),'Prepare the optional local navigation graph first')
class NativeNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0,str(ROOT/'.runtime/packages'))
        import valhalla
        cls.actor=valhalla.Actor(json.loads((ROOT/'.runtime/engine.json').read_text())['config_path'])

    def run_route(self,start,end):
        async def request():
            provider=ValhallaProvider(NavigationSettings(crossing_policy='provider_default'),transport=httpx.MockTransport(
                lambda r:httpx.Response(200,json=self.actor.route(json.loads(r.content)))))
            try:
                return await NavigationService(provider).route(WalkingRouteRequest(
                    origin={'latitude':start[1],'longitude':start[0]},destination={'latitude':end[1],'longitude':end[0]}))
            finally:
                await provider.close()
        return asyncio.run(request())

    def test_real_kl_east_walking_route_has_engine_generated_turns(self):
        response=self.run_route((101.730331,3.225377),(101.731778,3.227217))
        self.assertGreater(response.distance_meters,250)
        self.assertLess(response.distance_meters,450)
        self.assertTrue(any(step.type in (10,15) for step in response.maneuvers))
        self.assertTrue(all(step.spoken_instruction for step in response.maneuvers))
        self.assertEqual(response.data_source,'openstreetmap_unverified')
        self.assertFalse(response.field_verified)
        self.assertEqual(response.community_issue_avoidance,'not_applied')

    def test_park_route_can_include_stairs_and_is_not_labelled_step_free(self):
        response=self.run_route((101.730331,3.225377),(101.734647,3.228809))
        self.assertTrue(any(step.type==40 for step in response.maneuvers))
        self.assertEqual(response.profile,'walking')
