"""Shared category/incident review and one maintenance task on real PostgreSQL."""
import json
from pathlib import Path
import unittest
from backend.tests import test_maintenance_postgres as fixture

@unittest.skipUnless(fixture.DSN,'Requires disposable local maintenance PostgreSQL')
class SharedReportWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture.MaintenanceTests.setUpClass.__func__(cls)
        folder=Path(__file__).resolve().parents[1]/'sql'
        with cls.db.cursor() as c:
            c.execute("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$")
            for name in ['015_map_places.sql','016_map_places_seed.sql','010_management_what_if_snapshot.sql','018_what_if_candidate_review.sql','019_road_section_reporting.sql','020_shared_map_locations.sql','021_shared_map_locations_seed.sql','021b_shared_map_locations_seed.sql','021c_shared_map_locations_finalize.sql','022_resident_place_reporting.sql','023_shared_facility_report_workflow.sql']:
                c.execute((folder/name).read_text(encoding='utf-8'))
        cls.group_migration=(folder/'023_shared_facility_report_workflow.sql').read_text(encoding='utf-8')
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
        self.sql("UPDATE reports SET status='pending',is_approved=false,category='Damaged Facility' WHERE ticket_id='TICK-1'")
        self.facility=str(self.sql('SELECT id FROM community_facilities',fetch=True)[0][0])
        self.add_report('TICK-2')
    def add_report(self,ticket,category='Damaged Facility',link=False):
        self.sql("INSERT INTO reports(ticket_id,user_id,status,is_approved,category,latitude,longitude,location_id,description) VALUES(%s,%s,'pending',false,%s,3.22649,101.730755,%s,'Reported facility problem')",(ticket,fixture.RESIDENT,category,self.facility))
        if link:
            with self.db.cursor() as c:
                c.execute('SET ROLE service_role')
                try:
                    c.execute('SELECT enclave_community_issues(%s,%s::jsonb)',('open_issue',json.dumps(dict(actor_id=fixture.RESIDENT,facility_id=self.facility,report_ticket_id=ticket,fault_kind='damage'))))
                    result=c.fetchone()[0];self.assertEqual(result['state'],'ok',result)
                finally:c.execute('RESET ROLE')
    def review(self,ticket='TICK-1',status='approved',expected='pending'):
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT enclave_report_workflow(%s,%s::jsonb)',('update',json.dumps(dict(actor_id=fixture.MANAGER,ticket_id=ticket,status=status,expected_status=expected,note='Repair review confirmed.',repair_verified=status=='resolved'))))
                return c.fetchone()[0]
            finally:c.execute('RESET ROLE')
    def states(self):return dict(self.sql('SELECT ticket_id,status FROM reports ORDER BY id',fetch=True))
    def test_approval_syncs_same_category_but_not_other_categories(self):
        self.add_report('OTHER-CATEGORY','Streetlight')
        self.assertEqual(self.review()['state'],'ok');self.assertEqual(self.states(),{'TICK-1':'approved','TICK-2':'approved','OTHER-CATEGORY':'pending'})
        self.assertEqual(self.sql("SELECT count(*) FROM report_status_events WHERE to_status='approved'",fetch=True)[0][0],2)
    def test_one_task_covers_all_reports_start_evidence_rework_and_verified_resolution(self):
        self.review();task=self.create_task()
        same=self.call('task_create',ticket_id='TICK-2')['task'];self.assertEqual(same['id'],task['id']);self.assertEqual(set(same['related_ticket_ids']),{'TICK-1','TICK-2'})
        self.assertEqual(self.sql('SELECT count(*) FROM maintenance_tasks',fetch=True)[0][0],1)
        self.assertEqual(self.review('TICK-2','resolved','approved')['state'],'conflict')
        task=self.start_task(task);self.assertEqual(set(self.states().values()),{'in_progress'})
        task=self.submit(task);self.assertEqual(task['status'],'awaiting_verification')
        task=self.call('task_review',task_id=task['id'],expected_version=task['version'],decision='rework',note='More evidence',repair_verified=False)['task']
        self.assertEqual(task['status'],'changes_requested');self.assertEqual(set(self.states().values()),{'in_progress'})
        task=self.submit(task)
        result=self.call('task_review',task_id=task['id'],expected_version=task['version'],decision='approve',note='Checked on site',public_note='Repair complete.',repair_verified=True)
        self.assertEqual(result['state'],'ok',result);self.assertEqual(set(self.states().values()),{'resolved'})
        self.assertEqual(self.sql('SELECT status FROM community_issues',fetch=True)[0][0],'resolved')
        self.add_report('NEW-ROUND',link=True);self.assertEqual(self.states()['NEW-ROUND'],'pending')
        self.assertEqual(self.sql("SELECT count(*) FROM community_issues WHERE status='open'",fetch=True)[0][0],1)
    def test_late_report_during_work_inherits_approval_and_current_status(self):
        self.review();self.start_task(self.create_task());self.add_report('LATE',link=True)
        self.assertEqual(self.states()['LATE'],'in_progress')
        history=self.sql("SELECT from_status,to_status FROM report_status_events e JOIN reports r ON r.id=e.report_id WHERE r.ticket_id='LATE' ORDER BY e.id",fetch=True)
        self.assertEqual(history,[('pending','approved'),('approved','in_progress')])
    def test_other_facility_and_rejected_report_are_not_auto_approved(self):
        self.add_report('REJECTED');self.sql("UPDATE reports SET status='rejected' WHERE ticket_id='REJECTED'")
        self.sql("INSERT INTO community_facilities(name,facility_type,latitude,longitude,created_by) VALUES('Other facility','other',3.2265,101.73075,%s)",(fixture.MANAGER,))
        other=str(self.sql("SELECT id FROM community_facilities WHERE name='Other facility'",fetch=True)[0][0]);self.add_report('OTHER-FACILITY');self.sql("UPDATE reports SET location_id=%s WHERE ticket_id='OTHER-FACILITY'",(other,))
        self.review();self.assertEqual(self.states()['REJECTED'],'rejected');self.assertEqual(self.states()['OTHER-FACILITY'],'pending')
    def test_shared_events_and_status_roll_back_if_audit_write_fails(self):
        self.sql("""CREATE FUNCTION fail_group_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.report_id=(SELECT id FROM reports WHERE ticket_id='TICK-2') THEN RAISE EXCEPTION 'fixture failure';END IF;RETURN NEW;END $$;
          CREATE TRIGGER fail_group_audit BEFORE INSERT ON report_status_events FOR EACH ROW EXECUTE FUNCTION fail_group_audit();""")
        try:
            with self.assertRaises(Exception):self.review()
            self.assertEqual(set(self.states().values()),{'pending'})
        finally:self.sql('DROP TRIGGER fail_group_audit ON report_status_events;DROP FUNCTION fail_group_audit()')
    def test_migration_is_rerunnable_and_browser_cannot_execute_group_helpers(self):
        import psycopg2
        self.review();self.create_task();self.sql(self.group_migration)
        self.assertEqual(self.sql('SELECT count(*) FROM maintenance_tasks',fetch=True)[0][0],1)
        for role in ['anon','authenticated']:
            with self.db.cursor() as c:
                c.execute('SET ROLE '+role)
                try:
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):c.execute('SELECT enclave_related_reports(1)')
                finally:c.execute('RESET ROLE')

    def test_resolving_one_category_does_not_close_another_category_at_the_same_facility(self):
        self.add_report('OTHER-CATEGORY','Streetlight');self.review()
        task=self.submit(self.start_task(self.create_task()))
        result=self.call('task_review',task_id=task['id'],expected_version=task['version'],decision='approve',note='Checked',public_note='Surface fixed.',repair_verified=True)
        self.assertEqual(result['state'],'ok');self.assertEqual(self.states()['OTHER-CATEGORY'],'pending')
        self.assertEqual(self.sql('SELECT status FROM community_issues',fetch=True)[0][0],'open')
        self.assertEqual(self.review('OTHER-CATEGORY')['state'],'ok')
        task=self.call('task_create',ticket_id='OTHER-CATEGORY',title='Fix light',instructions='Inspect and repair',priority='high',target_date='2026-12-31',assigned_staff_id=fixture.WORKER,assigned_team_id=None)['task']
        task=self.submit(self.start_task(task))
        self.call('task_review',task_id=task['id'],expected_version=task['version'],decision='approve',note='Checked',public_note='Light fixed.',repair_verified=True)
        self.assertEqual(self.sql('SELECT status FROM community_issues',fetch=True)[0][0],'resolved')
        projection=self.call('management_get',task_id=task['id'])['task']
        self.assertEqual(projection['related_ticket_ids'],['OTHER-CATEGORY'])

    def test_concurrent_reviews_serialize_the_whole_related_group(self):
        import psycopg2
        from concurrent.futures import ThreadPoolExecutor
        def approve(ticket):
            connection=psycopg2.connect(fixture.DSN)
            try:
                with connection:
                    with connection.cursor() as c:
                        c.execute('SET LOCAL ROLE service_role')
                        c.execute('SELECT enclave_report_workflow(%s,%s::jsonb)',('update',json.dumps(dict(actor_id=fixture.MANAGER,ticket_id=ticket,status='approved',expected_status='pending',note='Group review',repair_verified=False))))
                        return c.fetchone()[0]['state']
            finally:connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(approve,['TICK-1','TICK-2']))
        self.assertEqual(sorted(results),['conflict','ok']);self.assertEqual(set(self.states().values()),{'approved'})
        self.assertEqual(self.sql("SELECT count(*) FROM report_status_events WHERE to_status='approved'",fetch=True)[0][0],2)

    def test_simultaneous_verification_of_different_categories_closes_the_incident(self):
        import psycopg2
        from concurrent.futures import ThreadPoolExecutor
        self.sql("UPDATE reports SET status='rejected' WHERE ticket_id='TICK-2'")
        self.add_report('OTHER-CATEGORY','Streetlight');self.review();self.review('OTHER-CATEGORY')
        first=self.submit(self.start_task(self.create_task()))
        second=self.call('task_create',ticket_id='OTHER-CATEGORY',title='Fix light',instructions='Inspect and repair',priority='high',target_date='2026-12-31',assigned_staff_id=fixture.WORKER,assigned_team_id=None)['task']
        second=self.submit(self.start_task(second))
        # Force overlapping transactions after both report rows change, before
        # their repair events can decide whether another category is unfinished.
        self.sql("""CREATE FUNCTION pause_repair_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.to_status='resolved' THEN PERFORM pg_sleep(0.3);END IF;RETURN NEW;END $$;
          CREATE TRIGGER pause_repair_event BEFORE INSERT ON report_status_events FOR EACH ROW EXECUTE FUNCTION pause_repair_event();""")
        def verify(task):
            connection=psycopg2.connect(fixture.DSN)
            try:
                with connection:
                    with connection.cursor() as c:
                        c.execute('SET LOCAL ROLE service_role')
                        c.execute('SELECT enclave_maintenance_workflow(%s,%s::jsonb)',('task_review',json.dumps(dict(actor_id=fixture.MANAGER,task_id=task['id'],expected_version=task['version'],decision='approve',note='Checked on site',public_note='Repair verified.',repair_verified=True))))
                        return c.fetchone()[0]['state']
            finally:connection.close()
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(verify,[first,second]))
            self.assertEqual(results,['ok','ok']);self.assertEqual(self.states(),{'TICK-1':'resolved','TICK-2':'rejected','OTHER-CATEGORY':'resolved'})
            self.assertEqual(self.sql('SELECT status FROM community_issues',fetch=True)[0][0],'resolved')
        finally:self.sql('DROP TRIGGER pause_repair_event ON report_status_events;DROP FUNCTION pause_repair_event()')
