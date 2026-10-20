"""SQL 010 privileges, role authorization, threshold and non-mutation on disposable PG."""

import json
import os
from pathlib import Path
import unittest

import psycopg2
from psycopg2.extensions import parse_dsn

DSN = os.environ.get('ENCLAVE_TEST_PG_DSN')
MANAGER = '00000000-0000-4000-8000-000000000003'
RESIDENT = '00000000-0000-4000-8000-000000000001'
F1 = '10000000-0000-4000-8000-000000000001'
I1 = '20000000-0000-4000-8000-000000000001'


@unittest.skipUnless(DSN, 'Requires dedicated disposable local PostgreSQL')
class WhatIfPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info = parse_dsn(DSN)
        if info.get('host') != '127.0.0.1' or info.get('dbname') != 'enclave_what_if_test':
            raise RuntimeError('Refusing existing or hosted databases')
        cls.db = psycopg2.connect(DSN)
        cls.db.autocommit = True
        with cls.db.cursor() as cursor:
            cursor.execute('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
                CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
                CREATE TABLE residents(profile_id uuid,status text,verified_at timestamptz);
                CREATE TABLE reports(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ticket_id text,
                    user_id uuid REFERENCES profiles(id),status text,is_approved boolean,latitude float8,longitude float8,
                    description text,category text,priority text,image_url text,created_at timestamptz DEFAULT clock_timestamp());
                ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
                INSERT INTO profiles VALUES (%s,'management'),(%s,'resident'),
                    ('00000000-0000-4000-8000-000000000002','resident');''', (MANAGER, RESIDENT))
            folder = Path(__file__).resolve().parents[1] / 'sql'
            for name in ['007_report_workflow.sql', '009_community_issue_points.sql', '010_management_what_if_snapshot.sql', '018_what_if_candidate_review.sql']:
                cursor.execute((folder / name).read_text(encoding='utf-8'))

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        with self.db.cursor() as cursor:
            cursor.execute('''TRUNCATE community_issue_reports,community_issues,community_facilities,
                report_status_events,reports RESTART IDENTITY;
                INSERT INTO community_facilities(id,name,facility_type,latitude,longitude,created_by)
                VALUES (%s,'Synthetic walkway','path_surface',3.2254,101.7306,%s);
                INSERT INTO community_issues(id,facility_id,fault_kind) VALUES (%s,%s,'damage');
                INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude,description)
                VALUES ('A',%s,'pending',false,3.2254,101.7306,'PRIVATE'),
                       ('B','00000000-0000-4000-8000-000000000002','pending',false,3.2254,101.7306,'PRIVATE');
                INSERT INTO community_issue_reports(issue_id,user_id,report_id)
                SELECT %s,user_id,id FROM reports;''', (F1, MANAGER, I1, F1, RESIDENT, I1))

    def call(self, actor=MANAGER):
        with self.db.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            try:
                cursor.execute('SELECT enclave_what_if_snapshot(%s::uuid)', (actor,))
                return cursor.fetchone()[0]
            finally:
                cursor.execute('RESET ROLE')

    def test_management_without_resident_binding_can_read_and_resident_cannot(self):
        self.assertEqual(self.call()['state'], 'ok')
        self.assertEqual(self.call(RESIDENT)['state'], 'forbidden')
        self.assertEqual(self.call(None)['state'], 'forbidden')

    def test_contains_only_two_distinct_reporter_open_incidents(self):
        item = self.call()['issues'][0]
        self.assertEqual(item['reporter_count'], 2)
        with self.db.cursor() as cursor:
            cursor.execute('DELETE FROM community_issue_reports WHERE user_id=%s', (RESIDENT,))
        self.assertEqual(self.call()['issues'], [])

    def test_snapshot_does_not_modify_live_states_or_expose_private_evidence(self):
        with self.db.cursor() as cursor:
            cursor.execute("SELECT jsonb_agg(to_jsonb(r)) FROM reports r")
            before = cursor.fetchone()[0]
        result = self.call()
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn(RESIDENT, json.dumps(result))
        self.assertNotIn('ticket_id', result['issues'][0])
        with self.db.cursor() as cursor:
            cursor.execute("SELECT jsonb_agg(to_jsonb(r)) FROM reports r")
            self.assertEqual(cursor.fetchone()[0], before)
            cursor.execute('SELECT status FROM community_issues')
            self.assertEqual(cursor.fetchone()[0], 'open')
            cursor.execute('SELECT count(*) FROM report_status_events')
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_resolved_issue_is_not_a_repair_candidate(self):
        with self.db.cursor() as cursor:
            cursor.execute("UPDATE community_issues SET status='resolved',resolved_at=now()")
        self.assertEqual(self.call()['issues'], [])

    def test_nonroad_candidate_is_preserved_for_zero_route_impact(self):
        with self.db.cursor() as cursor:
            cursor.execute("UPDATE community_facilities SET facility_type='bench'")
        self.assertFalse(self.call()['issues'][0]['affects_routes'])

    def test_pending_review_target_is_stable_and_moves_past_rejected_evidence(self):
        self.assertEqual(self.call()['issues'][0]['review_ticket_id'], 'A')
        with self.db.cursor() as cursor:
            cursor.execute("UPDATE reports SET status='rejected' WHERE ticket_id='A'")
        self.assertEqual(self.call()['issues'][0]['review_ticket_id'], 'B')
        with self.db.cursor() as cursor:
            cursor.execute("UPDATE reports SET status='rejected'")
        self.assertIsNone(self.call()['issues'][0]['review_ticket_id'])

    def test_any_approved_evidence_disqualifies_issue_but_keeps_open_obstacle(self):
        for status in ('approved', 'in_progress', 'resolved'):
            with self.subTest(status=status):
                with self.db.cursor() as cursor:
                    cursor.execute("UPDATE reports SET status=%s WHERE ticket_id='B'", (status,))
                item = self.call()['issues'][0]
                self.assertIsNone(item['review_ticket_id'])
                self.assertEqual(item['status'], 'open')
                self.assertEqual(item['reporter_count'], 2)
        with self.db.cursor() as cursor:
            cursor.execute("UPDATE reports SET status='pending',is_approved=true WHERE ticket_id='B'")
        self.assertIsNone(self.call()['issues'][0]['review_ticket_id'])

    def test_approval_history_disqualifies_even_if_report_state_was_reset(self):
        with self.db.cursor() as cursor:
            cursor.execute("""INSERT INTO report_status_events(report_id,from_status,to_status,changed_by,note)
                SELECT id,'pending','approved',%s,'Synthetic review' FROM reports WHERE ticket_id='A'""", (MANAGER,))
        self.assertIsNone(self.call()['issues'][0]['review_ticket_id'])

    def test_browser_roles_cannot_execute_or_read_candidate_tables(self):
        for role in ['anon', 'authenticated']:
            with self.db.cursor() as cursor:
                cursor.execute('SET ROLE ' + role)
                try:
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                        cursor.execute('SELECT enclave_what_if_snapshot(%s::uuid)', (MANAGER,))
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                        cursor.execute('SELECT * FROM community_issue_reports')
                finally:
                    cursor.execute('RESET ROLE')

    def test_capacity_fails_closed_and_migration_is_rerunnable(self):
        with self.db.cursor() as cursor:
            cursor.execute('''INSERT INTO community_facilities(id,name,facility_type,latitude,longitude,created_by)
                SELECT gen_random_uuid(),'Asset '||n,'path_surface',3.2254,101.7306,%s::uuid
                FROM generate_series(1,100) n;
                INSERT INTO community_issues(facility_id,fault_kind)
                SELECT id,'damage' FROM community_facilities WHERE id<>%s::uuid;
                INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude)
                SELECT 'X-'||n,%s::uuid,'pending',false,3.2254,101.7306 FROM generate_series(1,200) n;
                WITH ranked AS (SELECT id,row_number() over(order by id) AS n FROM community_issues WHERE id<>%s::uuid),
                evidence AS (SELECT id,row_number() over(order by id) AS n FROM reports WHERE ticket_id LIKE 'X-%%')
                INSERT INTO community_issue_reports(issue_id,user_id,report_id)
                SELECT r.id,CASE WHEN e.n%%2=0 THEN %s::uuid ELSE '00000000-0000-4000-8000-000000000002'::uuid END,e.id
                FROM ranked r JOIN evidence e ON (e.n+1)/2=r.n;''', (MANAGER, F1, RESIDENT, I1, RESIDENT))
        self.assertEqual(self.call()['state'], 'too_many')
        migration = Path(__file__).resolve().parents[1] / 'sql/018_what_if_candidate_review.sql'
        with self.db.cursor() as cursor:
            cursor.execute(migration.read_text(encoding='utf-8'))
        self.assertEqual(self.call()['state'], 'too_many')
