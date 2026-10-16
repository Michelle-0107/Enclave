"""Disposable PostgreSQL tests for SQL 008 roles, locking, expiry, and audit atomicity."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
import json
import os
from pathlib import Path
import unittest

import psycopg2
from psycopg2.extensions import parse_dsn

DSN=os.environ.get('ENCLAVE_TEST_PG_DSN')
MANAGER='00000000-0000-4000-8000-000000000001'
RESIDENT='00000000-0000-4000-8000-000000000002'
INACTIVE='00000000-0000-4000-8000-000000000003'


@unittest.skipUnless(DSN,'Requires an explicitly disposable loopback PostgreSQL database')
class ObstaclesPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info=parse_dsn(DSN)
        if info.get('host')!='127.0.0.1' or info.get('dbname')!='enclave_obstacle_test':
            raise RuntimeError('Refusing any existing or hosted database')
        cls.db=psycopg2.connect(DSN); cls.db.autocommit=True
        with cls.db.cursor() as c:
            c.execute('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
                CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
                CREATE TABLE residents(profile_id uuid,status text,verified_at timestamptz);
                CREATE TABLE reports(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ticket_id text,
                    user_id uuid REFERENCES profiles(id),status text,is_approved boolean,latitude float8,longitude float8);
                ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
                INSERT INTO profiles VALUES (%s,'management'),(%s,'resident'),(%s,'resident');
                INSERT INTO residents VALUES (%s,'active',now()),(%s,'inactive',now());''',
                (MANAGER,RESIDENT,INACTIVE,RESIDENT,INACTIVE))
            folder=Path(__file__).resolve().parents[1]/'sql'
            c.execute((folder/'007_report_workflow.sql').read_text(encoding='utf-8'))
            cls.migration=(folder/'008_confirmed_routing_obstacles.sql').read_text(encoding='utf-8')
            c.execute(cls.migration)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        with self.db.cursor() as c:
            c.execute('''DROP TRIGGER IF EXISTS fail_obstacle_audit ON routing_impact_events;
                TRUNCATE routing_impact_events,report_routing_impacts,report_status_events,reports RESTART IDENTITY;
                INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude)
                VALUES ('TICK-TEST',%s,'approved',true,3.22649,101.730755)''',(RESIDENT,))

    def args(self,**changes):
        values={'actor_id':MANAGER,'ticket_id':'TICK-TEST','expected_version':0,'expected_report_status':'approved',
            'impact':'blocked','center':{'latitude':3.22649,'longitude':101.730755},'half_width_meters':5.0,
            'expires_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),'note':'Confirmed on site'}
        values.update(changes); return values

    def call(self,action='set',connection=None,**changes):
        db=connection or self.db
        with db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT enclave_routing_obstacles(%s,%s::jsonb)',(action,json.dumps(self.args(**changes))))
                return c.fetchone()[0]
            finally:
                if connection is None: c.execute('RESET ROLE')

    def test_management_confirmation_required_and_role_is_read_from_database(self):
        self.assertEqual(self.call('active',actor_id=RESIDENT)['items'],[])
        self.assertEqual(self.call(actor_id=RESIDENT)['state'],'forbidden')
        self.assertEqual(self.call('get',actor_id=RESIDENT)['state'],'forbidden')
        self.assertEqual(self.call('active',actor_id=INACTIVE)['state'],'forbidden')
        self.assertEqual(self.call()['state'],'ok')
        snapshot=self.call('active',actor_id=RESIDENT)
        self.assertEqual(len(snapshot['items']),1)
        self.assertNotIn('confirmed_by',snapshot['items'][0]); self.assertNotIn('note',snapshot['items'][0])

    def test_approval_alone_is_not_a_closure_and_pending_cannot_be_blocked(self):
        self.assertEqual(self.call('get')['item']['version'],0)
        with self.db.cursor() as c: c.execute("UPDATE reports SET status='pending',is_approved=false")
        self.assertEqual(self.call(expected_report_status='pending')['state'],'invalid')
        self.assertEqual(self.call('active',actor_id=RESIDENT)['items'],[])

    def test_version_conflict_and_audit_are_atomic(self):
        self.assertEqual(self.call()['item']['version'],1)
        self.assertEqual(self.call()['state'],'conflict')
        with self.db.cursor() as c:
            c.execute('SELECT count(*),max(version) FROM routing_impact_events')
            self.assertEqual(c.fetchone(),(1,1))

    def test_clear_removes_closure_without_deleting_audit(self):
        self.call()
        cleared=self.call(expected_version=1,impact='none',center=None,half_width_meters=None,expires_at=None)
        self.assertEqual(cleared['item']['version'],2)
        self.assertEqual(self.call('active',actor_id=RESIDENT)['items'],[])
        with self.db.cursor() as c:
            c.execute('SELECT count(*) FROM routing_impact_events'); self.assertEqual(c.fetchone()[0],2)

    def test_resolution_via_existing_workflow_stops_avoidance(self):
        self.call()
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                for before,after in [('approved','in_progress'),('in_progress','resolved')]:
                    c.execute("SELECT enclave_report_workflow('update',%s::jsonb)",(json.dumps({
                        'actor_id':MANAGER,'ticket_id':'TICK-TEST','expected_status':before,'status':after,
                        'note':'Repair checked','repair_verified':after=='resolved'}),))
                    self.assertEqual(c.fetchone()[0]['state'],'ok')
            finally: c.execute('RESET ROLE')
        self.assertEqual(self.call('active',actor_id=RESIDENT)['items'],[])
        self.assertEqual(self.call(expected_version=1)['state'],'conflict')
        self.assertEqual(self.call(expected_version=1,expected_report_status='resolved')['state'],'invalid')

    def test_expired_and_inconsistent_reports_are_excluded(self):
        self.call()
        with self.db.cursor() as c: c.execute("UPDATE report_routing_impacts SET expires_at=now()-interval '1 second'")
        self.assertEqual(self.call('active',actor_id=RESIDENT)['items'],[])
        with self.db.cursor() as c:
            c.execute("UPDATE report_routing_impacts SET expires_at=now()+interval '1 hour'; UPDATE reports SET is_approved=false")
        self.assertEqual(self.call('active',actor_id=RESIDENT)['items'],[])

    def test_outside_far_and_invalid_expiry_rejected(self):
        for changes in ({'half_width_meters':31},{'center':{'latitude':3.22,'longitude':101.74}},
            {'center':{'latitude':3.139,'longitude':101.687}},
            {'expires_at':(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()},
            {'expires_at':(datetime.now(timezone.utc)+timedelta(days=8)).isoformat()},
            {'expires_at':'garbage'},{'expected_version':True}):
            self.assertEqual(self.call(**changes)['state'],'invalid',changes)

    def test_audit_failure_rolls_back_closure(self):
        with self.db.cursor() as c:
            c.execute('''CREATE OR REPLACE FUNCTION fail_obstacle_fixture() RETURNS trigger LANGUAGE plpgsql AS
                $$ BEGIN RAISE EXCEPTION 'Fixture audit failure'; END; $$;
                CREATE TRIGGER fail_obstacle_audit BEFORE INSERT ON routing_impact_events
                FOR EACH ROW EXECUTE FUNCTION fail_obstacle_fixture()''')
        with self.assertRaises(psycopg2.Error): self.call()
        with self.db.cursor() as c:
            c.execute('SELECT count(*) FROM report_routing_impacts'); self.assertEqual(c.fetchone()[0],0)

    def test_concurrent_confirmations_have_one_winner(self):
        def update(_):
            db=psycopg2.connect(DSN)
            try:
                result=self.call(connection=db); db.commit(); return result['state']
            finally: db.close()
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(update,range(2)))
        self.assertEqual(sorted(results),['conflict','ok'])

    def test_anon_and_authenticated_cannot_execute_rpc_or_read_tables(self):
        for role in ('anon','authenticated'):
            with self.db.cursor() as c:
                c.execute('SET ROLE '+role)
                try:
                    for statement in ("SELECT enclave_routing_obstacles('active','{}')",
                        'SELECT * FROM report_routing_impacts','SELECT * FROM routing_impact_events'):
                        with self.assertRaises(psycopg2.errors.InsufficientPrivilege): c.execute(statement)
                finally: c.execute('RESET ROLE')

    def test_service_role_cannot_edit_or_delete_audit(self):
        self.call()
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                for statement in ('DELETE FROM routing_impact_events','UPDATE routing_impact_events SET version=99'):
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege): c.execute(statement)
            finally: c.execute('RESET ROLE')

    def test_overflow_is_not_silently_truncated_and_migration_is_rerunnable(self):
        self.call()
        with self.db.cursor() as c:
            c.execute(self.migration)
            c.execute('''INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude)
                SELECT 'TICK-'||g,%s,'approved',true,3.22649,101.730755 FROM generate_series(1,100) g;
                INSERT INTO report_routing_impacts(report_id,version,impact,latitude,longitude,
                    half_width_meters,expires_at,note,confirmed_by)
                SELECT id,1,'blocked',3.22649,101.730755,5,now()+interval '1 hour','Fixture',%s
                FROM reports WHERE ticket_id<>'TICK-TEST';''',(RESIDENT,MANAGER))
        self.assertEqual(self.call('active',actor_id=RESIDENT)['state'],'too_many')
