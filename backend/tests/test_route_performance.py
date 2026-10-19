"""Preserve exact routing rules while bounding repeated spatial work."""

from collections import Counter
import random
import unittest
from unittest.mock import patch

from backend.navigation.demo_routes import DemoRouteRequest, calculate_demo_routes
from backend.navigation.provider import NavigationRejected
from backend.navigation.zones import BoundsIndex, segment_intersects_zone
from backend.tests.test_roadside import osm_graph, p


class BoundsIndexTests(unittest.TestCase):
    def test_index_matches_full_scan_for_random_segments_and_boundary_contacts(self):
        randomizer = random.Random(713)
        boxes = []
        for _ in range(100):
            w, s = randomizer.uniform(101.72, 101.74), randomizer.uniform(3.21, 3.23)
            boxes.append((w, s, w+0.00005, s+0.00005))
        index = BoundsIndex(boxes)
        segments = [((randomizer.uniform(101.72, 101.74), randomizer.uniform(3.21, 3.23)),
                     (randomizer.uniform(101.72, 101.74), randomizer.uniform(3.21, 3.23))) for _ in range(500)]
        for w, s, e, n in boxes:
            segments.extend([((w, s), (e, s)), ((e, n), (e, n)),
                             ((w-0.0001, s-0.5e-10), (e+0.0001, s-0.5e-10))])
        for a, b in segments:
            self.assertEqual(index.intersects(a, b), any(segment_intersects_zone(a, b, box) for box in boxes))

    def test_large_bounds_and_long_segments_use_a_bounded_conservative_fallback(self):
        boxes = [(-180, -90, 180, 90), (0, 0, 0.0005, 0.0005)]
        index = BoundsIndex(boxes)
        self.assertLess(len(index.grid), 100)
        self.assertTrue(index.intersects((-100, 50), (-100, 50)))
        self.assertTrue(BoundsIndex(boxes[1:]).intersects((-150, 0), (150, 0)))
        self.assertFalse(BoundsIndex([]).intersects((0, 0), (1, 1)))

    def test_distant_boxes_do_not_trigger_exact_intersection_work(self):
        index = BoundsIndex([(101.0+i*0.001, 3.0, 101.0001+i*0.001, 3.0001) for i in range(100)])
        with patch('backend.navigation.zones.segment_intersects_zone', wraps=segment_intersects_zone) as exact:
            self.assertFalse(index.intersects((102, 4), (102.001, 4.001)))
            exact.assert_not_called()


class DemoCandidateWorkTests(unittest.TestCase):
    def setUp(self):
        self.graph = osm_graph({'a': (-100, 0), 'b': (100, 0)}, [(['a', 'b'], {'highway': 'residential'})])
        self.bounds = self.graph.bounds
        self.location = lambda point: {'longitude': point[0], 'latitude': point[1]}
        self.body = DemoRouteRequest(origin=self.location(p(-80, 6)), destination=self.location(p(80, 6)),
            start_candidates=[self.location(p(x, 6)) for x in range(-70, 1, 10)])
        self.calls = []

    def wrapper(self, accepted=None):
        outer = self
        class Graph:
            def route(self, body, **kwargs):
                origin = (body.origin.longitude, body.origin.latitude)
                outer.calls.append((origin, body.route_mode))
                if accepted is not None and origin != accepted:
                    raise NavigationRejected(422, 'Synthetic disconnected start')
                return outer.graph.route(body, **kwargs)
        return Graph()

    def calculate(self, graph):
        return calculate_demo_routes('fixture', self.bounds, self.body, {'facilities': [], 'edges': []}, graph)

    def test_eight_failed_alternatives_need_eleven_searches_instead_of_twenty_seven(self):
        result = self.calculate(self.wrapper(accepted=p(99, 6)))
        self.assertEqual(len(self.calls), 11)
        self.assertFalse(result.adjusted_start)
        self.assertTrue(all(option.route is None for option in result.options))
        modes = Counter(mode for _, mode in self.calls)
        self.assertEqual(modes, {'shortest': 9, 'avoid_damage': 1, 'accessible': 1})

    def test_successful_alternative_retains_all_modes_and_nearest_start_order(self):
        accepted = p(-60, 6)
        result = self.calculate(self.wrapper(accepted))
        self.assertTrue(result.adjusted_start)
        self.assertEqual((result.selected_origin.longitude, result.selected_origin.latitude), accepted)
        self.assertEqual([option.mode for option in result.options], ['shortest', 'avoid_damage', 'accessible'])
        self.assertTrue(all(option.route is not None for option in result.options))
        self.assertEqual(len(self.calls), 7)

    def test_direct_success_does_not_calculate_alternatives(self):
        result = self.calculate(self.wrapper())
        self.assertFalse(result.adjusted_start)
        self.assertEqual(len(self.calls), 3)

    def test_wheelchair_never_uses_a_walking_fallback(self):
        self.body.profile = 'wheelchair'
        result = self.calculate(self.wrapper(accepted=p(99, 6)))
        self.assertEqual(len(self.calls), 9)
        self.assertEqual({mode for _, mode in self.calls}, {'accessible'})
        self.assertEqual([option.mode for option in result.options], ['accessible'])


if __name__ == '__main__':
    unittest.main()
