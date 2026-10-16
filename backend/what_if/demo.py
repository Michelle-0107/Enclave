"""Synthetic management/candidates with the real local road engine; never deploy."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import httpx

from ..app import AuthenticatedUser, bearer, create_app, current_user
from ..core.config import Settings

MANAGER = '00000000-0000-4000-8000-000000000003'
RESIDENT = '00000000-0000-4000-8000-000000000001'
FACILITY = '10000000-0000-4000-8000-000000000001'
ISSUE = '20000000-0000-4000-8000-000000000001'


def sample_request():
    return {
        'paths': [{'id': 'mall-walk', 'name': 'SYNTHETIC designated KL East walking journey',
                   'origin': {'latitude': 3.225377, 'longitude': 101.730331},
                   'destination': {'latitude': 3.227217, 'longitude': 101.731778}}],
        'plans': [{'id': 'repair-walkway', 'name': 'SYNTHETIC repair estimate',
                   'repairs': [{'facility_id': FACILITY, 'estimated_cost_myr': '1200.00'}]}],
        'budget_myr': '1500.00', 'route_modes': ['avoid_damage', 'accessible'], 'include_geometry': True,
    }


def create_demo_app(*, navigation_transport=None, accessibility_network=None):
    def no_cloud(request):
        raise AssertionError('What-if sandbox must not call cloud services')

    def snapshot(request):
        if request.url.path != '/rest/v1/rpc/enclave_what_if_snapshot':
            raise AssertionError('Unexpected sandbox RPC')
        import json
        if json.loads(request.content)['p_actor_id'] != MANAGER:
            return httpx.Response(200, json={'state': 'forbidden'})
        now = datetime.now(timezone.utc).isoformat()
        return httpx.Response(200, json={'state': 'ok', 'checked_at': now, 'issues': [{
            'id': ISSUE, 'facility_id': FACILITY, 'facility_name': 'SYNTHETIC walkway damage',
            'facility_type': 'path_surface', 'latitude': 3.22649, 'longitude': 101.730755,
            'fault_kind': 'damage', 'status': 'open', 'reporter_count': 2, 'affects_routes': True,
            'created_at': now, 'resolved_at': None}]})

    app = create_app(Settings('https://exampleproject.supabase.co', 'sb_secret_what_if_fixture'),
        auth_transport=httpx.MockTransport(no_cloud), reports_transport=httpx.MockTransport(no_cloud),
        residents_transport=httpx.MockTransport(no_cloud), community_transport=httpx.MockTransport(no_cloud),
        workflow_transport=httpx.MockTransport(no_cloud), what_if_transport=httpx.MockTransport(snapshot),
        navigation_transport=navigation_transport, accessibility_network=accessibility_network)

    def user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        tokens = {'demo-management-token': MANAGER, 'demo-resident-token': RESIDENT}
        actor = tokens.get(credentials.credentials) if credentials else None
        if actor is None:
            raise HTTPException(401, 'Use a local demo token')
        return AuthenticatedUser(UUID(actor), 'synthetic@example.com', credentials.credentials)

    app.dependency_overrides[current_user] = user
    app.router.routes = [route for route in app.router.routes if getattr(route, 'path', '') in
                        ('/openapi.json', '/docs', '/docs/oauth2-redirect', '/redoc', '/health', '/auth/me')
                        or getattr(route, 'path', '').startswith('/api/v1/management/what-if/')]
    app.title = 'Enclave LOCAL What-if repair comparison sandbox'
    app.description = ('Synthetic manager, incident, major-path label and MYR estimate. Real local engine on port 8002. '
                       'Authorize demo-management-token; resident token returns 403. No .env/cloud/email writes. '
                       'Use the POST example. Accessibility data is empty and explicitly not assessable. Never deploy this sandbox.')
    # Give Swagger a complete runnable demo, without changing the production examples.
    schema = app.openapi()
    operation = schema['paths']['/api/v1/management/what-if/compare']['post']
    operation['requestBody']['content']['application/json']['example'] = sample_request()
    app.openapi_schema = schema
    return app


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(create_demo_app(), host='127.0.0.1', port=8007)
