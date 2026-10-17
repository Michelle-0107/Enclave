"""Regression checks for pedestrian direction versus vehicle one-way tags."""
import tempfile
import unittest
from pathlib import Path
from build_dataset import build


class WalkingDirectionTests(unittest.TestCase):
    def direction(self, tags):
        xml = '<osm><node id="1" lat="3.225" lon="101.73"/><node id="2" lat="3.226" lon="101.73"/>'
        xml += '<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/>'
        xml += ''.join(f'<tag k="{key}" v="{value}"/>' for key, value in tags.items()) + '</way></osm>'
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.osm'
            source.write_text(xml, encoding='utf-8')
            return build(source)['edges'][0]['direction']

    def test_vehicle_oneway_is_not_pedestrian_oneway(self):
        self.assertEqual(self.direction({'oneway': 'yes'}), 'both')

    def test_explicit_pedestrian_oneway_is_preserved(self):
        self.assertEqual(self.direction({'oneway:foot': 'yes'}), 'forward')
        self.assertEqual(self.direction({'oneway:foot': '-1'}), 'backward')

    def test_pedestrian_direction_override_is_respected(self):
        self.assertEqual(self.direction({'foot:backward': 'no'}), 'forward')
        self.assertEqual(self.direction({'foot:forward': 'no'}), 'backward')


if __name__ == '__main__':
    unittest.main()
