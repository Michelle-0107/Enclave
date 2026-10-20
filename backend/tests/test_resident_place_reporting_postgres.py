"""Real authenticated INSERT and canonical existing-place reporting regression."""
import json
from pathlib import Path
import unittest
import psycopg2
from backend.tests.test_shared_locations_postgres import SharedLocationsPostgresTests as Base
from backend.tests import test_community_postgres as fixtures

@unittest.skipUnless(fixtures.DSN,'Requires a disposable loopback database')
class ResidentPlaceReportingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.setUpClass.__func__(cls)
        cls.migration=(cls.folder/'022_resident_place_reporting.sql').read_text(encoding='utf-8')
        with cls.db.cursor() as c:
            c.execute(cls.migration)
            c.execute("""GRANT SELECT ON reports,residents TO authenticated;
              GRANT INSERT(ticket_id,user_id,status,is_approved,latitude,longitude,description,category) ON reports TO authenticated;
              CREATE POLICY fixture_owner_select ON reports FOR SELECT TO authenticated USING(user_id=auth.uid());
              CREATE POLICY fixture_owner_insert ON reports FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND status='pending' AND NOT is_approved AND EXISTS(SELECT 1 FROM residents WHERE profile_id=auth.uid() AND status='active' AND verified_at IS NOT NULL));""")
    @classmethod
    def tearDownClass(cls):cls.db.close()
    setUp=Base.setUp
    call=Base.call
    def point(self):return self.call('search',query='KL East Mall',limit=1)['items'][0]
    def insert(self,ticket,actor,point,role=None,owner=None,approved=False):
        with self.db.cursor() as c:
            if role:c.execute('SET ROLE '+role);c.execute("SELECT set_config('request.jwt.claim.sub',%s,false)",(actor,))
            try:c.execute("INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude,location_id,category) VALUES(%s,%s,%s,%s,%s,%s,%s,'Damaged Facility')",(ticket,owner or actor,'approved' if approved else 'pending',approved,point['latitude'],point['longitude'],point['id']))
            finally:
                if role:c.execute('RESET ROLE')
    def link(self,ticket,actor,ident):
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT enclave_community_issues(%s,%s::jsonb)',('open_place_issue',json.dumps(dict(actor_id=actor,facility_id=ident,report_ticket_id=ticket,fault_kind='damage'))))
                return c.fetchone()[0]
            finally:c.execute('RESET ROLE')
    def test_missing_column_grant_reproduces_screenshot_and_sql022_repairs_it(self):
        point=self.point()
        with self.db.cursor() as c:c.execute('REVOKE INSERT(location_id) ON reports FROM authenticated')
        with self.assertRaises(psycopg2.errors.InsufficientPrivilege):self.insert('DENIED',fixtures.A,point,'authenticated')
        with self.db.cursor() as c:c.execute(self.migration)
        self.insert('SAVED',fixtures.A,point,'authenticated')
        with self.db.cursor() as c:
            c.execute("SELECT user_id,location_id FROM reports WHERE ticket_id='SAVED'")
            row=c.fetchone();self.assertEqual(str(row[0]),fixtures.A);self.assertEqual(str(row[1]),point['id'])
    def test_grant_still_blocks_other_owners_inactive_anon_and_self_approval(self):
        point=self.point()
        for actor,role,owner,approved in [(fixtures.A,'authenticated',fixtures.B,False),(fixtures.INACTIVE,'authenticated',None,False),(fixtures.A,'anon',None,False),(fixtures.A,'authenticated',None,True)]:
            with self.subTest(role=role,actor=actor,owner=owner,approved=approved),self.assertRaises(psycopg2.errors.InsufficientPrivilege):self.insert('BAD',actor,point,role,owner,approved)
    def test_two_residents_report_one_existing_place_without_creating_duplicate_points(self):
        point=self.point()
        self.insert('PLACE-A',fixtures.A,point);self.insert('PLACE-B',fixtures.B,point)
        first=self.link('PLACE-A',fixtures.A,point['id']);self.assertEqual(first['state'],'ok',first)
        self.assertEqual(first['issue']['reporter_count'],1);self.assertFalse(first['issue']['affects_routes'])
        second=self.link('PLACE-B',fixtures.B,point['id']);self.assertEqual(second['issue']['id'],first['issue']['id']);self.assertEqual(second['issue']['reporter_count'],2)
        self.assertTrue(self.link('PLACE-B',fixtures.B,point['id'])['deduplicated'])
        with self.db.cursor() as c:
            c.execute('SELECT name,kind FROM map_locations WHERE id=%s',(point['id'],));self.assertEqual(c.fetchone(),(point['name'],'place'))
            c.execute('SELECT count(*) FROM community_facilities WHERE id=%s',(point['id'],));self.assertEqual(c.fetchone()[0],1)
    def test_place_link_checks_ownership_active_registry_and_distance(self):
        point=self.point();self.insert('OWNED',fixtures.A,point)
        self.assertEqual(self.link('OWNED',fixtures.B,point['id'])['state'],'not_found')
        self.assertEqual(self.link('OWNED',fixtures.INACTIVE,point['id'])['state'],'forbidden')
        with self.assertRaises(psycopg2.errors.CheckViolation),self.db.cursor() as c:c.execute("UPDATE reports SET latitude=3.2348 WHERE ticket_id='OWNED'")
        # Trigger protects the canonical association too, before RPC link access.
