"""Actual-coordinate comparison, damage isolation and live/verified-mode boundaries."""
import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import unittest

from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.demo_accessibility import shared_demo_walking_graph
from backend.navigation.service import distance_meters
from backend.navigation.zones import route_intersects_zone
from backend.reports.issues import CommunityObstacleSnapshot
from backend.tests import test_what_if as fixtures


class SharedSimulationTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WhatIfTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        places = {p['id']: p for p in json.loads((Path(__file__).resolve().parents[1] / 'data/map_places.json').read_text(encoding='utf-8'))}
        self.ids = ['ed7b553f-63c5-5b4f-98d9-292013005bf0', 'a061972e-2398-5cdc-91ed-7769edbb5dd2']
        self.case.issues = [fixtures.issue(id=fixtures.I2 if i else fixtures.I1, facility_id=ident,
            facility_name=places[ident]['name'], latitude=places[ident]['latitude'], longitude=places[ident]['longitude'])
            for i, ident in enumerate(self.ids)]
        self.client = self.case.client()
        self.client.app.state.navigation.provider.settings = replace(
            self.client.app.state.navigation.provider.settings, crossing_policy='mapped_facilities_only')
        self.payload = fixtures.body()
        self.payload['include_geometry'] = True
        self.payload['plans'][0]['repairs'] = [{'facility_id': self.ids[0]}]
        self.payload['paths'][0].update(origin={'latitude': 3.219856, 'longitude': 101.723293},
            destination={'latitude': 3.221590, 'longitude': 101.725294})

    def compare(self):
        response = self.case.compare(self.client, self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(self.case.engine_requests)
        return response.json()

    def assert_avoids(self, outcome, restrictions):
        self.assertEqual(outcome['state'], 'available')
        coordinates = outcome['geometry']['coordinates']
        length = sum(distance_meters(a, b) for a, b in zip(coordinates, coordinates[1:]))
        self.assertAlmostEqual(length, outcome['distance_meters'], delta=0.1)
        for restriction in restrictions:
            for ring in restriction['exclusion_rings']:
                self.assertFalse(route_intersects_zone(coordinates, (ring[0][0], ring[0][1], ring[2][0], ring[2][1])))

    def test_exact_reported_journey_shares_registered_facilities_without_inventing_repair_benefit(self):
        data = self.compare()
        before = data['baseline'][0]
        impact = data['plans'][0]['paths'][0]
        self.assertEqual(before['requested_origin'], self.payload['paths'][0]['origin'])
        self.assertEqual(before['requested_destination'], self.payload['paths'][0]['destination'])
        for result in (before['current'], impact['after']):
            self.assertGreater(result['distance_meters'], 400)
            self.assertLess(result['distance_meters'], 600)
            self.assertFalse(result['field_verified'])
        self.assert_avoids(before['current'], data['routing_restrictions'])
        remaining = [r for r in data['routing_restrictions'] if r['facility_id'] != self.ids[0]]
        self.assert_avoids(impact['after'], remaining)
        self.assertEqual(impact['effect'], 'unchanged')
        self.assertFalse(impact['reference_intersects_selected_repairs'])
        self.assertEqual(impact['distance_saved_meters'], 0)
        for key, index in (('comparison_origin', 0), ('comparison_destination', -1)):
            anchor = before[key]
            point = (anchor['longitude'], anchor['latitude'])
            for result in (before['current'], impact['after']):
                self.assertLessEqual(distance_meters(point, result['geometry']['coordinates'][index]), 1)
        self.assertTrue(any('hypothetical crossings' in warning for warning in data['warnings']))

    def test_repair_of_a_traversed_section_shortens_route_and_preserves_other_damage(self):
        self.payload['paths'][0].update(origin={'latitude': 3.2197845, 'longitude': 101.7235966},
            destination={'latitude': 3.2216591, 'longitude': 101.7263737})
        data = self.compare()
        before = data['baseline'][0]['current']
        impact = data['plans'][0]['paths'][0]
        self.assert_avoids(before, data['routing_restrictions'])
        self.assert_avoids(impact['after'], [r for r in data['routing_restrictions'] if r['facility_id'] != self.ids[0]])
        self.assertEqual(impact['effect'], 'shortened')
        self.assertGreater(impact['distance_saved_meters'], 100)
        self.assertEqual(data['plans'][0]['remaining_road_obstacle_count'], 1)

    def test_hypothetical_walking_facilities_never_become_verified_accessibility(self):
        self.payload['route_modes'] = ['accessible']
        data = self.compare()
        for result in (data['baseline'][0]['current'], data['plans'][0]['paths'][0]['after']):
            self.assertEqual(result['state'], 'not_assessable')
            self.assertEqual(result['reason'], 'no_verified_accessible_reference')
            fallback = result['fallback']
            self.assertTrue(fallback['reference_only'])
            self.assertFalse(fallback['accessibility_verified'])
            self.assertGreater(fallback['distance_meters'], 400)
            self.assertLess(fallback['distance_meters'], 600)

    def test_simulation_does_not_enable_hypothetical_facilities_in_live_navigation(self):
        self.compare()
        request = WalkingRouteRequest(**{key: self.payload['paths'][0][key] for key in ('origin', 'destination')}, route_mode='avoid_damage')
        snapshot = CommunityObstacleSnapshot(checked_at=datetime.now(timezone.utc), items=[])
        live = asyncio.run(self.client.app.state.navigation.route_with_snapshot(request, snapshot))
        self.assertGreater(live.distance_meters, 3000)
        # The comparison loads a separate cached graph; live is neither mutated
        # nor quietly rerouted over simulated crossings.
        shared = shared_demo_walking_graph('kl-east-pilot').route(request, snapshot, [], 'kl-east-pilot', True, demo_mode=True)
        self.assertLess(shared.distance_meters, 600)
