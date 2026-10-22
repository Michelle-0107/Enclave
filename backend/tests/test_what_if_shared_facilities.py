"""Actual-coordinate comparison, damage isolation and live/verified-mode boundaries."""
import asyncio
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import unittest
from uuid import uuid4

from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.demo_accessibility import shared_demo_walking_graph
from backend.navigation.service import distance_meters
from backend.navigation.zones import route_intersects_zone
from backend.navigation.facility_segments import restriction_for
from backend.reports.road_sections import catalog
from backend.reports.issues import CommunityObstacleSnapshot
from backend.tests import test_what_if as fixtures
from backend.what_if.candidates import ReviewIssue


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

    def test_maximum_comparison_keeps_all_ten_journeys_and_five_plans_on_the_shared_graph(self):
        path = self.payload['paths'][0]
        plan = self.payload['plans'][0]
        self.payload['paths'] = [dict(deepcopy(path), id=f'journey_{i}', name=f'Journey {i}',
            origin={**path['origin'], 'latitude': path['origin']['latitude'] + i * .0000001}) for i in range(10)]
        choices = [[self.ids[0]], [self.ids[1]], self.ids, [self.ids[0]], [self.ids[1]]]
        self.payload['plans'] = [dict(deepcopy(plan), id=f'plan_{i}', name=f'Plan {i}',
            repairs=[{'facility_id': facility} for facility in repairs]) for i, repairs in enumerate(choices)]
        self.payload['route_modes'] = ['avoid_damage', 'accessible']
        data = self.compare()
        self.assertEqual(len(data['baseline']), 20)
        self.assertEqual(len(data['plans']), 5)
        for row in data['baseline']:
            if row['route_mode'] == 'avoid_damage': self.assertEqual(row['current']['state'], 'available')
        for result in data['plans']:
            self.assertEqual(len(result['paths']), 20)
            self.assertEqual(len({row['path_id'] for row in result['paths']}), 10)
            for row in result['paths']:
                if row['route_mode'] == 'avoid_damage': self.assertEqual(row['after']['state'], 'available')

    def test_multiple_mapped_sections_do_not_count_each_coverage_square_as_a_road(self):
        sections = [point for point in catalog().values() if point.road_section.length_meters >= 95][:6]
        self.assertEqual(len(sections), 6)
        self.case.issues = [fixtures.issue(id=str(uuid4()), facility_id=str(point.id),
            facility_name=point.name, latitude=point.latitude, longitude=point.longitude)
            for point in sections]
        ring_count = sum(len(restriction_for(ReviewIssue.model_validate(item))['exclusion_rings'])
                         for item in self.case.issues)
        self.assertGreater(ring_count, 100)
        self.payload['plans'][0]['repairs'] = [{'facility_id': str(sections[0].id)}]
        data = self.compare()
        self.assertEqual(len(data['routing_restrictions']), 6)
        self.assertEqual(sum(len(item['exclusion_rings']) for item in data['routing_restrictions']), ring_count)
        self.assertEqual(data['baseline_road_obstacle_count'], 6)
        self.assertEqual(data['plans'][0]['remaining_road_obstacle_count'], 5)

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
            self.assertGreater(result['distance_meters'], 290)
            self.assertLess(result['distance_meters'], 350)
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
            self.assertGreater(fallback['distance_meters'], 290)
            self.assertLess(fallback['distance_meters'], 350)

    def test_adjacent_building_boundary_does_not_move_fixed_entrance_or_hide_before_detour(self):
        self.payload['paths'][0].update(origin={'latitude':3.220461, 'longitude':101.723051},
            destination={'latitude':3.220728, 'longitude':101.725674})
        graph = shared_demo_walking_graph('kl-east-pilot')
        selected = (101.725674,3.220728)
        entrance = graph.snap_candidates(selected)[0][3]
        # These adjoining footprints share an entrance boundary. Treating the
        # returned boundary as a new selection associates it with the next home.
        self.assertNotEqual(graph.land_access.buildings_at(selected), graph.land_access.buildings_at(entrance))
        data = self.compare()
        baseline = data['baseline'][0]
        before = baseline['current']
        after = data['plans'][0]['paths'][0]['after']
        self.assert_avoids(before, data['routing_restrictions'])
        self.assert_avoids(after, [r for r in data['routing_restrictions'] if r['facility_id']!=self.ids[0]])
        self.assertGreaterEqual(before['distance_meters'], after['distance_meters'])
        for route in (before, after):
            self.assertLess(distance_meters(route['geometry']['coordinates'][-1], entrance), .01)
            for key,index in (('comparison_origin',0),('comparison_destination',-1)):
                point = baseline[key]
                self.assertLess(distance_meters((point['longitude'],point['latitude']),route['geometry']['coordinates'][index]), 1)

    def test_main_road_repair_restores_direct_corridor_and_side_street_keeps_before_detour(self):
        from backend.reports.road_sections import catalog
        from backend.navigation.road_bindings import distance_to_geometry
        sections = [min([p for p in catalog().values() if p.road_section.osm_way_id==way],
                        key=lambda p:distance_to_geometry(point,p.road_section.geometry))
                    for way,point in (('1163780777',(101.7242,3.2206)), ('39921500',(101.7248,3.2202)))]
        self.case.issues = [fixtures.issue(id=fixtures.I2 if i else fixtures.I1, facility_id=str(p.id),
            facility_name=p.name, latitude=p.latitude, longitude=p.longitude) for i,p in enumerate(sections)]
        selected = str(sections[0].id)
        self.payload['plans'][0]['repairs'] = [{'facility_id':selected}]
        self.payload['paths'].append(dict(id='side-street', name='Side-street journey',
            origin={'latitude':3.220461,'longitude':101.723051},
            destination={'latitude':3.220728,'longitude':101.725674}))
        data = self.compare()
        remaining = [r for r in data['routing_restrictions'] if r['facility_id']!=selected]
        for baseline,impact in zip(data['baseline'],data['plans'][0]['paths']):
            self.assert_avoids(baseline['current'],data['routing_restrictions'])
            self.assert_avoids(impact['after'],remaining)
            self.assertEqual(impact['effect'],'shortened')
            self.assertGreater(baseline['current']['distance_meters'],impact['after']['distance_meters'])
            for key,index in (('comparison_origin',0),('comparison_destination',-1)):
                point = baseline[key]
                for route in (baseline['current'],impact['after']):
                    self.assertLess(distance_meters((point['longitude'],point['latitude']),route['geometry']['coordinates'][index]),1)
        self.assertLess(data['plans'][0]['paths'][0]['after']['distance_meters'],350)

    def test_ordinary_building_access_works_through_the_actual_comparison_endpoint(self):
        places=json.loads((Path(__file__).resolve().parents[1]/'data/map_places.json').read_text(encoding='utf-8'))
        for key,name in (('origin','Decathlon'),('destination','Jaya Grocer')):
            place=next(p for p in places if p['area_id']=='kl-east-pilot' and p['name']==name)
            self.payload['paths'][0][key]={field:place[field] for field in ('latitude','longitude')}
        data=self.compare()
        self.assert_avoids(data['baseline'][0]['current'],data['routing_restrictions'])
        self.assert_avoids(data['plans'][0]['paths'][0]['after'],
            [r for r in data['routing_restrictions'] if r['facility_id']!=self.ids[0]])

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
