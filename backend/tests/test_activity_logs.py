"""HTTP contract and fail-closed validation without hosted services."""
from uuid import UUID
import unittest

import httpx
from fastapi.testclient import TestClient

from backend.app import AuthenticatedUser, create_app, current_user
from backend.core.config import Settings


ACTOR = UUID('00000000-0000-4000-8000-000000000003')


class ActivityApiTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.data = {'state': 'ok', 'items': [], 'has_more': False}
        self.status = 200
        def rpc(request):
            import json
            self.requests.append(json.loads(request.content))
            self.assertEqual(request.url.path, '/rest/v1/rpc/enclave_activity_logs')
            self.assertNotIn('authorization', request.headers)
            return httpx.Response(self.status, json=self.data)
        app = create_app(Settings('https://fixture.supabase.co', 'sb_secret_activity_fixture'),
                         activity_logs_transport=httpx.MockTransport(rpc))
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def login(self):
        self.client.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(ACTOR, 'test@example.com', 'private-jwt')

    def test_requires_authentication(self):
        self.assertEqual(self.client.get('/api/v1/management/activity-logs').status_code, 401)
        self.assertEqual(self.requests, [])

    def test_portal_and_actor_are_server_derived_with_filters(self):
        self.login()
        for portal in ('management', 'maintenance'):
            response = self.client.get(f'/api/v1/{portal}/activity-logs', params={
                'search': ' repair ', 'from': '2026-10-20', 'to': '2026-10-21',
                'result': 'failed', 'role': portal, 'offset': 20, 'actor_id': 'spoof', 'portal': 'spoof'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.headers['cache-control'], 'private, no-store')
            args = self.requests[-1]['p_args']
            self.assertEqual(args['actor_id'], str(ACTOR)); self.assertEqual(args['portal'], portal)
            self.assertEqual(args['search'], 'repair'); self.assertEqual(args['from'], '2026-10-20')
            self.assertEqual(args['limit'], 20); self.assertEqual(args['offset'], 20)

    def test_validates_filters_before_rpc(self):
        self.login()
        for params in ({'limit': 101}, {'offset': -1}, {'offset': 100001}, {'result': 'other'},
                       {'role': 'admin'}, {'from': 'garbage'}, {'from': '2026-10-22', 'to': '2026-10-21'},
                       {'search': 'x' * 201}):
            self.assertEqual(self.client.get('/api/v1/maintenance/activity-logs', params=params).status_code, 422)
        self.assertEqual(self.requests, [])

    def test_database_denial_and_unavailable_are_not_empty_history(self):
        self.login(); self.data = {'state': 'forbidden'}
        self.assertEqual(self.client.get('/api/v1/maintenance/activity-logs').status_code, 403)
        self.status = 404
        response = self.client.get('/api/v1/maintenance/activity-logs')
        self.assertEqual(response.status_code, 503); self.assertIn('SQL 027', response.text)

    def test_rejects_malformed_or_cross_portal_upstream_rows(self):
        self.login()
        row = dict(id='1', created_at='2026-10-21T00:00:00Z', actor_name='Manager', actor_role='management',
                   action='Review', target_label='Task', target_id=None, result='success', summary='Reviewed')
        self.data = {'state': 'ok', 'items': [row], 'has_more': False}
        self.assertEqual(self.client.get('/api/v1/maintenance/activity-logs').status_code, 503)
        self.assertEqual(self.client.get('/api/v1/management/activity-logs').status_code, 200)
        self.data = {'state': 'ok', 'items': [{}], 'has_more': False}
        self.assertEqual(self.client.get('/api/v1/management/activity-logs').status_code, 503)


if __name__ == '__main__':
    unittest.main()
