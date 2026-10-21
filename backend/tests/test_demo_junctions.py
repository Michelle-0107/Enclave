"""Short side-street mouths need explicit demo facilities, without opening Live."""
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

from backend.navigation.demo_network import generate_junction_facilities, overlay_graph
from backend.navigation.provider import NavigationRejected
from backend.navigation.roadside import RoadsideGraph, distance
from backend.tests.test_roadside import p, body


class DemoJunctionTests(unittest.TestCase):
    def graph(self, *, road_tags=None, node_tags=None, wall=False):
        root = ET.Element('osm', version='0.6')
        nodes = {'w':(-80,0), 'm':(0,0), 'e':(80,0), 'short':(0,10), 'n':(0,100)}
        if wall:
            nodes.update({'wall-a':(0,1), 'wall-b':(0,20)})
        for ident, point in nodes.items():
            lon,lat = p(*point)
            node = ET.SubElement(root, 'node', id=ident, lon=str(lon), lat=str(lat))
            for key,value in (node_tags or {}).get(ident, {}).items():
                ET.SubElement(node, 'tag', k=key, v=value)
        ways = [('main',['w','m','e'], {'highway':'residential'}),
                ('branch',['m','short','n'], {'highway':'residential', **(road_tags or {})})]
        if wall:
            ways.append(('wall',['wall-a','wall-b'], {'barrier':'wall'}))
        for ident,refs,tags in ways:
            way = ET.SubElement(root, 'way', id=ident)
            for ref in refs:
                ET.SubElement(way, 'nd', ref=ref)
            for key,value in tags.items():
                ET.SubElement(way, 'tag', k=key, v=value)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        source = Path(directory.name)/'junction.osm'
        ET.ElementTree(root).write(source)
        graph = RoadsideGraph(source, (101.795,2.999,101.815,3.018), resident_access=True)
        return graph,source

    def test_short_junction_crossing_connects_same_side_approaches_and_obeys_damage(self):
        live,source = self.graph()
        request = body(p(-60,6),p(60,6))
        with self.assertRaises(NavigationRejected):
            live.route(request)
        facilities = generate_junction_facilities(live, [], source)
        self.assertEqual(len(facilities), 1)
        facility = facilities[0]
        self.assertEqual(facility['sourceRoadWayId'], 'branch')
        self.assertFalse(facility['fieldVerified'])
        self.assertTrue(all(anchor['wayId']=='branch' for anchor in facility['anchors']))
        self.assertLessEqual(distance(*facility['geometry']), 15)
        graph = overlay_graph(live, facilities)
        route = graph.route(request, demo_mode=True)
        self.assertLess(route.distance_meters, 140)
        self.assertIn(facility['id'], route.demo_facility_ids)
        west,south = p(-5,2); east,north = p(5,8)
        with self.assertRaises(NavigationRejected):
            graph.route(request, boxes=[(west,south,east,north)], demo_mode=True)
        with self.assertRaises(NavigationRejected):
            live.route(request)
        self.assertEqual(generate_junction_facilities(live, facilities, source), [])

    def test_crossing_cannot_override_access_crossing_prohibitions_or_walls(self):
        variants = [dict(road_tags={'foot':'no'}), dict(road_tags={'crossing':'no'}),
                    dict(node_tags={'m':{'crossing':'no'}}), dict(wall=True)]
        for arguments in variants:
            with self.subTest(arguments=arguments):
                graph,source = self.graph(**arguments)
                self.assertEqual(generate_junction_facilities(graph, [], source), [])
