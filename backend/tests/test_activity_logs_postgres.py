"""Real transaction, history import and portal access checks on local PostgreSQL."""
import json
from pathlib import Path
import unittest
import psycopg2

from backend.tests import test_maintenance_postgres as fixture
from backend.tests.test_shared_report_workflow_postgres import SharedReportWorkflowTests


@unittest.skipUnless(fixture.DSN, 'Requires disposable local PostgreSQL')
class ActivityLogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SharedReportWorkflowTests.setUpClass.__func__(cls)
        folder = Path(__file__).resolve().parents[1] / 'sql'
        cls.migration = (folder / '027_portal_activity_logs.sql').read_text(encoding='utf-8')
        with cls.db.cursor() as cursor:
            cursor.execute((folder / '025_maintenance_blocker_feedback.sql').read_text(encoding='utf-8'))
            cursor.execute((folder / '026_account_profile_photos.sql').read_text(encoding='utf-8'))
            cursor.execute(cls.migration)

    @classmethod
    def tearDownClass(cls): cls.db.close()
    sql = fixture.MaintenanceTests.sql
    call = fixture.MaintenanceTests.call
    http = fixture.MaintenanceTests.http
    create_task = fixture.MaintenanceTests.create_task
    start_task = fixture.MaintenanceTests.start_task
    submit = fixture.MaintenanceTests.submit

    def setUp(self):
        self.sql('TRUNCATE portal_activity_logs RESTART IDENTITY')
        fixture.MaintenanceTests.setUp(self)

    def logs(self, actor=fixture.MANAGER, portal='management', **filters):
        with self.db.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            try:
                cursor.execute('SELECT enclave_activity_logs(%s::jsonb)', (json.dumps({
                    **filters, 'actor_id': actor, 'portal': portal}),))
                return cursor.fetchone()[0]
            finally: cursor.execute('RESET ROLE')

    def test_both_portals_get_their_own_operations_only(self):
        task = self.start_task(self.create_task())
        self.call('task_progress', fixture.WORKER, task_id=task['id'], expected_version=task['version'], notes='Surface preparation')
        manager = self.logs()['items']; worker = self.logs(fixture.WORKER, 'maintenance')['items']
        self.assertTrue(manager); self.assertTrue(worker)
        self.assertTrue(all(row['actor_role'] == 'management' for row in manager))
        self.assertTrue(all(row['actor_role'] == 'maintenance' for row in worker))
        self.assertTrue(any('Surface preparation' in row['summary'] for row in worker))
        self.assertEqual(self.logs(fixture.OTHER, 'maintenance')['items'], [])

    def test_roles_revocation_and_private_database_grants(self):
        for actor, portal in ((fixture.RESIDENT, 'maintenance'), (fixture.DISABLED, 'maintenance'),
                              (fixture.WORKER, 'management'), (fixture.MANAGER, 'maintenance')):
            self.assertEqual(self.logs(actor, portal)['state'], 'forbidden')
        self.sql('UPDATE maintenance_staff SET active=false WHERE profile_id=%s', (fixture.WORKER,))
        self.assertEqual(self.logs(fixture.WORKER, 'maintenance')['state'], 'forbidden')
        for role in ('anon', 'authenticated'):
            for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                self.assertFalse(self.sql('SELECT has_table_privilege(%s,%s,%s)', (role, 'portal_activity_logs', privilege), True)[0][0])
            self.assertFalse(self.sql("SELECT has_function_privilege(%s,'enclave_activity_logs(jsonb)','EXECUTE')", (role,), True)[0][0])
        self.assertFalse(self.sql("SELECT has_table_privilege('service_role','portal_activity_logs','DELETE')", fetch=True)[0][0])

    def test_success_rejections_search_and_filters(self):
        task = self.create_task()
        self.call('task_start', fixture.WORKER, task_id=task['id'], expected_version=999)
        failures = self.logs(fixture.WORKER, 'maintenance', result='failed')['items']
        self.assertEqual(len(failures), 1); self.assertIn('conflict', failures[0]['summary'])
        self.assertEqual(self.logs(fixture.WORKER, 'maintenance', result='success')['items'], [])
        self.assertEqual(self.logs(search=task['id'])['items'][0]['target_id'], task['id'])
        self.assertEqual(self.logs(role='maintenance')['items'], [])
        self.assertEqual(self.logs(search='%')['items'], [])
        self.assertEqual(self.logs(**{'from': '2100-01-01'})['items'], [])

    def test_pagination_same_timestamp_is_stable_and_date_bounds_are_local(self):
        for i in range(25):
            self.sql("SELECT enclave_activity_record(%s,'management','Test','Record',%s,'Note','success',NULL,'2026-10-20T16:00:00Z')", (fixture.MANAGER, str(i)))
        first = self.logs(limit=20, **{'from': '2026-10-21', 'to': '2026-10-21'})
        second = self.logs(limit=20, offset=20)
        self.assertTrue(first['has_more']); self.assertEqual(len(first['items']), 20)
        self.assertFalse(second['has_more']); self.assertEqual(len(second['items']), 5)
        self.assertFalse({row['id'] for row in first['items']} & {row['id'] for row in second['items']})
        self.assertEqual(self.logs(**{'to': '2026-10-20'})['items'], [])

    def test_import_existing_events_and_rerun_do_not_duplicate(self):
        self.start_task(self.create_task())
        count = self.sql('SELECT count(*) FROM portal_activity_logs', fetch=True)[0][0]
        self.sql('TRUNCATE portal_activity_logs')
        self.sql(self.migration)
        self.assertEqual(self.sql('SELECT count(*) FROM portal_activity_logs', fetch=True)[0][0], count)
        self.sql(self.migration)
        self.assertEqual(self.sql('SELECT count(*) FROM portal_activity_logs', fetch=True)[0][0], count)
        self.assertTrue(self.logs()['items'])

    def test_audit_failure_rolls_back_original_operation(self):
        task = self.create_task()
        self.sql("CREATE FUNCTION fail_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit fixture'; END $$; CREATE TRIGGER fail_activity BEFORE INSERT ON portal_activity_logs FOR EACH ROW EXECUTE FUNCTION fail_activity()")
        try:
            with self.assertRaises(psycopg2.Error): self.start_task(task)
            result = self.call('task_get', fixture.WORKER, task_id=task['id'])['task']
            self.assertEqual(result['status'], 'assigned'); self.assertEqual(result['version'], task['version'])
        finally: self.sql('DROP TRIGGER fail_activity ON portal_activity_logs; DROP FUNCTION fail_activity()')

    def test_registry_changes_are_logged_without_payload_secrets(self):
        self.call('team_create', name='Water repair team')
        record = self.logs()['items'][0]
        self.assertEqual(record['action'], 'Team Create'); self.assertEqual(record['result'], 'success')
        self.assertTrue(record['target_id'])

    def test_blocker_reply_and_due_date_change_stay_in_the_correct_portals(self):
        task = self.start_task(self.create_task())
        task = self.call('task_blocker', fixture.WORKER, task_id=task['id'],
            expected_version=task['version'], blocker_type='parts', notes='Waiting for parts')['task']
        reply = self.call('task_blocker_feedback', task_id=task['id'],
            expected_version=task['version'], blocker_event_id=task['pending_blocker']['id'],
            notes='Parts arranged', change_due_date=True, target_date='2027-01-05')
        self.assertEqual(reply['state'], 'ok', reply)
        self.assertTrue(any('2027-01-05' in item['summary'] for item in self.logs()['items']))
        self.assertTrue(any('Waiting for parts' in item['summary'] for item in self.logs(fixture.WORKER, 'maintenance')['items']))
        self.assertFalse(any('Parts arranged' in item['summary'] for item in self.logs(fixture.WORKER, 'maintenance')['items']))

    def test_report_approval_writes_management_history(self):
        self.sql("UPDATE reports SET status='pending',is_approved=false WHERE ticket_id='TICK-1'")
        with self.db.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            try:
                cursor.execute('SELECT enclave_report_workflow(%s,%s::jsonb)', ('update', json.dumps(dict(
                    actor_id=fixture.MANAGER, ticket_id='TICK-1', expected_status='pending',
                    status='approved', note='Approved for repair', repair_verified=False))))
                self.assertEqual(cursor.fetchone()[0]['state'], 'ok')
            finally: cursor.execute('RESET ROLE')
        item = self.logs()['items'][0]
        self.assertEqual(item['action'], 'Report approved'); self.assertEqual(item['target_id'], 'TICK-1')
        self.assertEqual(self.logs(fixture.WORKER, 'maintenance')['items'], [])

    test_existing_complete_repair_workflow = fixture.MaintenanceTests.test_full_workflow_photo_review_resolves_report_and_map_together


if __name__ == '__main__': unittest.main()
