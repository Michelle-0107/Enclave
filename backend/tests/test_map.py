"""Community map now counts distinct residents independently of repair approval."""
from datetime import datetime,timezone
import json,unittest
from fastapi.testclient import TestClient
import httpx
from backend.reports.community_demo import create_community_demo_app,CommunityDemoState,A,B,ISSUE,FACILITY
from backend.navigation.demo import fixture_response

class CommunityMapTests(unittest.TestCase):
    def client(self,state=None):
        self.state=state or CommunityDemoState()
        client=TestClient(create_community_demo_app(state=self.state,
            navigation_transport=httpx.MockTransport(lambda r:httpx.Response(200,json=fixture_response()))))
        client.__enter__(); self.addCleanup(client.__exit__,None,None,None); return client
    def headers(self,second=False): return {'Authorization':'Bearer demo-resident-2-token' if second else 'Bearer demo-resident-token'}
    def join(self,c,second=True,ticket=None):
        return c.post(f'/api/v1/community/issues/{ISSUE}/reports',headers=self.headers(second),
            json={'report_ticket_id':ticket or ('DEMO-B-001' if second else 'DEMO-A-002')})
    def test_requires_authentication_and_verified_resident(self):
        c=self.client()
        for path in ('/api/v1/map/issues','/api/v1/community/issues','/api/v1/facilities','/api/v1/navigation/obstacles'):
            self.assertEqual(c.get(path).status_code,401)
            self.assertEqual(c.get(path,headers={'Authorization':'Bearer demo-management-token'}).status_code,403)
    def test_one_report_discoverable_but_hidden_from_map(self):
        c=self.client()
        self.assertEqual(c.get('/api/v1/map/issues',headers=self.headers()).json()['features'],[])
        items=c.get('/api/v1/community/issues',headers=self.headers()).json()['items']
        self.assertEqual(items[0]['reporter_count'],1)
        self.assertEqual(items[0]['id'],ISSUE)
    def test_second_person_publishes_one_point_without_approval(self):
        c=self.client(); r=self.join(c)
        self.assertEqual(r.status_code,200,r.text); self.assertTrue(r.json()['community_visible'])
        features=c.get('/api/v1/map/issues',headers=self.headers()).json()['features']
        self.assertEqual(len(features),1); self.assertEqual(features[0]['properties']['reporter_count'],2)
        self.assertEqual(features[0]['geometry']['coordinates'],[101.730755,3.22649])
        self.assertTrue(all(r['status']=='pending' and r['is_approved'] is False for r in self.state.reports.values()))
    def test_duplicate_resident_and_new_evidence_still_count_once(self):
        c=self.client(); r=self.join(c,False)
        self.assertTrue(r.json()['deduplicated']); self.assertEqual(r.json()['issue']['reporter_count'],1)
        self.assertFalse(r.json()['community_visible'])
        self.assertEqual(c.get('/api/v1/map/issues',headers=self.headers()).json()['features'],[])
    def test_cannot_link_another_users_evidence_or_choose_actor(self):
        c=self.client()
        self.assertEqual(self.join(c,False,'DEMO-B-001').status_code,404)
        self.assertEqual(c.post(f'/api/v1/community/issues/{ISSUE}/reports',headers=self.headers(),
            json={'report_ticket_id':'DEMO-A-001','actor_id':B}).status_code,422)
    def test_facility_create_list_and_existing_evidence_open_issue(self):
        c=self.client()
        r=c.post('/api/v1/facilities',headers=self.headers(),json={'name':'Test ramp','facility_type':'ramp','latitude':3.22649,'longitude':101.730755})
        self.assertEqual(r.status_code,201,r.text); facility=r.json()['id']
        r=c.post('/api/v1/community/issues',headers=self.headers(),json={'facility_id':facility,'fault_kind':'damage','report_ticket_id':'DEMO-A-002'})
        self.assertEqual(r.status_code,200,r.text); self.assertEqual(r.json()['issue']['reporter_count'],1)
        self.assertEqual(len(c.get('/api/v1/facilities',headers=self.headers()).json()['items']),2)
    def test_private_details_are_not_in_map_choices_or_obstacles(self):
        c=self.client(); self.join(c)
        for path in ('/api/v1/map/issues','/api/v1/community/issues','/api/v1/navigation/obstacles','/api/v1/facilities'):
            r=c.get(path,headers=self.headers()); self.assertEqual(r.status_code,200,r.text)
            for value in (A,B,'SYNTHETIC private evidence','image_url','user_id','report_ticket_id'):
                self.assertNotIn(value,r.text)
            self.assertEqual(r.headers['cache-control'],'private, no-store')
    def test_bench_issue_visible_but_not_an_obstacle(self):
        state=CommunityDemoState(); state.facilities[FACILITY]['facility_type']='bench'
        c=self.client(state); self.join(c)
        self.assertEqual(len(c.get('/api/v1/map/issues',headers=self.headers()).json()['features']),1)
        self.assertEqual(c.get('/api/v1/navigation/obstacles',headers=self.headers()).json()['items'],[])
    def test_bbox_pagination_and_invalid_inputs(self):
        c=self.client(); self.join(c)
        for query in ('bbox=0,0,1,1','offset=1'):
            self.assertEqual(c.get('/api/v1/map/issues?'+query,headers=self.headers()).json()['features'],[])
        for query in ('bbox=bad','bbox=180,0,-180,1','limit=0','offset=-1'):
            self.assertEqual(c.get('/api/v1/map/issues?'+query,headers=self.headers()).status_code,422)
    def test_resolved_historical_point_requires_opt_in_and_cannot_receive_more_reports(self):
        c=self.client(); self.join(c); self.state.issues[ISSUE].update(status='resolved',resolved_at=datetime.now(timezone.utc).isoformat())
        self.assertEqual(c.get('/api/v1/map/issues',headers=self.headers()).json()['features'],[])
        self.assertEqual(len(c.get('/api/v1/map/issues?include_resolved=true',headers=self.headers()).json()['features']),1)
        self.assertEqual(self.join(c,False).status_code,409)
    def test_existing_photo_report_pipeline_still_works_before_linking(self):
        c=self.client(); r=c.post('/api/v1/reports',headers=self.headers(),
            data={'description':'Test','latitude':'3.22649','longitude':'101.730755'},files={'file':('test.jpg',b'test-only','image/jpeg')})
        self.assertEqual(r.status_code,201,r.text)
        self.assertIn(r.json()['ticket_id'],self.state.reports)
        self.assertEqual(c.get('/api/v1/map/issues',headers=self.headers()).json()['features'],[])
    def test_legacy_management_confirmation_routes_are_retired(self):
        c=self.client(); paths=c.get('/openapi.json').json()['paths']
        self.assertNotIn('/api/v1/management/reports/{ticket_id}/routing-impact',paths)
        self.assertIn('/api/v1/community/issues/{issue_id}/reports',paths)
