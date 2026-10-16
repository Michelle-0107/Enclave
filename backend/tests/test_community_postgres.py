"""Real SQL 009 ownership, consensus, incident lifecycle, and transaction tests."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import json,os
from pathlib import Path
import unittest
import psycopg2
from psycopg2.extensions import parse_dsn

DSN=os.environ.get('ENCLAVE_TEST_PG_DSN')
A='00000000-0000-4000-8000-000000000001'
B='00000000-0000-4000-8000-000000000002'
MANAGER='00000000-0000-4000-8000-000000000003'
INACTIVE='00000000-0000-4000-8000-000000000004'


@unittest.skipUnless(DSN,'Requires a dedicated disposable local PostgreSQL database')
class CommunityPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info=parse_dsn(DSN)
        if info.get('host')!='127.0.0.1' or info.get('dbname')!='enclave_community_test':
            raise RuntimeError('Refusing existing or hosted databases')
        cls.db=psycopg2.connect(DSN); cls.db.autocommit=True
        with cls.db.cursor() as c:
            c.execute('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
                CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
                CREATE TABLE residents(profile_id uuid,status text,verified_at timestamptz);
                CREATE TABLE reports(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ticket_id text,
                    user_id uuid REFERENCES profiles(id),status text,is_approved boolean,latitude float8,longitude float8,
                    description text,category text,priority text,image_url text,created_at timestamptz DEFAULT clock_timestamp());
                ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
                INSERT INTO profiles VALUES (%s,'resident'),(%s,'resident'),(%s,'management'),(%s,'resident');
                INSERT INTO residents VALUES (%s,'active',now()),(%s,'active',now()),(%s,'inactive',now());''',
                (A,B,MANAGER,INACTIVE,A,B,INACTIVE))
            folder=Path(__file__).resolve().parents[1]/'sql'
            c.execute((folder/'007_report_workflow.sql').read_text(encoding='utf-8'))
            cls.migration=(folder/'009_community_issue_points.sql').read_text(encoding='utf-8')
            c.execute(cls.migration)

    @classmethod
    def tearDownClass(cls): cls.db.close()

    def setUp(self):
        with self.db.cursor() as c:
            c.execute('''DROP TRIGGER IF EXISTS fail_community_link ON community_issue_reports;
                TRUNCATE community_issue_reports,community_issues,community_facilities,report_status_events,reports RESTART IDENTITY;
                INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude,description,category,priority)
                VALUES ('A-1',%s,'pending',false,3.22649,101.730755,'Private','Blocked Path','high'),
                       ('A-2',%s,'pending',false,3.22649,101.730755,'Private','Blocked Path','high'),
                       ('B-1',%s,'pending',false,3.22649,101.730755,'Private','Blocked Path','high');''',(A,A,B))
        self.facility=self.call('create_facility',name='Test walkway',facility_type='path_surface',latitude=3.22649,longitude=101.730755)['item']['id']

    def call(self,action,actor=A,connection=None,**changes):
        args={'actor_id':actor,'facility_id':self.facility if hasattr(self,'facility') else None,'fault_kind':'damage',
            'report_ticket_id':'A-1','limit':100,'offset':0,'west':-180,'south':-90,'east':180,'north':90}
        args.update(changes)
        db=connection or self.db
        with db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT enclave_community_issues(%s,%s::jsonb)',(action,json.dumps(args)))
                return c.fetchone()[0]
            finally:
                if connection is None: c.execute('RESET ROLE')

    def first(self): return self.call('open_issue')['issue']['id']

    def second(self,issue):
        return self.call('report_issue',actor=B,facility_id=None,issue_id=issue,report_ticket_id='B-1')

    def test_two_different_residents_publish_without_management_approval(self):
        issue=self.first()
        self.assertEqual(self.call('map')['items'],[])
        self.assertEqual(self.call('issues')['items'][0]['reporter_count'],1)
        result=self.second(issue)
        self.assertEqual(result['issue']['reporter_count'],2)
        self.assertEqual(len(self.call('map')['items']),1)
        self.assertEqual(len(self.call('obstacles')['items']),1)
        with self.db.cursor() as c:
            c.execute('SELECT bool_and(status=\'pending\' AND NOT is_approved) FROM reports')
            self.assertTrue(c.fetchone()[0])

    def test_duplicate_resident_does_not_increase_count_even_with_another_ticket(self):
        issue=self.first()
        for ticket in ('A-1','A-2'):
            result=self.call('report_issue',facility_id=None,issue_id=issue,report_ticket_id=ticket)
            self.assertTrue(result['deduplicated']); self.assertEqual(result['issue']['reporter_count'],1)
        self.assertEqual(self.call('map')['items'],[])

    def test_second_resident_can_open_same_facility_and_reuse_same_incident(self):
        issue=self.first()
        result=self.call('open_issue',actor=B,report_ticket_id='B-1')
        self.assertEqual(result['issue']['id'],issue)
        self.assertEqual(result['issue']['reporter_count'],2)

    def test_cannot_use_another_residents_report_or_inactive_membership(self):
        self.assertEqual(self.call('open_issue',actor=B)['state'],'not_found')
        self.assertEqual(self.call('open_issue',actor=INACTIVE)['state'],'forbidden')
        self.assertEqual(self.call('map',actor=MANAGER)['state'],'forbidden')

    def test_nonroad_damage_appears_on_map_but_is_not_a_route_exclusion(self):
        self.facility=self.call('create_facility',name='Test bench',facility_type='bench',latitude=3.22649,longitude=101.730755)['item']['id']
        self.second(self.first())
        self.assertEqual(len(self.call('map')['items']),1)
        self.assertEqual(self.call('obstacles')['items'],[])

    def test_private_evidence_and_reporter_ids_never_in_public_projections(self):
        self.second(self.first())
        for action in ('map','issues','obstacles','facilities'):
            result=json.dumps(self.call(action))
            for secret in (A,B,'Private','image_url','user_id','created_by','ticket_id'):
                self.assertNotIn(secret,result)

    def test_repair_closes_incident_old_evidence_cannot_reopen_and_new_cycle_resets(self):
        issue=self.first(); self.second(issue)
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                for before,after in [('pending','approved'),('approved','in_progress'),('in_progress','resolved')]:
                    c.execute("SELECT enclave_report_workflow('update',%s::jsonb)",(json.dumps({'actor_id':MANAGER,
                        'ticket_id':'A-1','expected_status':before,'status':after,'note':'Checked repair','repair_verified':after=='resolved'}),))
                    self.assertEqual(c.fetchone()[0]['state'],'ok')
                    self.assertEqual(len(self.call('map',connection=self.db)['items']),int(after!='resolved'))
            finally: c.execute('RESET ROLE')
        self.assertEqual(self.call('obstacles')['items'],[])
        self.assertEqual(len(self.call('map',include_resolved=True)['items']),1)
        self.assertEqual(self.call('report_issue',facility_id=None,issue_id=issue,report_ticket_id='A-2')['state'],'closed')
        self.assertEqual(self.call('open_issue',report_ticket_id='A-2')['state'],'closed')
        with self.db.cursor() as c:
            c.execute("INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude) VALUES('A-NEW',%s,'pending',false,3.22649,101.730755)",(A,))
        new=self.call('open_issue',report_ticket_id='A-NEW')['issue']
        self.assertNotEqual(new['id'],issue); self.assertEqual(new['reporter_count'],1)
        self.assertEqual(self.call('map')['items'],[])

    def test_link_audit_failure_rolls_back_incident_creation(self):
        with self.db.cursor() as c:
            c.execute('''CREATE OR REPLACE FUNCTION fail_link_fixture() RETURNS trigger LANGUAGE plpgsql AS
                $$ BEGIN RAISE EXCEPTION 'Fixture failure'; END; $$;
                CREATE TRIGGER fail_community_link BEFORE INSERT ON community_issue_reports
                FOR EACH ROW EXECUTE FUNCTION fail_link_fixture()''')
        with self.assertRaises(psycopg2.Error): self.first()
        with self.db.cursor() as c:
            c.execute('SELECT count(*) FROM community_issues'); self.assertEqual(c.fetchone()[0],0)

    def test_concurrent_retries_count_once(self):
        def create(_):
            db=psycopg2.connect(DSN)
            try: result=self.call('open_issue',connection=db); db.commit(); return result
            finally: db.close()
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(create,range(2)))
        self.assertEqual({r['issue']['reporter_count'] for r in results},{1})
        self.assertEqual(len(self.call('issues')['items']),1)

    def test_report_cannot_count_in_multiple_incidents(self):
        self.first()
        other=self.call('open_issue',fault_kind='obstruction')
        self.assertEqual(other['state'],'conflict')
        self.assertEqual(len(self.call('issues')['items']),1)

    def test_far_evidence_and_invalid_facilities_are_rejected_without_ghost_issues(self):
        with self.db.cursor() as c: c.execute("UPDATE reports SET latitude=3.139 WHERE ticket_id='A-1'")
        self.assertEqual(self.call('open_issue')['state'],'invalid')
        self.assertEqual(self.call('issues')['items'],[])
        self.assertEqual(self.call('create_facility',name='Bad',facility_type='path_surface',latitude=90,longitude=180)['state'],'invalid')

    def test_browser_roles_cannot_read_tables_or_execute_private_functions(self):
        for role in ('anon','authenticated'):
            with self.db.cursor() as c:
                c.execute('SET ROLE '+role)
                try:
                    for statement in ("SELECT enclave_community_issues('map','{}')","SELECT enclave_issue_projection(gen_random_uuid())",
                        'SELECT * FROM community_facilities','SELECT * FROM community_issues','SELECT * FROM community_issue_reports'):
                        with self.assertRaises(psycopg2.errors.InsufficientPrivilege): c.execute(statement)
                finally: c.execute('RESET ROLE')

    def test_bbox_pagination_and_idempotent_migration(self):
        self.second(self.first())
        self.assertEqual(self.call('map',west=0,east=1)['items'],[])
        self.assertEqual(self.call('map',offset=1)['items'],[])
        with self.db.cursor() as c: c.execute(self.migration)
        self.assertEqual(len(self.call('map')['items']),1)

    def test_restriction_overflow_never_returns_a_partial_set(self):
        with self.db.cursor() as c:
            c.execute('''INSERT INTO community_facilities(name,facility_type,latitude,longitude,created_by)
                SELECT 'Load-'||n,'path_surface',3.22649,101.730755,%s FROM generate_series(1,101) n;
                INSERT INTO community_issues(facility_id,fault_kind)
                SELECT id,'damage' FROM community_facilities WHERE name LIKE 'Load-%%';
                INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude,description)
                SELECT 'LOAD-'||i.id||'-'||v.owner,v.owner,'pending',false,3.22649,101.730755,i.id::text
                FROM community_issues i CROSS JOIN (VALUES(%s::uuid),(%s::uuid)) v(owner);
                INSERT INTO community_issue_reports(issue_id,user_id,report_id)
                SELECT description::uuid,user_id,id FROM reports WHERE ticket_id LIKE 'LOAD-%%';''',(A,A,B))
        self.assertEqual(self.call('obstacles')['state'],'too_many')
        self.assertTrue(self.call('map',limit=100)['has_more'])

    def test_repair_audit_failure_rolls_back_incident_closure_too(self):
        issue=self.first(); self.second(issue)
        with self.db.cursor() as c:
            c.execute("UPDATE reports SET status='in_progress',is_approved=true WHERE ticket_id='A-1'")
            c.execute('''CREATE OR REPLACE FUNCTION fail_repair_fixture() RETURNS trigger LANGUAGE plpgsql AS
                $$ BEGIN RAISE EXCEPTION 'Fixture repair audit failure'; END; $$;
                CREATE TRIGGER zz_fail_repair_fixture AFTER INSERT ON report_status_events
                FOR EACH ROW EXECUTE FUNCTION fail_repair_fixture()''')
            c.execute('SET ROLE service_role')
            try:
                with self.assertRaises(psycopg2.Error):
                    c.execute("SELECT enclave_report_workflow('update',%s::jsonb)",(json.dumps({'actor_id':MANAGER,
                        'ticket_id':'A-1','expected_status':'in_progress','status':'resolved','note':'Repair checked','repair_verified':True}),))
            finally: c.execute('RESET ROLE')
            c.execute('DROP TRIGGER zz_fail_repair_fixture ON report_status_events')
        self.assertEqual(self.call('issues')['items'][0]['status'],'open')
        self.assertEqual(len(self.call('obstacles')['items']),1)
