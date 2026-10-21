"""Blocker replies, due dates, permissions and audit atomicity on local PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest
from backend.tests import test_maintenance_postgres as fixture
from backend.tests.test_shared_report_workflow_postgres import SharedReportWorkflowTests

@unittest.skipUnless(fixture.DSN,'Requires disposable local maintenance PostgreSQL')
class BlockerFeedbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SharedReportWorkflowTests.setUpClass.__func__(cls)
        cls.feedback_migration=(Path(__file__).resolve().parents[1]/'sql/025_maintenance_blocker_feedback.sql').read_text(encoding='utf-8')
        with cls.db.cursor() as cursor:cursor.execute(cls.feedback_migration)
    @classmethod
    def tearDownClass(cls):cls.db.close()
    sql=fixture.MaintenanceTests.sql
    call=fixture.MaintenanceTests.call
    http=fixture.MaintenanceTests.http
    create_task=fixture.MaintenanceTests.create_task
    start_task=fixture.MaintenanceTests.start_task
    submit=fixture.MaintenanceTests.submit
    def setUp(self):
        fixture.MaintenanceTests.setUp(self)
    def blocked(self,team=False):
        task=self.start_task(self.create_task(team))
        result=self.call('task_blocker',fixture.WORKER,task_id=task['id'],expected_version=task['version'],notes='Waiting for replacement parts',blocker_type='parts')
        self.assertEqual(result['state'],'ok',result)
        task=result['task'];self.assertEqual(task['pending_blocker_count'],1)
        self.assertEqual(task['pending_blocker']['note'],'parts: Waiting for replacement parts')
        return task
    def respond(self,task,actor=fixture.MANAGER,**overrides):
        args=dict(expected_version=task['version'],blocker_event_id=task['pending_blocker']['id'],notes='Replacement parts ordered. Continue safe work.',change_due_date=False)
        args.update(overrides)
        return self.http('POST',f"/api/v1/management/maintenance/tasks/{task['id']}/blocker-feedback",actor,json=args)
    def test_feedback_keeps_date_and_notifies_worker_with_permanent_history(self):
        task=self.blocked();result=self.respond(task)
        self.assertEqual(result.status_code,200,result.text);updated=result.json()
        self.assertEqual(updated['target_date'],task['target_date']);self.assertEqual(updated['version'],task['version']+1)
        self.assertEqual(updated['status'],task['status']);self.assertIsNone(updated['pending_blocker'])
        self.assertEqual(updated['pending_blocker_count'],0)
        history=self.call('task_history',fixture.WORKER,task_id=task['id'])['items']
        self.assertTrue(any(e['action']=='blocker' for e in history))
        reply=next(e for e in history if e['action']=='blocker_feedback')
        self.assertIn('Due date unchanged: 2026-12-31',reply['note']);self.assertEqual(reply['actor_role'],'management')
        notices=self.call('notifications',fixture.WORKER)['items']
        self.assertTrue(any(n['title']=='Management replied to blocker' for n in notices))
        self.assertFalse(any(n['title']=='Management replied to blocker' for n in self.call('notifications',fixture.OTHER)['items']))
    def test_new_date_is_persisted_for_the_shared_task_and_grouped_reports(self):
        facility=str(self.sql('SELECT id FROM community_facilities',fetch=True)[0][0])
        self.sql("UPDATE reports SET category='Damaged Facility',location_id=%s WHERE ticket_id='TICK-1'",(facility,))
        self.sql("INSERT INTO reports(ticket_id,user_id,description,status,is_approved,category,location_id,latitude,longitude) VALUES('TICK-2',%s,'Same issue','approved',true,'Damaged Facility',%s,3.22649,101.730755)",(fixture.RESIDENT,facility))
        task=self.blocked(team=True)
        response=self.respond(task,change_due_date=True,target_date='2027-01-05')
        self.assertEqual(response.status_code,200,response.text);updated=response.json()
        self.assertEqual(updated['target_date'],'2027-01-05')
        self.assertIn('TICK-2',updated['related_ticket_ids'])
        self.assertEqual(self.sql('SELECT count(*) FROM maintenance_tasks',fetch=True)[0][0],1)
        self.assertEqual(self.call('task_get',fixture.WORKER,task_id=task['id'])['task']['target_date'],'2027-01-05')
    def test_only_managers_can_respond_and_dates_feedback_are_validated(self):
        task=self.blocked()
        for actor in (fixture.WORKER,fixture.RESIDENT,fixture.DISABLED):self.assertEqual(self.respond(task,actor).status_code,403)
        for values in ({'notes':' '},{'change_due_date':True},{'change_due_date':False,'target_date':'2027-01-05'},
                       {'change_due_date':True,'target_date':'invalid'},{'expected_version':True},{'blocker_event_id':True}):
            self.assertEqual(self.respond(task,**values).status_code,422)
        self.assertEqual(self.respond(task,change_due_date=True,target_date=task['target_date']).status_code,422)
        self.assertEqual(self.call('management_get',task_id=task['id'])['task']['version'],task['version'])
        self.assertEqual(self.respond(task,blocker_event_id=999999).status_code,404)
    def test_multiple_blockers_each_need_a_reply_and_stale_requests_cannot_change_dates(self):
        first=self.blocked()
        second=self.call('task_blocker',fixture.WORKER,task_id=first['id'],expected_version=first['version'],notes='Also need access',blocker_type='access')['task']
        self.assertEqual(second['pending_blocker_count'],2)
        self.assertEqual(self.respond(first,change_due_date=True,target_date='2027-01-10').status_code,409)
        replied=self.respond(second).json();self.assertEqual(replied['pending_blocker_count'],1)
        self.assertNotEqual(replied['pending_blocker']['id'],first['pending_blocker']['id'])
        self.assertEqual(self.respond(replied,blocker_event_id=first['pending_blocker']['id']).status_code,409)
        self.assertEqual(self.respond(replied).json()['pending_blocker_count'],0)
    def test_concurrent_replies_commit_only_one_date_and_notification(self):
        task=self.blocked();values=dict(task_id=task['id'],expected_version=task['version'],blocker_event_id=task['pending_blocker']['id'],notes='Parts arranged',change_due_date=True,target_date='2027-01-05')
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.call('task_blocker_feedback',**values),range(2)))
        self.assertEqual(sorted(r['state'] for r in results),['conflict','ok'])
        self.assertEqual(self.sql("SELECT count(*) FROM maintenance_task_events WHERE action='blocker_feedback'",fetch=True)[0][0],1)
    def test_a_failed_event_insert_rolls_back_feedback_due_date_and_notifications(self):
        task=self.blocked()
        self.sql("CREATE OR REPLACE FUNCTION fail_feedback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='blocker_feedback' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_maintenance_event BEFORE INSERT ON maintenance_task_events FOR EACH ROW EXECUTE FUNCTION fail_feedback()")
        self.assertEqual(self.respond(task,change_due_date=True,target_date='2027-01-05').status_code,503)
        unchanged=self.call('management_get',task_id=task['id'])['task']
        self.assertEqual(unchanged['version'],task['version']);self.assertEqual(unchanged['target_date'],task['target_date'])
        self.assertEqual(unchanged['pending_blocker_count'],1)
        self.assertEqual(self.sql('SELECT count(*) FROM maintenance_blocker_responses',fetch=True)[0][0],0)
    def test_migration_is_repeatable_and_browser_roles_cannot_access_private_responses(self):
        task=self.blocked();self.sql(self.feedback_migration)
        self.assertEqual(self.call('management_get',task_id=task['id'])['task']['pending_blocker_count'],1)
        for role in ('anon','authenticated'):
            self.assertFalse(self.sql("SELECT has_table_privilege(%s,'maintenance_blocker_responses','INSERT')",(role,),fetch=True)[0][0])
            self.assertFalse(self.sql("SELECT has_function_privilege(%s,'enclave_maintenance_workflow(text,jsonb)','EXECUTE')",(role,),fetch=True)[0][0])
    test_existing_completion_workflow=fixture.MaintenanceTests.test_full_workflow_photo_review_resolves_report_and_map_together
