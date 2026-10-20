"""SQL 019 transaction/concurrency/ownership tests on a disposable local database."""
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import psycopg2
import backend.tests.test_community_postgres as community

class RoadReportPointPostgresTests(community.CommunityPostgresTests):
    def setUp(self):
        super().setUp()
        self.road_sql=(Path(__file__).resolve().parents[1]/'sql/019_road_section_reporting.sql').read_text(encoding='utf-8')
        with self.db.cursor() as cursor:cursor.execute(self.road_sql)

    def road(self,number=1,actor=community.A,ticket='A-1',connection=None,**changes):
        identifier=f'90000000-0000-4000-8000-{number:012d}'
        point={'id':identifier,'name':f'Synthetic road section {number}','facility_type':'path_surface',
            'latitude':3.22649,'longitude':101.730755}
        point.update(changes.pop('point',{}))
        return self.call('open_road_issue',actor=actor,connection=connection,facility_id=identifier,
            report_ticket_id=ticket,road_point=point,**changes)

    def test_road_sections_count_independently_then_two_residents_qualify(self):
        first=self.road()['issue'];second=self.road(2,actor=community.B,ticket='B-1')['issue']
        self.assertNotEqual(first['id'],second['id']);self.assertEqual(first['reporter_count'],1);self.assertEqual(second['reporter_count'],1)
        self.assertEqual(self.call('map')['items'],[])
        with self.db.cursor() as cursor:
            cursor.execute("INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude) VALUES('B-2',%s,'pending',false,3.22649,101.730755)",(community.B,))
        confirmed=self.road(actor=community.B,ticket='B-2')['issue']
        self.assertEqual(confirmed['id'],first['id']);self.assertEqual(confirmed['reporter_count'],2)
        self.assertEqual(len(self.call('map')['items']),1)
        self.assertTrue(self.road(ticket='A-2')['deduplicated'])
        self.assertEqual(self.road(ticket='A-2')['issue']['reporter_count'],2)

    def test_road_different_fault_types_remain_separate(self):
        one=self.road()['issue'];two=self.road(ticket='A-2',fault_kind='obstruction')['issue']
        self.assertNotEqual(one['id'],two['id']);self.assertEqual(two['reporter_count'],1)

    def test_failed_ownership_link_rolls_back_lazy_facility_creation(self):
        result=self.road(actor=community.B,ticket='A-1');self.assertEqual(result['state'],'not_found')
        with self.db.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM community_facilities WHERE id::text LIKE '90000000-%%'")
            self.assertEqual(cursor.fetchone()[0],0)

    def test_wrong_location_rolls_back_lazy_facility(self):
        self.assertEqual(self.road(point={'latitude':3.234,'longitude':101.739})['state'],'invalid')
        with self.db.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM community_facilities WHERE id::text LIKE '90000000-%%'")
            self.assertEqual(cursor.fetchone()[0],0)

    def test_existing_facility_geometry_is_never_silently_relocated(self):
        self.assertEqual(self.road()['state'],'ok')
        self.assertEqual(self.road(actor=community.B,ticket='B-1',point={'latitude':3.2266})['state'],'conflict')
        with self.db.cursor() as cursor:
            cursor.execute("SELECT latitude FROM community_facilities WHERE id='90000000-0000-4000-8000-000000000001'")
            self.assertEqual(cursor.fetchone()[0],3.22649)

    def test_concurrent_first_reports_share_one_section_and_issue(self):
        def submit(actor,ticket):
            connection=psycopg2.connect(community.DSN)
            try:
                result=self.road(actor=actor,ticket=ticket,connection=connection);connection.commit();return result
            finally:connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(submit,community.A,'A-1'),pool.submit(submit,community.B,'B-1')]
            results=[future.result() for future in futures]
        self.assertTrue(all(result['state']=='ok' for result in results))
        self.assertEqual(len({result['issue']['id'] for result in results}),1)
        self.assertEqual(self.road()['issue']['reporter_count'],2)

    def test_road_rpc_is_not_browser_executable_and_migration_is_rerunnable(self):
        for role in ('anon','authenticated'):
            with self.db.cursor() as cursor:
                cursor.execute('SET ROLE '+role)
                try:
                    for function in ('enclave_community_issues','enclave_community_issues_base'):
                        with self.assertRaises(psycopg2.errors.InsufficientPrivilege):cursor.execute('SELECT '+function+"('facilities','{}'::jsonb)")
                finally:cursor.execute('RESET ROLE')
        self.assertEqual(self.road()['state'],'ok')
        with self.db.cursor() as cursor:cursor.execute(self.road_sql)
        self.assertEqual(self.road()['issue']['reporter_count'],1)

    def test_what_if_qualification_is_per_section_and_approval_removes_only_that_candidate(self):
        folder=Path(__file__).resolve().parents[1]/'sql'
        with self.db.cursor() as cursor:
            for name in ('010_management_what_if_snapshot.sql','018_what_if_candidate_review.sql'):
                cursor.execute((folder/name).read_text(encoding='utf-8'))
        self.road();self.road(actor=community.B,ticket='B-1');self.road(2,ticket='A-2')
        def snapshot():
            with self.db.cursor() as cursor:
                cursor.execute('SET ROLE service_role')
                try:
                    cursor.execute('SELECT enclave_what_if_snapshot(%s::uuid)',(community.MANAGER,));return cursor.fetchone()[0]
                finally:cursor.execute('RESET ROLE')
        items=snapshot()['issues'];self.assertEqual(len(items),1);self.assertEqual(items[0]['reporter_count'],2)
        self.assertEqual(items[0]['facility_id'],'90000000-0000-4000-8000-000000000001')
        self.assertIsNotNone(items[0]['review_ticket_id'])
        with self.db.cursor() as cursor:cursor.execute("UPDATE reports SET status='approved',is_approved=true WHERE ticket_id='A-1'")
        self.assertIsNone(snapshot()['issues'][0]['review_ticket_id'])
