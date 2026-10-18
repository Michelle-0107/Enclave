"""Repair comparison authorization, frozen plans, real routing validation, and metrics."""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import unittest
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
import httpx

from backend.app import AuthenticatedUser, bearer, create_app, current_user
from backend.core.config import Settings
from backend.navigation.accessibility import VerifiedNetwork
from backend.navigation.demo import encode_polyline6
from backend.navigation.service import distance_meters
from backend.navigation.config import NavigationSettings
from backend.navigation.zones import zone_bounds, route_intersects_zone
from backend.what_if.contracts import CompareRequest
from backend.what_if.repository import Snapshot, WhatIfRejected
from backend.what_if.demo import create_demo_app, sample_request
from backend.what_if.service import WhatIfService
from backend.tests.test_accessibility import document

MANAGER = '00000000-0000-4000-8000-000000000003'
RESIDENT = '00000000-0000-4000-8000-000000000001'
F1 = '10000000-0000-4000-8000-000000000001'
F2 = '10000000-0000-4000-8000-000000000002'
I1 = '20000000-0000-4000-8000-000000000001'
I2 = '20000000-0000-4000-8000-000000000002'
A, B, C, D = (101.7304, 3.2254), (101.7304, 3.2256), (101.7308, 3.2256), (101.7308, 3.2254)


def issue(**changes):
    return {'id': I1, 'facility_id': F1, 'facility_name': 'Synthetic walkway', 'facility_type': 'path_surface',
            'latitude': 3.2254, 'longitude': 101.7306, 'fault_kind': 'damage', 'status': 'open',
            'reporter_count': 2, 'affects_routes': True, 'created_at': '2026-10-16T00:00:00Z',
            'resolved_at': None, **changes}


def body():
    return {'paths': [{'id': 'main-path', 'name': 'Management-designated journey',
                       'origin': {'latitude': A[1], 'longitude': A[0]},
                       'destination': {'latitude': D[1], 'longitude': D[0]}}],
            'plans': [{'id': 'repair-one', 'name': 'Repair walkway',
                       'repairs': [{'facility_id': F1, 'estimated_cost_myr': '1200.00'}]}],
            'route_modes': ['avoid_damage'], 'budget_myr': '1500.00'}


def directions(points):
    lengths = [distance_meters(a, b) / 1000 for a, b in zip(points, points[1:])]
    steps = [{'type': 1 if index == 0 else 8, 'instruction': 'Synthetic route instruction',
              'length': length, 'time': length * 1000 / 1.4, 'begin_shape_index': index,
              'end_shape_index': index + 1} for index, length in enumerate(lengths)]
    steps.append({'type': 4, 'instruction': 'Arrive', 'length': 0, 'time': 0,
                  'begin_shape_index': len(points) - 1, 'end_shape_index': len(points) - 1})
    return {'trip': {'status': 0, 'units': 'kilometers', 'language': 'en-US', 'legs': [{
        'shape': encode_polyline6(points), 'summary': {'length': sum(lengths), 'time': sum(lengths) * 1000 / 1.4},
        'maneuvers': steps}]}}


class WhatIfTests(unittest.TestCase):
    def setUp(self):
        self.issues = [issue()]
        self.rpc_requests, self.engine_requests = [], []
        self.no_detour = False
        self.provider_failure = False
        self.engine_override = None
        self.snapshot_override = None

    def client(self, *, network=None, rpc_handler=None):
        def no_call(request):
            raise AssertionError('Comparison must not call Auth, residents, reports, community writes, email, or AWS')
        def snapshot(request):
            self.rpc_requests.append(request)
            self.assertEqual(request.url.path, '/rest/v1/rpc/enclave_what_if_snapshot')
            args = json.loads(request.content)
            self.assertEqual(set(args), {'p_actor_id'})
            if args['p_actor_id'] != MANAGER:
                return httpx.Response(200, json={'state': 'forbidden'})
            if self.snapshot_override is not None:
                return httpx.Response(200, json=self.snapshot_override)
            return httpx.Response(200, json={'state': 'ok', 'checked_at': datetime.now(timezone.utc).isoformat(),
                                            'issues': deepcopy(self.issues)})
        def engine(request):
            self.engine_requests.append(request)
            data = json.loads(request.content)
            self.assertNotIn('authorization', request.headers)
            self.assertNotIn(MANAGER, request.content.decode())
            if self.provider_failure:
                return httpx.Response(503, json={'secret': 'private-provider-fixture'})
            if self.engine_override is not None:
                return self.engine_override(data)
            squares = [(ring[0][0], ring[0][1], ring[2][0], ring[2][1]) for ring in data.get('exclude_polygons', [])]
            blocked = any(route_intersects_zone([A, D], bounds) for bounds in squares)
            if blocked and self.no_detour:
                return httpx.Response(400, json={'error_code': 442})
            return httpx.Response(200, json=directions([A, B, C, D] if blocked else [A, D]))
        app = create_app(Settings('https://exampleproject.supabase.co', 'sb_secret_what_if_tests_fixture'),
            auth_transport=httpx.MockTransport(no_call), residents_transport=httpx.MockTransport(no_call),
            reports_transport=httpx.MockTransport(no_call), community_transport=httpx.MockTransport(no_call),
            workflow_transport=httpx.MockTransport(no_call), what_if_transport=httpx.MockTransport(rpc_handler or snapshot),
            navigation_transport=httpx.MockTransport(engine),
            navigation_settings=NavigationSettings(crossing_policy='provider_default'), accessibility_network=network)
        def user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
            tokens = {'manager-fixture': MANAGER, 'resident-fixture': RESIDENT}
            actor = tokens.get(credentials.credentials) if credentials else None
            if actor is None:
                raise HTTPException(401, 'Invalid credentials')
            return AuthenticatedUser(UUID(actor), 'synthetic@example.com', credentials.credentials)
        app.dependency_overrides[current_user] = user
        client = TestClient(app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def compare(self, client, payload=None, token='manager-fixture'):
        return client.post('/api/v1/management/what-if/compare', json=payload or body(),
                           headers={'Authorization': 'Bearer ' + token})

    def test_authentication_and_trusted_role_before_engine_and_no_resident_binding(self):
        client = self.client()
        self.assertEqual(client.post('/api/v1/management/what-if/compare', json=body()).status_code, 401)
        self.assertEqual(self.rpc_requests, [])
        self.assertEqual(self.compare(client, token='resident-fixture').status_code, 403)
        self.assertEqual(self.engine_requests, [])
        self.assertEqual(self.compare(client).status_code, 200)

    def test_candidates_private_projection_and_no_write_or_service_key_leak(self):
        self.issues[0].update(private_note='PRIVATE', user_id=RESIDENT)
        response = self.client().get('/api/v1/management/what-if/candidates', headers={'Authorization': 'Bearer manager-fixture'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['issues'][0]['facility_id'], F1)
        self.assertNotIn('PRIVATE', response.text)
        self.assertNotIn(RESIDENT, response.text)
        self.assertIn('no-store', response.headers['cache-control'])
        self.assertEqual(self.engine_requests, [])

    def test_repair_shortens_real_validated_geometry_and_counts_one_designated_path(self):
        original = deepcopy(self.issues)
        response = self.compare(self.client())
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json(); plan = data['plans'][0]; impact = plan['paths'][0]
        self.assertEqual(plan['affected_major_path_count'], 1)
        self.assertEqual(plan['improved_major_path_count'], 1)
        self.assertEqual(impact['effect'], 'shortened')
        self.assertGreater(impact['distance_saved_meters'], 40)
        self.assertEqual(plan['total_estimated_cost_myr'], '1200.00')
        self.assertEqual(plan['budget_status'], 'within_budget')
        self.assertTrue(data['simulation_only'])
        self.assertEqual(self.issues, original)
        self.assertEqual(len(self.rpc_requests), 1)
        self.assertEqual(len(self.engine_requests), 2)  # Healthy reference reused after repair.
        self.assertIsNone(impact['after']['geometry'])
        self.assertIn('no-store', response.headers['cache-control'])

    def test_no_route_becomes_restored_without_invented_distance_saving(self):
        self.no_detour = True
        data = self.compare(self.client()).json(); plan = data['plans'][0]
        self.assertEqual(plan['paths'][0]['effect'], 'restored')
        self.assertIsNone(plan['paths'][0]['distance_saved_meters'])
        self.assertEqual(plan['summaries'][0]['restored_path_count'], 1)
        self.assertEqual(plan['summaries'][0]['distance_saved_on_comparable_paths_meters'], 0)

    def test_blocked_endpoint_can_be_restored(self):
        self.issues[0].update(latitude=A[1], longitude=A[0])
        data = self.compare(self.client()).json()
        self.assertEqual(data['baseline'][0]['current']['reason'], 'blocked_endpoint')
        self.assertEqual(data['plans'][0]['paths'][0]['effect'], 'restored')

    def test_plans_are_independent_and_unselected_overlapping_obstacles_remain(self):
        self.issues.append(issue(id=I2, facility_id=F2, facility_name='Second damaged asset'))
        payload = body()
        payload['plans'].append({'id': 'repair-both', 'name': 'Repair both', 'repairs': [
            {'facility_id': F1, 'estimated_cost_myr': '1200.00'}, {'facility_id': F2, 'estimated_cost_myr': '500.00'}]})
        data = self.compare(self.client(), payload).json()
        first, both = data['plans']
        self.assertEqual(first['remaining_road_obstacle_count'], 1)
        self.assertEqual(first['affected_major_path_count'], 1)
        self.assertEqual(first['improved_major_path_count'], 0)
        self.assertEqual(both['remaining_road_obstacle_count'], 0)
        self.assertEqual(both['improved_major_path_count'], 1)
        self.assertEqual(both['budget_status'], 'over_budget')
        self.assertEqual(len(self.rpc_requests), 1)
        self.assertEqual(len(self.issues), 2)

    def test_one_cost_repairs_all_open_incidents_at_the_selected_facility(self):
        self.issues.append(issue(id=I2, fault_kind='obstruction'))
        plan = self.compare(self.client()).json()['plans'][0]
        self.assertEqual(plan['repaired_issue_count'], 2)
        self.assertEqual(plan['total_estimated_cost_myr'], '1200.00')
        self.assertEqual(len(plan['facility_impacts'][0]['repaired_issue_ids']), 2)

    def test_unknown_cost_is_not_zero_or_falsely_within_budget(self):
        payload = body(); del payload['plans'][0]['repairs'][0]['estimated_cost_myr']
        plan = self.compare(self.client(), payload).json()['plans'][0]
        self.assertIsNone(plan['total_estimated_cost_myr'])
        self.assertEqual(plan['known_estimated_subtotal_myr'], '0.00')
        self.assertEqual(plan['missing_cost_facility_ids'], [F1])
        self.assertEqual(plan['budget_status'], 'unknown_cost')

    def test_decimal_costs_are_exact_and_budget_optional(self):
        self.issues.append(issue(id=I2, facility_id=F2, facility_name='Second damaged asset'))
        payload = body(); payload.pop('budget_myr')
        payload['plans'][0]['repairs'] = [{'facility_id': F1, 'estimated_cost_myr': '0.10'},
                                         {'facility_id': F2, 'estimated_cost_myr': '0.20'}]
        plan = self.compare(self.client(), payload).json()['plans'][0]
        self.assertEqual(plan['total_estimated_cost_myr'], '0.30')
        self.assertEqual(plan['budget_status'], 'not_set')

    def test_bench_repair_does_not_create_route_benefits(self):
        self.issues[0].update(facility_type='bench', affects_routes=False)
        data = self.compare(self.client()).json(); plan = data['plans'][0]
        self.assertEqual(data['baseline_road_obstacle_count'], 0)
        self.assertEqual(plan['affected_major_path_count'], 0)
        self.assertEqual(plan['improved_major_path_count'], 0)
        self.assertEqual(plan['paths'][0]['effect'], 'unchanged')
        self.assertEqual(len(self.engine_requests), 1)

    def test_real_accessibility_coverage_missing_is_not_assessable_not_restored(self):
        payload = body(); payload['route_modes'] = ['avoid_damage', 'accessible']
        data = self.compare(self.client(), payload).json(); plan = data['plans'][0]
        access = next(s for s in plan['summaries'] if s['route_mode'] == 'accessible')
        self.assertEqual(access['not_assessable_path_count'], 1)
        self.assertEqual(access['restored_path_count'], 0)
        self.assertEqual(access['reference_assessable_path_count'], 0)
        self.assertEqual(plan['paths'][1]['after']['state'], 'not_assessable')

    def test_surveyed_accessible_path_restored_without_using_stairs(self):
        self.issues[0].update(latitude=3.2256, longitude=101.7306)
        payload = body(); payload['route_modes'] = ['accessible']; payload['include_geometry'] = True
        data = self.compare(self.client(network=VerifiedNetwork(document=document())), payload).json()
        row = data['plans'][0]['paths'][0]
        self.assertEqual(row['effect'], 'restored')
        self.assertEqual(len(row['after']['geometry']['coordinates']), 4)
        self.assertFalse(row['after']['field_verified'])
        self.assertIsNone(row['after']['fallback'])
        reference = data['baseline'][0]['current']['fallback']
        self.assertEqual(reference['route_mode'], 'avoid_damage')
        self.assertFalse(reference['accessibility_verified'])
        self.assertEqual(len(self.engine_requests), 2)  # Walking reference for the unavailable before case.

    def test_same_path_is_not_double_counted_across_modes(self):
        payload = body(); payload['route_modes'] = ['avoid_damage', 'accessible']
        data = self.compare(self.client(network=VerifiedNetwork(document=document())), payload).json()
        plan = data['plans'][0]
        self.assertEqual(plan['affected_major_path_count'], 1)
        self.assertEqual(plan['improved_major_path_count'], 1)
        self.assertEqual(len(plan['summaries']), 2)

    def test_survey_assessment_time_can_be_frozen_without_changing_normal_navigation(self):
        graph = document(); now = datetime.now(timezone.utc)
        for edge in graph['edges']:
            edge['valid_until'] = (now - timedelta(seconds=1)).isoformat()
        self.assertFalse(VerifiedNetwork(document=graph).coverage()['accessible_network_available'])
        self.assertTrue(VerifiedNetwork(document=graph, assessment_time=now - timedelta(minutes=1)).coverage()['accessible_network_available'])

    def test_bad_or_stale_repair_id_is_conflict_before_engine(self):
        payload = body(); payload['plans'][0]['repairs'][0]['facility_id'] = F2
        self.assertEqual(self.compare(self.client(), payload).status_code, 409)
        self.assertEqual(self.engine_requests, [])

    def test_provider_failure_is_503_not_a_restoration_or_secret_leak(self):
        self.provider_failure = True
        response = self.compare(self.client())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-provider-fixture', response.text)

    def test_snapshot_failure_overflow_stale_and_malformed_data_fail_closed(self):
        now = datetime.now(timezone.utc).isoformat()
        cases = [{'state': 'too_many'}, {'state': 'ok', 'checked_at': now, 'issues': [issue(reporter_count=1)]},
                 {'state': 'ok', 'checked_at': now, 'issues': [issue(), issue()]},
                 {'state': 'ok', 'checked_at': now, 'issues': [issue(status='resolved')]},
                 {'state': 'ok', 'checked_at': '2020-01-01T00:00:00Z', 'issues': []},
                 {'state': 'ok', 'checked_at': now, 'issues': [issue(), issue(id=I2, fault_kind='obstruction', facility_name='Wrong name')]},
                 {'state': 'ok', 'checked_at': now, 'issues': []}]
        client = self.client()
        for data in cases:
            self.snapshot_override = data
            expected = 409 if data.get('issues') == [] and data.get('checked_at') == now else 503
            self.assertEqual(self.compare(client).status_code, expected)
        self.assertEqual(self.engine_requests, [])

    def test_request_limits_unknown_fields_and_boolean_money_rejected(self):
        client = self.client()
        cases = []
        for value in [True, '-1', '0.001', 'NaN', 'Infinity']:
            payload = body(); payload['budget_myr'] = value; cases.append(payload)
        payload = body(); payload['plans'][0]['repairs'] *= 2; cases.append(payload)
        payload = body(); payload['paths'] *= 2; cases.append(payload)
        payload = body(); payload['route_modes'] = ['shortest']; cases.append(payload)
        payload = body(); payload['role'] = 'management'; cases.append(payload)
        payload = body(); payload['paths'][0]['origin']['latitude'] = 3.139; cases.append(payload)
        payload = body(); payload['include_geometry'] = 'true'; cases.append(payload)
        for payload in cases:
            response = self.compare(client, payload)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertNotIn('"input"', response.text)
        self.assertEqual(self.rpc_requests, [])

    def test_geometry_is_optional_and_snapshot_time_shared(self):
        payload = body(); payload['include_geometry'] = True
        data = self.compare(self.client(), payload).json()
        self.assertEqual(len(data['plans'][0]['paths'][0]['after']['geometry']['coordinates']), 2)
        self.assertIsNotNone(data['baseline'][0]['current']['geometry'])
        self.assertEqual(len(self.rpc_requests), 1)

    def test_longer_recomputed_route_reuses_the_real_feasible_before_geometry(self):
        longer = [A, (A[0], A[1] + 0.0004), (D[0], D[1] + 0.0004), D]
        self.engine_override = lambda data: httpx.Response(200, json=directions(
            [A, B, C, D] if data.get('exclude_polygons') else longer))
        payload = body(); payload['include_geometry'] = True
        data = self.compare(self.client(), payload).json()
        before = data['baseline'][0]['current']
        after = data['plans'][0]['paths'][0]
        self.assertEqual(after['effect'], 'unchanged')
        self.assertEqual(after['distance_saved_meters'], 0)
        self.assertEqual(after['after']['distance_meters'], before['distance_meters'])
        self.assertEqual(after['after']['geometry'], before['geometry'])
        self.assertEqual(len(after['after']['geometry']['coordinates']), 4)

    def test_more_repairs_cannot_discard_a_shorter_valid_route_from_another_plan(self):
        self.issues.append(issue(id=I2, facility_id=F2, latitude=3.2251, facility_name='South fixture'))
        longer = [A, (A[0], A[1] + 0.0004), (D[0], D[1] + 0.0004), D]
        def provider(data):
            count = len(data.get('exclude_polygons', []))
            return httpx.Response(200, json=directions([A, B, C, D] if count == 2 else [A, D] if count == 1 else longer))
        self.engine_override = provider
        payload=body(); payload['include_geometry']=True
        payload['plans'].append({'id':'both','name':'Repair both','repairs':[{'facility_id':F1},{'facility_id':F2}]})
        data=self.compare(self.client(),payload).json()
        one,two=(plan['paths'][0] for plan in data['plans'])
        self.assertGreater(one['distance_saved_meters'],0)
        self.assertEqual(two['after']['geometry'],one['after']['geometry'])
        self.assertLessEqual(two['after']['distance_meters'],one['after']['distance_meters'])

    def test_shorter_candidate_crossing_unrepaired_damage_is_never_reused(self):
        self.issues.append(issue(id=I2, facility_id=F2, facility_name='Overlapping fixture'))
        payload=body(); payload['include_geometry']=True
        payload['plans'].append({'id':'both','name':'Repair both','repairs':[{'facility_id':F1},{'facility_id':F2}]})
        data=self.compare(self.client(),payload).json()
        unrepaired,repaired=(plan['paths'][0]['after'] for plan in data['plans'])
        box=zone_bounds(self.issues[1]['latitude'],self.issues[1]['longitude'],5)
        self.assertFalse(route_intersects_zone(unrepaired['geometry']['coordinates'],box))
        self.assertTrue(route_intersects_zone(repaired['geometry']['coordinates'],box))
        self.assertGreater(unrepaired['distance_meters'],repaired['distance_meters'])

    def test_accessible_only_returns_walking_reference_without_claiming_accessibility(self):
        payload=body();payload['route_modes']=['accessible'];payload['include_geometry']=True
        data=self.compare(self.client(),payload).json()
        self.assertEqual(len(data['baseline']),1)
        plan=data['plans'][0]; row=plan['paths'][0]
        self.assertEqual(row['after']['state'],'not_assessable')
        self.assertEqual(row['effect'],'not_assessable')
        self.assertIsNone(row['distance_saved_meters'])
        for outcome in (data['baseline'][0]['current'],row['after']):
            self.assertEqual(outcome['fallback']['route_mode'],'avoid_damage')
            self.assertTrue(outcome['fallback']['reference_only'])
            self.assertFalse(outcome['fallback']['accessibility_verified'])
            self.assertIsNotNone(outcome['fallback']['geometry'])
        self.assertEqual(plan['summaries'][0]['after_available_path_count'],0)
        self.assertEqual(plan['improved_major_path_count'],0)

    def test_fixed_reference_endpoints_are_used_for_every_comparison(self):
        data = self.compare(self.client(), body()).json()
        baseline = data['baseline'][0]
        self.assertEqual(baseline['comparison_origin'], {'longitude': A[0], 'latitude': A[1]})
        self.assertEqual(baseline['comparison_destination'], {'longitude': D[0], 'latitude': D[1]})
        for request in self.engine_requests:
            locations = json.loads(request.content)['locations']
            self.assertTrue(all(i['radius'] == 0 and i['node_snap_tolerance'] == 0 for i in locations))
            self.assertEqual([(i['lon'],i['lat']) for i in locations], [A,D])

    def test_endpoint_drift_is_not_claimed_as_a_restored_route(self):
        shifted = (D[0]+0.00004,D[1])
        self.engine_override = lambda data: httpx.Response(200,json=directions(
            [A,B,C,shifted] if data.get('exclude_polygons') else [A,D]))
        result = self.compare(self.client(),body()).json()
        self.assertEqual(result['baseline'][0]['current']['state'], 'not_assessable')
        self.assertEqual(result['baseline'][0]['current']['reason'], 'comparison_endpoint_changed')
        self.assertEqual(result['plans'][0]['paths'][0]['effect'], 'not_assessable')
        self.assertEqual(result['plans'][0]['summaries'][0]['restored_path_count'], 0)

    def test_unchanged_has_an_explanation_and_exact_displayed_restrictions(self):
        self.issues[0]['latitude'] = 3.2251
        data = self.compare(self.client(),body()).json()
        restriction = data['routing_restrictions'][0]
        self.assertEqual(restriction['binding_source'], 'point_only')
        self.assertEqual(restriction['facility_id'], F1)
        self.assertEqual(len(restriction['exclusion_rings']), 1)
        row = data['plans'][0]['paths'][0]
        self.assertEqual(row['effect'], 'unchanged')
        self.assertIn('do not intersect', row['explanation'])

    def test_demo_exposes_only_safe_synthetic_endpoints_and_complete_swagger_example(self):
        demo = create_demo_app(navigation_transport=httpx.MockTransport(lambda r: httpx.Response(200, json=directions([A, D]))))
        schema = demo.openapi()
        self.assertNotIn('/api/v1/notifications', schema['paths'])
        example = schema['paths']['/api/v1/management/what-if/compare']['post']['requestBody']['content']['application/json']['example']
        self.assertEqual(example, sample_request())
        CompareRequest.model_validate(example)


class WhatIfCapacityTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_comparison_is_bounded_and_timeout_releases_slot(self):
        class Repo:
            async def snapshot(self, actor):
                return Snapshot(checked_at=datetime.now(timezone.utc), issues=[])
        service = WhatIfService(Repo(), None, timeout_seconds=0.01)
        with self.assertRaises(WhatIfRejected) as rejection:
            async with service._comparison_slot:
                await service.compare(UUID(MANAGER), CompareRequest.model_validate(body()))
        self.assertEqual(rejection.exception.status, 429)
        async def slow(snapshot, request):
            await asyncio.sleep(1)
        service._compare_snapshot = slow
        from backend.what_if.repository import WhatIfUnavailable
        with self.assertRaises(WhatIfUnavailable):
            await service.compare(UUID(MANAGER), CompareRequest.model_validate(body()))
        self.assertFalse(service._comparison_slot.locked())


if __name__ == '__main__':
    unittest.main()
