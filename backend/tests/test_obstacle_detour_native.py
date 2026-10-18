"""Real bundled KL East routing must change path and clear the confirmed square."""

import asyncio
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import sys
import unittest

import httpx

from backend.core.config import Settings
from backend.navigation.config import NavigationSettings
from backend.navigation.contracts import WalkingRouteRequest
from backend.reports.issues import CommunityIssues
from backend.navigation.provider import ValhallaProvider
from backend.navigation.service import NavigationService
from backend.navigation.zones import zone_bounds,route_intersects_zone

ROOT=Path(__file__).resolve().parents[1]/'navigation'


@unittest.skipUnless((ROOT/'.runtime/engine.json').is_file(),'Prepare the optional routing graph first')
class RealObstacleDetourTests(unittest.TestCase):
    def test_real_route_changes_and_does_not_intersect_confirmed_square(self):
        sys.path.insert(0,str(ROOT/'.runtime/packages'))
        import valhalla
        actor=valhalla.Actor(json.loads((ROOT/'.runtime/engine.json').read_text())['config_path'])
        async def check():
            row={'id':'20000000-0000-4000-8000-000000000001','facility_id':'10000000-0000-4000-8000-000000000001',
                'facility_name':'Native fixture','facility_type':'path_surface','fault_kind':'damage','status':'open',
                'latitude':3.22649,'longitude':101.730755,'reporter_count':2,'affects_routes':True,
                'created_at':datetime.now(timezone.utc).isoformat(),'resolved_at':None}
            obstacles=CommunityIssues(Settings('https://example.supabase.co','sb_secret_native_fixture'),
                transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'state':'ok',
                    'checked_at':datetime.now(timezone.utc).isoformat(),'items':[row]})))
            provider=ValhallaProvider(NavigationSettings(crossing_policy='provider_default'),transport=httpx.MockTransport(
                lambda r:httpx.Response(200,json=actor.route(json.loads(r.content)))))
            try:
                service=NavigationService(provider,obstacles)
                body=WalkingRouteRequest(origin={'latitude':3.225377,'longitude':101.730331},
                    destination={'latitude':3.227217,'longitude':101.731778})
                ordinary=await service.route(body)
                avoided=await service.route(body.model_copy(update={'route_mode':'avoid_damage'}),'fixture-actor')
                bounds=zone_bounds(3.22649,101.730755,5)
                self.assertTrue(route_intersects_zone(ordinary.geometry.coordinates,bounds))
                self.assertFalse(route_intersects_zone(avoided.geometry.coordinates,bounds))
                self.assertNotEqual(ordinary.geometry.coordinates,avoided.geometry.coordinates)
                self.assertGreater(avoided.distance_meters,ordinary.distance_meters)
                self.assertEqual(avoided.community_issue_avoidance,'applied')
                self.assertEqual(avoided.obstacle_count,1)
            finally:
                await obstacles.close(); await provider.close()
        asyncio.run(check())
