"""Demo conditions must not invent pedestrian infrastructure on the real map."""
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

from backend.navigation.areas import find_area
from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.roadside import distance, walking_graph
from backend.tools.build_resident_demo import build, mapped_facility


ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / 'backend/data/demo_areas'


class DemoFacilityMappingTests(unittest.TestCase):
    def test_sidewalk_and_vehicle_bridge_do_not_claim_pedestrian_crossings(self):
        for tags in (
            {'highway': 'footway', 'footway': 'sidewalk'},
            {'highway': 'residential'},
            {'highway': 'service', 'bridge': 'yes'},
            {'highway': 'footway', 'wheelchair': 'yes'},
            {'highway': 'footway', 'footway': 'crossing', 'crossing': 'unmarked'},
        ):
            with self.subTest(tags=tags):
                self.assertEqual(mapped_facility(tags), ('path_surface', 'Pavement section'))

    def test_types_and_names_require_the_corresponding_osm_evidence(self):
        cases = [
            ({'highway': 'footway', 'crossing:markings': 'zebra'}, ('crossing', 'Zebra crossing')),
            ({'highway': 'footway', 'footway': 'crossing', 'crossing:markings': 'yes'}, ('crossing', 'Mapped pedestrian crossing')),
            ({'highway': 'footway', 'crossing:signals': 'yes'}, ('crossing', 'Mapped pedestrian crossing')),
            ({'highway': 'footway', 'bridge': 'yes', 'layer': '1'}, ('footbridge', 'Mapped footbridge')),
            ({'highway': 'steps'}, ('stairs', 'Mapped stairs')),
            ({'highway': 'footway', 'ramp': 'yes'}, ('ramp', 'Mapped ramp')),
            ({'highway': 'footway', 'tunnel': 'yes'}, ('path_surface', 'Mapped pedestrian underpass')),
        ]
        for tags, expected in cases:
            with self.subTest(tags=tags):
                self.assertEqual(mapped_facility(tags), expected)

    def test_published_snapshots_rebuild_from_osm_and_remove_the_false_zebra(self):
        area = find_area('kl-east-pilot').model_dump(mode='json')
        metadata = json.loads((FOLDER / 'kl-east-pilot-source.json').read_text())
        rebuilt = build(FOLDER / 'kl-east-pilot.osm', area, metadata, add_demo_facilities=True)
        from backend.navigation.demo_accessibility import generate_accessibility
        from backend.navigation.demo_network import demo_walking_graph
        rebuilt['demoAccessibility']=json.loads((FOLDER / 'kl-east-pilot.json').read_text(encoding='utf-8'))['demoAccessibility']
        rebuilt['accessibilityFacilities']=generate_accessibility('kl-east-pilot',demo_walking_graph('kl-east-pilot'),rebuilt)
        for target in (FOLDER / 'kl-east-pilot.json', ROOT / 'frontend/enclave-mobile/src/demo/kl-east-demo.json'):
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')), rebuilt)
        facilities = {item['id']: item for item in rebuilt['facilities']}
        former_zebra = facilities['demo-crossing-1252137889-12']
        self.assertEqual(former_zebra['kind'], 'path_surface')
        self.assertEqual(former_zebra['name'], 'Pavement section · Mapped footpath')
        self.assertEqual(former_zebra['coordinate'], [101.72925195, 3.22540015])
        self.assertFalse(former_zebra['damaged'])
        self.assertEqual(len(facilities), 138)
        self.assertEqual(sum(item['damaged'] for item in facilities.values()), 35)

    def test_actual_kl_east_footbridge_connects_its_mapped_approaches(self):
        root = ET.parse(FOLDER / 'kl-east-pilot.osm').getroot()
        points = {node.attrib['id']: (float(node.attrib['lon']), float(node.attrib['lat']))
                  for node in root.findall('node')}
        # Ground approach -> stairs -> bridge -> mapped mall bridge entrance.
        # The mall's label/centroid is not a mapped entrance or indoor corridor.
        origin, destination = points['2359897329'], points['7104357268']
        request = WalkingRouteRequest(
            origin={'longitude': origin[0], 'latitude': origin[1]},
            destination={'longitude': destination[0], 'latitude': destination[1]},
        )
        route = walking_graph('kl-east-pilot').route(request, demo_mode=True)
        geometry = route.geometry.coordinates
        self.assertTrue(any(distance(point, points['7221303813']) < .1 for point in geometry))
        self.assertTrue(any(distance(point, points['7221303812']) < .1 for point in geometry))
        self.assertLess(distance(geometry[-1], destination), .1)
        self.assertAlmostEqual(route.distance_meters, 139.196, places=2)
        self.assertFalse(route.field_verified)
