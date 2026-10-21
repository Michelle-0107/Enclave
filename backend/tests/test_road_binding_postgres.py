"""SQL 024 compatibility with shared workflows and canonical location permissions."""
import json
from pathlib import Path
from backend.tests import test_shared_report_workflow_postgres as groups
from backend.tests import test_maintenance_postgres as fixture
from backend.navigation.road_bindings import road_reference_bindings

class RoadBindingPostgresTests(groups.SharedReportWorkflowTests):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.road_migration=(Path(__file__).resolve().parents[1]/'sql/024_road_reference_routing.sql').read_text(encoding='utf-8')
        with cls.db.cursor() as c:c.execute(cls.road_migration)

    def setUp(self):
        super().setUp()
        self.sql(self.road_migration)

    def test_all_seeded_road_references_have_metadata_and_migration_is_rerunnable(self):
        expected=len(road_reference_bindings())
        rows=self.sql("SELECT count(*) FROM map_locations WHERE metadata->>'report_target'='road_reference'",fetch=True)
        self.assertEqual(rows[0][0],expected)
        self.sql(self.road_migration)
        self.assertEqual(self.sql("SELECT count(*) FROM map_locations WHERE metadata->>'report_target'='road_reference'",fetch=True)[0][0],expected)
        self.assertEqual(self.sql("SELECT count(*) FROM map_locations WHERE kind='road_section'",fetch=True)[0][0],2072)

    def test_existing_legacy_roads_are_backfilled_without_moving_reports_or_changing_tasks(self):
        rows=[row for row in road_reference_bindings().values() if 3.2171<=row['latitude']<=3.2349 and 101.7211<=row['longitude']<=101.7409][:5]
        for row in rows:
            self.sql("INSERT INTO community_facilities(id,name,facility_type,latitude,longitude,created_by) SELECT id,name,'other',latitude,longitude,%s FROM map_locations WHERE id=%s ON CONFLICT(id) DO UPDATE SET facility_type='other'",(fixture.MANAGER,row['id']))
        before=self.sql('SELECT id,ticket_id,location_id,status FROM reports ORDER BY id',fetch=True)
        self.sql(self.road_migration)
        for row in rows:self.assertEqual(self.sql('SELECT facility_type FROM community_facilities WHERE id=%s',(row['id'],),fetch=True)[0][0],'path_surface')
        self.assertEqual(self.sql('SELECT id,ticket_id,location_id,status FROM reports ORDER BY id',fetch=True),before)

    def test_new_whole_road_reports_are_rejected_but_independent_sections_and_places_remain(self):
        row=next(row for row in road_reference_bindings().values() if 3.2171<=row['latitude']<=3.2349 and 101.7211<=row['longitude']<=101.7409)
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT enclave_community_issues(%s,%s::jsonb)',('open_place_issue',json.dumps(dict(actor_id=fixture.RESIDENT,facility_id=row['id'],report_ticket_id='TICK-1'))))
                self.assertEqual(c.fetchone()[0]['reason'],'choose_independent_road_section')
            finally:c.execute('RESET ROLE')
        self.assertEqual(self.sql("SELECT kind FROM map_locations WHERE name='KL East Mall' LIMIT 1",fetch=True)[0][0],'place')
