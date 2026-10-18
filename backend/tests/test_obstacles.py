"""Route modes and safe handling of community restriction snapshots."""
from datetime import datetime,timedelta,timezone
import json,unittest
import httpx
from fastapi.testclient import TestClient
from backend.reports.community_demo import CommunityDemoState,create_community_demo_app,FACILITY,ISSUE,B
from backend.navigation.demo import fixture_response
from backend.navigation.config import NavigationSettings
from backend.navigation.zones import segment_intersects_zone

class ObstacleTests(unittest.TestCase):
    def setUp(self):
        self.state=CommunityDemoState(); self.payloads=[]
        self.body={'origin':{'latitude':3.2254,'longitude':101.7304},'destination':{'latitude':3.226,'longitude':101.7312}}
        self.headers={'Authorization':'Bearer demo-resident-token'}
    def client(self,custom=None):
        if custom: self.state.rpc=custom
        def engine(r): self.payloads.append(json.loads(r.content)); return httpx.Response(200,json=fixture_response())
        c=TestClient(create_community_demo_app(state=self.state,navigation_transport=httpx.MockTransport(engine)))
        c.__enter__(); self.addCleanup(c.__exit__,None,None,None)
        c.app.state.navigation.provider.settings=NavigationSettings(crossing_policy='provider_default')
        return c
    def route(self,c,mode='avoid_damage',**extra):
        return c.post('/api/v1/navigation/routes',headers=self.headers,json={**self.body,'route_mode':mode,**extra})
    def test_shortest_ignores_damage_and_does_not_read_restrictions(self):
        self.state.votes[ISSUE].add(B); c=self.client()
        r=self.route(c,'shortest'); self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['community_issue_avoidance'],'not_applied'); self.assertEqual(self.state.calls,[])
        self.assertEqual(self.payloads[0]['costing_options'],{'pedestrian':{'shortest':True}})
        self.assertNotIn('exclude_polygons',self.payloads[0])
    def test_first_report_is_not_avoided_and_second_report_applies_exclusion(self):
        c=self.client(); r=self.route(c)
        self.assertEqual(r.status_code,200,r.text); self.assertEqual(r.json()['community_issue_avoidance'],'no_active_obstacles')
        self.state.votes[ISSUE].add(B); r=self.route(c)
        self.assertEqual(r.status_code,200,r.text); self.assertEqual(r.json()['obstacle_count'],1)
        self.assertEqual(r.json()['obstacle_source'],'community_reports')
        self.assertIn('exclude_polygons',self.payloads[-1])
        self.assertNotIn(ISSUE,json.dumps(self.payloads[-1]))
    def test_engine_ignoring_damage_zone_is_rejected(self):
        self.state.votes[ISSUE].add(B); self.state.facilities[FACILITY].update(latitude=3.2257,longitude=101.7304)
        r=self.route(self.client()); self.assertEqual(r.status_code,422,r.text)
    def test_blocked_endpoint_returns_409_without_engine(self):
        self.state.votes[ISSUE].add(B); self.state.facilities[FACILITY].update(**self.body['origin'])
        r=self.route(self.client()); self.assertEqual(r.status_code,409); self.assertEqual(self.payloads,[])
    def test_missing_database_never_falls_back(self):
        c=self.client(lambda r:httpx.Response(404,json={'private':'provider-detail'}))
        for mode in ('avoid_damage','accessible'):
            r=self.route(c,mode); self.assertEqual(r.status_code,503); self.assertNotIn('provider-detail',r.text)
        self.assertEqual(self.payloads,[])
    def test_insufficient_accessibility_data_does_not_return_walking_route(self):
        c=self.client(); r=self.route(c,'accessible')
        self.assertEqual(r.status_code,422,r.text); self.assertIn('verified accessible',r.json()['detail'])
        self.assertEqual(self.payloads,[])
        area=c.get('/api/v1/navigation/area',headers=self.headers).json()
        self.assertEqual(area['supported_route_modes'],['shortest','avoid_damage','accessible'])
        self.assertFalse(area['accessible_network_available'])
    def test_invalid_modes_and_contradictory_legacy_flags_rejected(self):
        c=self.client()
        self.assertEqual(self.route(c,'driving').status_code,422)
        self.assertEqual(self.route(c,'accessible',avoid_confirmed_obstacles=False).status_code,422)
        r=c.post('/api/v1/navigation/routes',headers=self.headers,json={**self.body,'avoid_confirmed_obstacles':True})
        self.assertEqual(r.status_code,200,r.text); self.assertEqual(r.json()['route_mode'],'avoid_damage')
    def test_invalid_single_report_expired_or_duplicate_snapshot_fails_closed(self):
        item=self.state.projection(self.state.issues[ISSUE]); item['reporter_count']=2
        def handler(rows,stamp=None): return lambda r:httpx.Response(200,json={'state':'ok','items':rows,
            'checked_at':stamp or datetime.now(timezone.utc).isoformat()})
        cases=[handler([{**item,'reporter_count':1}]),handler([{**item,'affects_routes':False}]),
            handler([item,item]),handler([item]*101),handler([item],(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()),
            lambda r:httpx.Response(200,json={'state':'too_many'})]
        for callback in cases:
            c=self.client(callback); self.assertEqual(self.route(c).status_code,503)
        self.assertEqual(self.payloads,[])
    def test_zone_check_includes_crossing_segments_and_tangency(self):
        box=(0,0,1,1)
        self.assertTrue(segment_intersects_zone((-1,.5),(2,.5),box))
        self.assertTrue(segment_intersects_zone((-1,0),(2,0),box))
        self.assertFalse(segment_intersects_zone((-1,2),(2,2),box))
