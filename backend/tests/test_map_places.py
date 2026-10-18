"""Address/name lookup, service-area isolation and authenticated API behavior."""
import json
import unittest
from unittest.mock import AsyncMock

import httpx

from backend.core.config import Settings
from backend.navigation.areas import find_area
from backend.navigation.places import (PlacesRepository, PlacesUnavailable, PlaceSearchResult,
                                       bundled_places, inside, search_catalog)
from backend.tests import test_navigation as navigation_fixtures


class CatalogueTests(unittest.TestCase):
    def test_catalogue_is_real_scoped_unique_and_valid(self):
        rows = bundled_places()
        self.assertGreater(len(rows), 1000)
        self.assertEqual(len(rows), len({row.id for row in rows}))
        for row in rows:
            self.assertTrue(inside(row, find_area(row.area_id)))
            self.assertEqual(row.source, 'openstreetmap')

    def test_search_matches_names_and_housenumber_address(self):
        kl, kajang = find_area('kl-east-pilot'), find_area('kajang-prima-saujana')
        self.assertTrue(any(row.name == 'KL East Mall' for row in search_catalog('kl east mall', kl)))
        self.assertTrue(any('20 Jalan Saujana Mutiara 3' in row.address for row in search_catalog('20 Jalan Saujana Mutiara 3', kajang)))
        self.assertEqual(search_catalog('20 Jalan Saujana Mutiara 3', kl), [])
        self.assertEqual(search_catalog('nonexistent invented place', kl), [])


class RepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_database_receives_user_jwt_and_parameterized_query(self):
        row = search_catalog('KL East Mall', find_area('kl-east-pilot'))[0]
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json=[row.model_dump(mode='json')])
        repository = PlacesRepository(Settings('https://fixture.supabase.co', 'sb_secret_fixture'), transport=httpx.MockTransport(handler))
        try:
            result = await repository.search('resident-token', find_area('kl-east-pilot'), 'KL East Mall')
            self.assertEqual(result.storage, 'database')
            self.assertEqual(result.items[0].id, row.id)
            self.assertEqual(calls[0].headers['authorization'], 'Bearer resident-token')
            self.assertEqual(json.loads(calls[0].content), {'p_area_id': 'kl-east-pilot', 'p_query': 'KL East Mall', 'p_limit': 8})
        finally:
            await repository.close()

    async def test_only_missing_migration_uses_bundled_catalogue(self):
        for status, payload, fallback in [(404, {'code': 'PGRST202'}, True), (401, {}, False),
                                         (500, {}, False), (200, {}, False), (404, {}, False)]:
            repository = PlacesRepository(Settings('https://fixture.supabase.co', 'sb_secret_fixture'),
                transport=httpx.MockTransport(lambda request: httpx.Response(status, json=payload)))
            try:
                if fallback:
                    result = await repository.search('t', find_area('kl-east-pilot'), 'KL East Mall')
                    self.assertEqual(result.storage, 'bundled_catalog')
                    self.assertTrue(result.items)
                else:
                    with self.assertRaises(PlacesUnavailable):
                        await repository.search('t', find_area('kl-east-pilot'), 'KL East Mall')
            finally:
                await repository.close()

    async def test_rejects_database_results_outside_area(self):
        row = search_catalog('20 Jalan Saujana Mutiara 3', find_area('kajang-prima-saujana'))[0]
        repository = PlacesRepository(Settings('https://fixture.supabase.co', 'sb_secret_fixture'),
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[row.model_dump(mode='json')])))
        try:
            with self.assertRaises(PlacesUnavailable):
                await repository.search('t', find_area('kl-east-pilot'), 'Mall')
        finally:
            await repository.close()


class PlacesApiTests(unittest.TestCase):
    def setUp(self):
        fixture = navigation_fixtures.NavigationTests()
        fixture.setUp()
        self.fixture = fixture
        self.addCleanup(fixture.doCleanups)
        self.client = fixture.client()
        self.repository = self.client.app.state.places
        self.repository.search = AsyncMock(return_value=PlaceSearchResult(area_id='kl-east-pilot',
            items=search_catalog('KL East Mall', find_area('kl-east-pilot')), storage='database'))
        self.headers = {'Authorization': 'Bearer fixture-resident'}
        self.path = '/api/v1/navigation/areas/kl-east-pilot/places'

    def test_search_requires_active_resident_and_valid_query(self):
        self.assertEqual(self.client.get(self.path, params={'q': 'mall'}).status_code, 401)
        self.fixture.rows = []
        self.assertEqual(self.client.get(self.path, params={'q': 'mall'}, headers=self.headers).status_code, 403)
        self.repository.search.assert_not_called()

    def test_search_carries_numeric_coordinates_and_private_cache_control(self):
        response = self.client.get(self.path, params={'q': ' KL East Mall '}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'private, no-store')
        self.assertGreater(response.json()['items'][0]['longitude'], 101)
        self.repository.search.assert_awaited_once()
        self.assertEqual(self.repository.search.call_args.args[-1], 'KL East Mall')

    def test_bad_query_unknown_area_and_failure_are_explicit(self):
        for query in ('a', '  ', 'a' * 161):
            self.assertEqual(self.client.get(self.path, params={'q': query}, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.get('/api/v1/navigation/areas/unknown-area/places', params={'q': 'mall'}, headers=self.headers).status_code, 404)
        self.repository.search.side_effect = PlacesUnavailable()
        self.assertEqual(self.client.get(self.path, params={'q': 'mall'}, headers=self.headers).status_code, 503)
