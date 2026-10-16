"""Container startup/readiness, private HTTP routing and owned server shutdown."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import socket
import unittest
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
import httpx

from backend.app import AuthenticatedUser, bearer, current_user
from backend.core.config import Settings
from backend.navigation.container_app import create_container_app, wait_for_engine, stop_engine
from backend.tests.test_what_if import A, B, C, D, MANAGER, body, directions, issue


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def listening(port):
    with socket.socket() as probe:
        return probe.connect_ex(('127.0.0.1', port)) == 0


class ContainerNavigationTests(unittest.TestCase):
    def make_app(self, *, native=False, engine=None):
        self.port = free_port()
        self.engine_requests = []
        def no_cloud(request):
            raise AssertionError('Container test must not call cloud services')
        def snapshot(request):
            return httpx.Response(200, json={'state': 'ok', 'checked_at': datetime.now(timezone.utc).isoformat(),
                'issues': [issue(latitude=3.22649, longitude=101.730755) if native else issue()]})
        if not native and engine is None:
            engine = FastAPI()
            @engine.post('/route')
            async def route(request: Request):
                self.engine_requests.append(request)
                self.assertNotIn('authorization', request.headers)
                self.assertNotIn('apikey', request.headers)
                payload = await request.json()
                return directions([A, B, C, D] if payload.get('exclude_polygons') else [A, D])
        app = create_container_app(Settings('https://exampleproject.supabase.co', 'sb_secret_container_test_fixture'),
            engine_port=self.port, engine_application=engine,
            auth_transport=httpx.MockTransport(no_cloud), reports_transport=httpx.MockTransport(no_cloud),
            residents_transport=httpx.MockTransport(no_cloud), community_transport=httpx.MockTransport(no_cloud),
            workflow_transport=httpx.MockTransport(no_cloud), what_if_transport=httpx.MockTransport(snapshot))
        def user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
            if credentials is None or credentials.credentials != 'synthetic-manager':
                raise HTTPException(401, 'Invalid credentials')
            return AuthenticatedUser(UUID(MANAGER), 'synthetic@example.com', credentials.credentials)
        app.dependency_overrides[current_user] = user
        return app

    def test_engine_started_before_api_ready_and_real_private_http_comparison_works(self):
        app = self.make_app()
        with TestClient(app) as client:
            self.assertTrue(listening(self.port))
            self.assertEqual(client.get('/health').status_code, 200)
            self.assertEqual(client.get('/route').status_code, 404)
            self.assertEqual(client.get('/api/v1/management/what-if/candidates').status_code, 401)
            response = client.post('/api/v1/management/what-if/compare', json=body(),
                                   headers={'Authorization': 'Bearer synthetic-manager'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['plans'][0]['improved_major_path_count'], 1)
            self.assertEqual(len(self.engine_requests), 2)
            self.assertIn('127.0.0.1', app.state.navigation.provider.settings.provider_url)
            self.assertEqual(app.state.private_engine_server.config.host, '127.0.0.1')
        self.assertFalse(listening(self.port))
        self.assertTrue(app.state.private_engine_task.done())
        self.assertTrue(app.state.what_if_repository.client.is_closed)

    def test_readiness_fails_if_private_engine_stops(self):
        app = self.make_app()
        with TestClient(app) as client:
            app.state.private_engine_server.should_exit = True
            response = client.get('/health')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['dependency'], 'routing_engine')
        self.assertFalse(listening(self.port))

    def test_engine_failure_prevents_false_successful_api_startup(self):
        @asynccontextmanager
        async def failed(app):
            raise RuntimeError('Synthetic missing graph')
            yield
        engine = FastAPI(lifespan=failed)
        app = self.make_app(engine=engine)
        with self.assertRaises(RuntimeError):
            with TestClient(app):
                pass
        self.assertFalse(listening(self.port))

    def test_server_configuration_is_not_a_client_controlled_url(self):
        with self.assertRaises(ValueError):
            create_container_app(engine_port=True)
        with self.assertRaises(ValueError):
            create_container_app(engine_port=65536)
        with self.assertRaises(ValueError):
            create_container_app(navigation_settings=object())

    def test_engine_port_collision_does_not_stop_the_existing_listener(self):
        app = self.make_app()
        with socket.socket() as existing:
            existing.bind(('127.0.0.1', self.port))
            existing.listen()
            with self.assertRaises(RuntimeError):
                with TestClient(app):
                    pass
            self.assertTrue(listening(self.port))

    @unittest.skipUnless((Path(__file__).resolve().parents[1] / 'navigation/.runtime/engine.json').is_file(),
                         'Prepare the optional native road graph first')
    def test_bundled_native_engine_lifespan_starts_and_serves_actual_roads(self):
        app = self.make_app(native=True)
        from backend.what_if.demo import sample_request
        # The native road engine starts as a private server inside the API lifecycle.
        with TestClient(app) as client:
            engine = app.state.private_engine_server.config.app
            self.assertTrue(engine.state.actor)
            response = client.post('/api/v1/management/what-if/compare', json=sample_request(),
                                   headers={'Authorization': 'Bearer synthetic-manager'})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertGreater(result['baseline'][0]['current']['distance_meters'], 400)
            self.assertLess(result['plans'][0]['paths'][0]['after']['distance_meters'], 400)
            self.assertEqual(result['plans'][0]['improved_major_path_count'], 1)
        self.assertFalse(listening(self.port))


class ContainerDeadlineTests(unittest.IsolatedAsyncioTestCase):
    async def test_startup_deadline_and_shutdown_cancel_stuck_owned_task(self):
        class Server:
            started = False
            should_exit = False
            force_exit = False
        server = Server()
        task = asyncio.create_task(asyncio.sleep(20))
        with self.assertRaises(RuntimeError):
            await wait_for_engine(server, task, 0.01)
        await stop_engine(server, task, 0.01)
        self.assertTrue(server.should_exit)
        self.assertTrue(server.force_exit)
        self.assertTrue(task.done())
