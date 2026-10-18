"""Authored road bindings, explicit unknowns, and resident/simulation parity."""
import json
from datetime import datetime, timezone
import unittest
from uuid import UUID

import httpx

from backend.core.config import Settings
from backend.navigation.facility_segments import authored_bindings, restriction_for
from backend.navigation.zones import point_in_zone
from backend.reports.issues import CommunityIssue, CommunityIssues
from backend.tests import test_what_if as fixtures
from backend.tests.test_what_if import issue, body


class FacilitySegmentTests(unittest.IsolatedAsyncioTestCase):
    def demo(self):
        item = next(item for item,_ in authored_bindings().values() if item['id']=='9272512f-4ee5-5d0b-b0ed-5cbb30ec7af7')
        return CommunityIssue.model_validate(issue(facility_id=item['id'],facility_name=item['name'],
            facility_type=item['facility_type'],latitude=item['latitude'],longitude=item['longitude']))

    def test_source_segment_is_covered_without_guessing_adjacent_roads(self):
        restriction = restriction_for(self.demo())
        self.assertEqual(restriction['binding_source'],'mapped_demo_segment')
        for point in restriction['affected_segment'].coordinates:
            self.assertTrue(any(point_in_zone(point,(r[0][0],r[0][1],r[2][0],r[2][1])) for r in restriction['exclusion_rings']))
        changed = self.demo().model_copy(update={'longitude':101.730755})
        self.assertEqual(restriction_for(changed)['binding_source'],'point_only')
        self.assertIsNone(restriction_for(CommunityIssue.model_validate(issue()))['affected_segment'])

    async def test_resident_navigation_and_repair_simulation_use_identical_zones(self):
        demo = self.demo()
        def handler(request):
            self.assertEqual(json.loads(request.content)['p_action'],'obstacles')
            return httpx.Response(200,json={'state':'ok','checked_at':datetime.now(timezone.utc).isoformat(),'items':[demo.model_dump(mode='json')]})
        service = CommunityIssues(Settings('https://exampleproject.supabase.co','sb_secret_binding_fixture'),transport=httpx.MockTransport(handler))
        try:
            live = await service.active(UUID('00000000-0000-4000-8000-000000000001'))
        finally:
            await service.close()
        expected = restriction_for(demo)['exclusion_rings']
        self.assertEqual([i.exclusion_ring for i in live.items],expected)
        case = fixtures.WhatIfTests();case.setUp();case.issues=[demo.model_dump(mode='json')]
        payload=body();payload['plans'][0]['repairs'][0]['facility_id']=str(demo.facility_id)
        # TestClient is synchronous and owns its own event loop.
        import asyncio
        response=await asyncio.to_thread(case.compare,case.client(),payload)
        self.assertEqual(response.status_code,200,response.text)
        actual=response.json()['routing_restrictions'][0]['exclusion_rings']
        self.assertEqual(actual,[[list(p) for p in ring] for ring in expected])
        self.assertEqual(response.json()['baseline_road_obstacle_count'],1)
