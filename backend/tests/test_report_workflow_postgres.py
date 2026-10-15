"""Real transaction/permission tests; only an explicitly disposable loopback DB."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import unittest

import psycopg2
from psycopg2.extensions import parse_dsn


MANAGER = '00000000-0000-4000-8000-000000000001'
OWNER = '00000000-0000-4000-8000-000000000002'
OTHER = '00000000-0000-4000-8000-000000000003'
INACTIVE = '00000000-0000-4000-8000-000000000004'
DSN = os.environ.get('ENCLAVE_TEST_PG_DSN')


@unittest.skipUnless(DSN, 'Requires a dedicated temporary PostgreSQL cluster')
class ReportWorkflowPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info = parse_dsn(DSN)
        if info.get('host') != '127.0.0.1' or info.get('dbname') != 'enclave_workflow_test':
            raise RuntimeError('Refusing to use any existing or hosted database')
        cls.db = psycopg2.connect(DSN)
        cls.db.autocommit = True
        with cls.db.cursor() as c:
            c.execute('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
                CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text NOT NULL);
                CREATE TABLE public.residents(profile_id uuid, status text, verified_at timestamptz);
                CREATE TABLE public.reports(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    ticket_id text, user_id uuid REFERENCES profiles(id), description text, status text,
                    created_at timestamptz DEFAULT now(), image_url text, category text, priority text,
                    latitude float8, longitude float8, is_approved boolean DEFAULT false);
                ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
                INSERT INTO profiles VALUES (%s,'management'),(%s,'resident'),(%s,'resident'),(%s,'resident');
                INSERT INTO residents VALUES (%s,'active',now()),(%s,'active',now()),(%s,'inactive',now());''',
                (MANAGER, OWNER, OTHER, INACTIVE, OWNER, OTHER, INACTIVE))
            cls.migration = (Path(__file__).resolve().parents[1] / 'sql/007_report_workflow.sql').read_text(encoding='utf-8')
            c.execute(cls.migration)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        with self.db.cursor() as c:
            c.execute('''DROP TRIGGER IF EXISTS fail_audit ON report_status_events;
                TRUNCATE report_status_events, reports RESTART IDENTITY;
                INSERT INTO reports(ticket_id,user_id,description,status,latitude,longitude,is_approved)
                VALUES ('TICK-TEST',%s,'Fixture report','pending',3.139,101.687,false)''', (OWNER,))

    def call(self, action='update', actor=MANAGER, connection=None, **args):
        values = dict(actor_id=actor, ticket_id='TICK-TEST', expected_status='pending', status='approved',
                      note='Inspected on site', repair_verified=False, limit=20, offset=0)
        values.update(args)
        with (connection or self.db).cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT public.enclave_report_workflow(%s,%s::jsonb)', (action, json.dumps(values)))
                return c.fetchone()[0]
            finally:
                if connection is None:
                    c.execute('RESET ROLE')

    def test_full_workflow_changes_map_visibility_and_records_actor(self):
        def visible(include_resolved=False):
            with self.db.cursor() as c:
                c.execute("SELECT ticket_id FROM reports WHERE is_approved AND status = ANY(%s)",
                          (['approved','in_progress'] + (['resolved'] if include_resolved else []),))
                return len(c.fetchall())
        self.assertEqual(visible(), 0)
        for before, after in [('pending','approved'),('approved','in_progress'),('in_progress','resolved')]:
            result = self.call(expected_status=before, status=after, repair_verified=after == 'resolved')
            self.assertEqual(result['state'], 'ok')
            self.assertEqual(result['event']['changed_by'], MANAGER)
            self.assertEqual(result['event']['from_status'], before)
            self.assertEqual(result['report']['status'], after)
            self.assertEqual(visible(), int(after != 'resolved'))
        self.assertEqual(visible(True), 1)
        history = self.call('history', actor=OWNER)
        self.assertEqual(len(history['items']), 3)
        self.assertTrue(all(e['changed_by'] is None for e in history['items']))
        self.assertTrue(all(e['created_at'] for e in history['items']))

    def test_resident_cannot_moderate_or_list(self):
        for action in ('list','update'):
            self.assertEqual(self.call(action, actor=OWNER)['state'], 'forbidden')

    def test_history_restricts_ownership_and_active_residency(self):
        self.assertEqual(self.call('history', actor=OTHER)['state'], 'not_found')
        self.assertEqual(self.call('history', actor=INACTIVE)['state'], 'forbidden')
        self.assertEqual(self.call('history', actor=OWNER)['items'], [])
        self.call()
        self.assertEqual(self.call('history')['items'][0]['changed_by'], MANAGER)

    def test_stale_update_does_not_duplicate_audit(self):
        self.assertEqual(self.call()['state'], 'ok')
        self.assertEqual(self.call()['state'], 'conflict')
        self.assertEqual(len(self.call('history')['items']), 1)

    def test_resolve_needs_verification_and_cannot_skip_states(self):
        self.assertEqual(self.call(status='resolved', repair_verified=True)['state'], 'invalid')
        self.call()
        self.call(expected_status='approved', status='in_progress')
        self.assertEqual(self.call(expected_status='in_progress', status='resolved')['state'], 'invalid')
        self.assertEqual(self.call(expected_status='in_progress', status='resolved', repair_verified=True)['state'], 'ok')

    def test_rejected_is_terminal_and_hidden(self):
        self.assertEqual(self.call(status='rejected')['state'], 'ok')
        self.assertEqual(self.call(expected_status='rejected')['state'], 'invalid')
        with self.db.cursor() as c:
            c.execute('SELECT status,is_approved FROM reports')
            self.assertEqual(c.fetchone(), ('rejected',False))

    def test_audit_failure_rolls_back_report_update(self):
        with self.db.cursor() as c:
            c.execute('''CREATE OR REPLACE FUNCTION public.fail_audit_fixture() RETURNS trigger
                LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture audit failure'; END; $$;
                CREATE TRIGGER fail_audit BEFORE INSERT ON report_status_events
                FOR EACH ROW EXECUTE FUNCTION public.fail_audit_fixture()''')
        with self.assertRaises(psycopg2.Error):
            self.call()
        with self.db.cursor() as c:
            c.execute("SELECT status,is_approved FROM reports")
            self.assertEqual(c.fetchone(), ('pending',False))
            c.execute('SELECT count(*) FROM report_status_events')
            self.assertEqual(c.fetchone()[0],0)

    def test_concurrent_approvals_only_one_event(self):
        def update():
            connection = psycopg2.connect(DSN)
            try:
                result = self.call(connection=connection)
                connection.commit()
                return result['state']
            finally:
                connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            states = list(pool.map(lambda _: update(), range(2)))
        self.assertEqual(sorted(states), ['conflict','ok'])
        self.assertEqual(len(self.call('history')['items']),1)

    def test_authenticated_and_anon_cannot_execute_rpc_or_read_audit(self):
        for role in ('anon','authenticated'):
            with self.db.cursor() as c:
                c.execute('SET ROLE ' + role)
                try:
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                        c.execute("SELECT public.enclave_report_workflow('list','{}')")
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                        c.execute('SELECT * FROM public.report_status_events')
                finally:
                    c.execute('RESET ROLE')

    def test_audit_not_editable_by_service_role(self):
        self.call()
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                for operation in ('UPDATE report_status_events SET note=\'changed\'', 'DELETE FROM report_status_events'):
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                        c.execute(operation)
            finally:
                c.execute('RESET ROLE')

    def test_filter_pagination_unknown_report_and_inconsistent_approval(self):
        self.assertEqual(self.call('list', status='approved')['items'], [])
        self.assertEqual(self.call('list', status='pending', limit=1)['has_more'], False)
        self.assertEqual(self.call(ticket_id='missing')['state'], 'not_found')
        self.assertEqual(self.call('list', status='pending', limit=0)['state'], 'invalid')
        with self.db.cursor() as c:
            c.execute('UPDATE reports SET is_approved=true')
        self.assertEqual(self.call()['state'],'conflict')

    def test_duplicate_ticket_ids_rejected_and_migration_rerunnable(self):
        with self.db.cursor() as c:
            with self.assertRaises(psycopg2.errors.UniqueViolation):
                c.execute("INSERT INTO reports(ticket_id) VALUES ('TICK-TEST')")
            c.execute(self.migration)
        self.assertEqual(self.call()['state'], 'ok')
