"""Area discovery, route-scope compatibility and server-owned demo snapshots."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

from pydantic import ValidationError
from backend.navigation.areas import ServiceAreas, demo_area_dataset, find_area, service_areas
from backend.navigation.config import PILOT_BBOX
from backend.tests import test_navigation as navigation_fixtures


class ServiceAreasTests(unittest.TestCase):
    def setUp(self):
        self.fixture = navigation_fixtures.NavigationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.client = self.fixture.client()
        self.headers = {'Authorization': 'Bearer fixture-resident'}

    def test_catalog_returns_independent_areas_and_preserves_default(self):
        response = self.client.get('/api/v1/navigation/areas', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'private, no-store')
        data = response.json()
        self.assertEqual(data['default_area_id'], 'kl-east-pilot')
        areas = {row['id']: row for row in data['items']}
        self.assertEqual(set(areas), {'kl-east-pilot', 'kajang-prima-saujana'})
        self.assertEqual(areas['kl-east-pilot']['bbox'], list(PILOT_BBOX))
        self.assertTrue(areas['kajang-prima-saujana']['resident_demo_supported'])
        self.assertTrue(areas['kajang-prima-saujana']['routing_supported'])
        self.assertTrue(areas['kajang-prima-saujana']['temporary_live'])
        for area in areas.values():
            west, south, east, north = area['bbox']
            self.assertFalse(west <= 101.77 <= east and south <= 3.11 <= north)
            self.assertFalse(area['official_boundary'])
            self.assertFalse(area['field_verified'])
        self.assertEqual(self.fixture.requests, [])

    def test_existing_single_area_endpoint_is_unchanged(self):
        response = self.client.get('/api/v1/navigation/area', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], 'kl-east-pilot')
        self.assertEqual(response.json()['bbox'], list(PILOT_BBOX))

    def test_both_catalog_and_dataset_require_valid_resident_credentials(self):
        for path in ['/api/v1/navigation/areas', '/api/v1/navigation/areas/kajang-prima-saujana/demo']:
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path, headers={'Authorization': 'Bearer wrong'}).status_code, 401)
            self.fixture.rows = []
            self.assertEqual(self.client.get(path, headers=self.headers).status_code, 403)
            self.fixture.rows = [{'profile_id': '00000000-0000-4000-8000-000000000001', 'status': 'active', 'verified_at': '2026-10-16T00:00:00Z'}]
            # Restore the exact fixture identity for the next iteration.
            from backend.navigation.demo import RESIDENT
            self.fixture.rows[0]['profile_id'] = RESIDENT

    def test_real_kajang_graph_is_served_with_matching_area_and_attribution(self):
        response = self.client.get('/api/v1/navigation/areas/kajang-prima-saujana/demo', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['area_id'], 'kajang-prima-saujana')
        graph = data['dataset']
        self.assertEqual(graph['bbox'], list(find_area(data['area_id']).bbox))
        self.assertEqual(len(graph['nodes']), 1203)
        self.assertEqual(len(graph['edges']), 1460)
        self.assertEqual(len(graph['landmarks']), 40)
        self.assertEqual(graph['facilities'], [])
        self.assertEqual(graph['provenance']['geometrySource'], 'OpenStreetMap')
        self.assertEqual(graph['provenance']['license'], 'ODbL-1.0')
        self.assertNotIn('originId', graph)
        self.assertNotIn('destinationId', graph)
        self.assertEqual(self.fixture.requests, [])

    def test_legacy_kl_east_graph_is_not_modified(self):
        response = self.client.get('/api/v1/navigation/areas/kl-east-pilot/demo', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        root = Path(__file__).resolve().parents[2]
        original = json.loads((root / 'frontend/enclave-mobile/src/demo/kl-east-demo.json').read_text(encoding='utf-8'))
        self.assertEqual(response.json()['dataset'], original)

    def test_unknown_area_or_path_cannot_read_arbitrary_files(self):
        self.assertEqual(self.client.get('/api/v1/navigation/areas/unknown-area/demo', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/navigation/areas/UPPERCASE/demo', headers=self.headers).status_code, 422)
        with self.assertRaises(ValueError):
            demo_area_dataset('../service_areas')

    def test_separate_live_regions_do_not_enable_inter_region_routes(self):
        self.fixture.body['origin'] = {'latitude': 3.225, 'longitude': 101.730}
        self.fixture.body['destination'] = {'latitude': 3.009, 'longitude': 101.805}
        self.assertEqual(self.fixture.request(self.client).status_code, 422)
        self.assertEqual(self.fixture.requests, [])

    def test_invalid_bounds_duplicate_ids_and_missing_default_rejected(self):
        original = service_areas().model_dump()
        for change in ['bounds', 'center', 'duplicate', 'default', 'nonfinite']:
            data = deepcopy(original)
            if change == 'bounds': data['items'][1]['bbox'] = [101.8, 3.0, 101.7, 3.1]
            elif change == 'center': data['items'][1]['center'] = [101.0, 2.0]
            elif change == 'duplicate': data['items'][1]['id'] = data['items'][0]['id']
            elif change == 'default': data['default_area_id'] = 'missing'
            else: data['items'][1]['bbox'] = [float('nan'), 3.0, 101.8, 3.1]
            with self.subTest(change=change), self.assertRaises(ValidationError):
                ServiceAreas.model_validate(data)

    def test_kajang_snapshot_is_reproducible_from_actual_osm_source(self):
        backend = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location('demo_builder', backend / 'tools/build_resident_demo.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        folder = backend / 'data/demo_areas'
        area = find_area('kajang-prima-saujana').model_dump(mode='json')
        metadata = json.loads((folder / 'kajang-prima-saujana-source.json').read_text())
        rebuilt = builder.build(folder / 'kajang-prima-saujana.osm', area, metadata)
        self.assertEqual(rebuilt, demo_area_dataset(area['id']).dataset)
