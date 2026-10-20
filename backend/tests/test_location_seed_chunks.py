"""Guard the actual UTF-8 SQL Editor payload size and complete seed membership."""
import json
from pathlib import Path
import unittest
from backend.tools.build_location_seed import MAX_SQL_BYTES,catalogue_rows,generate_files

class LocationSeedChunkTests(unittest.TestCase):
    def test_every_file_is_small_reproducible_and_all_locations_appear_once(self):
        files=generate_files();folder=Path(__file__).resolve().parents[1]/'sql'
        rows=[]
        for name,sql in files.items():
            self.assertLessEqual(len(sql.encode('utf-8')),MAX_SQL_BYTES)
            self.assertEqual((folder/name).read_text(encoding='utf-8'),sql)
            if 'finalize' not in name:
                payload=sql.split('jsonb_to_recordset($locations$',1)[1].split('$locations$::jsonb',1)[0]
                rows.extend(json.loads(payload))
                self.assertNotIn('UPDATE public.reports',sql)
        expected=catalogue_rows()
        self.assertEqual(rows,expected)
        self.assertEqual(len({r['id'] for r in rows}),3324)
        self.assertEqual(sum(r['kind']=='road_section' for r in rows),2072)
        self.assertEqual(sum(r['kind']=='place' for r in rows),1252)
        self.assertEqual(sorted(files),list(files))
        self.assertIn('finalize',next(reversed(files)))
