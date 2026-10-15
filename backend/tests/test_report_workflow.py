"""HTTP contracts, authorization, failure handling, and synthetic full workflow."""

import json
import unittest
from uuid import UUID

from fastapi.testclient import TestClient
import httpx

from backend.app import AuthenticatedUser, create_app, current_user
from backend.core.config import Settings
from backend.reports.workflow_demo import create_workflow_demo_app, MANAGER, RESIDENT


class ReportWorkflowTests(unittest.TestCase):
    def demo(self):
        client = TestClient(create_workflow_demo_app())
        client.__enter__()
        self.addCleanup(client.__exit__,None,None,None)
        return client

    def headers(self, manager=False):
        return {'Authorization':'Bearer demo-management-token' if manager else 'Bearer demo-resident-token'}

    def patch(self, client, before='pending', after='approved', **extra):
        return client.patch('/api/v1/management/reports/DEMO-REVIEW-001/status',headers=self.headers(True),
            json={'expected_status':before,'status':after,'note':'Checked on site',
                  'repair_verified':after == 'resolved',**extra})

    def test_full_review_map_history_flow(self):
        client = self.demo()
        self.assertEqual(client.get('/api/v1/map/issues',headers=self.headers()).json()['features'],[])
        for before,after in [('pending','approved'),('approved','in_progress'),('in_progress','resolved')]:
            response = self.patch(client,before,after)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['event']['changed_by'],str(MANAGER))
            self.assertEqual(response.headers['cache-control'],'private, no-store')
            points = client.get('/api/v1/map/issues',headers=self.headers()).json()['features']
            self.assertEqual(len(points),int(after != 'resolved'))
        history = client.get('/api/v1/reports/DEMO-REVIEW-001/history',headers=self.headers())
        self.assertEqual(len(history.json()['items']),3)
        self.assertNotIn(str(MANAGER),history.text)
        self.assertNotIn('changed_by',history.text)
        self.assertEqual(len(client.get('/api/v1/map/issues?include_resolved=true',headers=self.headers()).json()['features']),1)

    def test_resident_cannot_moderate_and_other_owner_cannot_read_history(self):
        client=self.demo()
        self.assertEqual(client.get('/api/v1/management/reports',headers=self.headers()).status_code,403)
        response=client.patch('/api/v1/management/reports/DEMO-REVIEW-001/status',headers=self.headers(),
            json={'expected_status':'pending','status':'approved','note':'Check'})
        self.assertEqual(response.status_code,403)
        self.assertEqual(client.get('/api/v1/reports/DEMO-REVIEW-001/history',
            headers={'Authorization':'Bearer demo-other-token'}).status_code,404)

    def test_requires_authentication(self):
        client=self.demo()
        for url in ('/api/v1/management/reports','/api/v1/reports/DEMO-REVIEW-001/history'):
            self.assertEqual(client.get(url).status_code,401)

    def test_stale_update_returns_conflict_without_extra_history(self):
        client=self.demo()
        self.assertEqual(self.patch(client).status_code,200)
        self.assertEqual(self.patch(client).status_code,409)
        self.assertEqual(len(client.get('/api/v1/reports/DEMO-REVIEW-001/history',headers=self.headers()).json()['items']),1)

    def test_invalid_transitions_notes_and_client_actor_fields_rejected(self):
        client=self.demo()
        for changes in ({'status':'resolved','repair_verified':True},{'note':'  '},
                        {'note':'a'*1001},{'repair_verified':True},{'changed_by':str(MANAGER)},
                        {'actor_id':str(MANAGER)},{'role':'management'}, {'repair_verified':'false'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.patch(client,**changes).status_code,422)
        self.assertEqual(self.patch(client).status_code,200)
        self.assertEqual(self.patch(client,'approved','in_progress').status_code,200)
        self.assertEqual(self.patch(client,'in_progress','resolved',repair_verified=False).status_code,422)

    def test_filter_pagination_unknown_ticket_and_terminal_rejection(self):
        client=self.demo()
        self.assertEqual(client.get('/api/v1/management/reports?status=approved',headers=self.headers(True)).json()['items'],[])
        self.assertEqual(client.get('/api/v1/management/reports?limit=0',headers=self.headers(True)).status_code,422)
        self.assertEqual(client.get('/api/v1/management/reports?status=invalid',headers=self.headers(True)).status_code,422)
        self.assertEqual(client.get('/api/v1/reports/missing/history',headers=self.headers()).status_code,404)
        self.assertEqual(self.patch(client,after='rejected').status_code,200)
        self.assertEqual(self.patch(client,'rejected','approved').status_code,422)

    def test_mocked_resident_submit_then_management_review(self):
        client=self.demo()
        response=client.post('/api/v1/reports',headers=self.headers(),
            data={'description':'Synthetic fixture','latitude':'3.14','longitude':'101.69'},
            files={'file':('fixture.jpg',b'fixture-only','image/jpeg')})
        self.assertEqual(response.status_code,201,response.text)
        ticket=response.json()['ticket_id']
        self.assertEqual(client.patch('/api/v1/management/reports/'+ticket+'/status',headers=self.headers(True),
            json={'expected_status':'pending','status':'approved','note':'Verified'}).status_code,200)
        points=client.get('/api/v1/map/issues',headers=self.headers()).json()['features']
        self.assertEqual(points[0]['properties']['ticket_id'],ticket)
        self.assertEqual(len(client.get('/api/v1/reports',headers=self.headers()).json()['items']),2)

    def rpc_client(self, handler, *, actor=MANAGER, key='sb_secret_workflow_fixture_only'):
        def unavailable(request):
            raise AssertionError('Unexpected provider request')
        app=create_app(Settings('https://exampleproject.supabase.co',key),
            auth_transport=httpx.MockTransport(unavailable),reports_transport=httpx.MockTransport(unavailable),
            residents_transport=httpx.MockTransport(unavailable),map_transport=httpx.MockTransport(unavailable),
            workflow_transport=httpx.MockTransport(handler))
        app.dependency_overrides[current_user]=lambda: AuthenticatedUser(actor,'fixture@example.com','fake-access')
        client=TestClient(app)
        client.__enter__()
        self.addCleanup(client.__exit__,None,None,None)
        return client

    def test_actor_is_server_derived_and_secret_key_never_returned(self):
        def rpc(request):
            args=json.loads(request.content)
            self.assertEqual(args['p_args']['actor_id'],str(MANAGER))
            self.assertEqual(request.url.path,'/rest/v1/rpc/enclave_report_workflow')
            self.assertNotIn('authorization',request.headers)
            return httpx.Response(200,json={'state':'ok','items':[],'has_more':False})
        response=self.rpc_client(rpc).get('/api/v1/management/reports')
        self.assertEqual(response.status_code,200)
        self.assertNotIn('sb_secret_',response.text)

    def test_upstream_failures_and_malformed_data_are_generic(self):
        for payload in (None,[],{}, {'state':'unexpected'}, {'state':'ok','items':'wrong','has_more':False},
                        {'state':'ok','items':[],'has_more':'false'}):
            with self.subTest(payload=payload):
                client=self.rpc_client(lambda request: httpx.Response(200,json=payload))
                self.assertEqual(client.get('/api/v1/management/reports').status_code,503)
        client=self.rpc_client(lambda request: httpx.Response(500,json={'message':'private upstream contents'}))
        response=client.get('/api/v1/management/reports')
        self.assertEqual(response.status_code,503)
        self.assertNotIn('private upstream',response.text)

    def test_rpc_state_maps_to_expected_errors(self):
        for state,status in [('forbidden',403),('not_found',404),('conflict',409),('invalid',422)]:
            client=self.rpc_client(lambda request: httpx.Response(200,json={'state':state}))
            self.assertEqual(client.get('/api/v1/management/reports').status_code,status)

    def test_resident_history_hides_actor_uuid_even_if_upstream_includes_it(self):
        event={'id':1,'from_status':'pending','to_status':'approved','note':'Checked','repair_verified':False,
               'created_at':'2026-10-15T01:00:00Z','changed_by':str(MANAGER),'private':'secret'}
        client=self.rpc_client(lambda request: httpx.Response(200,json={'state':'ok','items':[event],
            'has_more':False,'is_management':False}),actor=RESIDENT)
        response=client.get('/api/v1/reports/TICK-TEST/history')
        self.assertEqual(response.status_code,200)
        self.assertNotIn(str(MANAGER),response.text)
        self.assertNotIn('private',response.text)

    def test_upstream_wrong_update_is_rejected(self):
        client=self.rpc_client(lambda request: httpx.Response(200,json={'state':'ok','report':{},'event':{}}))
        self.assertEqual(self.patch(client).status_code,503)
