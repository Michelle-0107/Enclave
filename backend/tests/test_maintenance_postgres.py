"""Real SQL/RLS and HTTP tests, exclusively in a disposable loopback database."""
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import time
import unittest
from uuid import UUID, uuid4

from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
import httpx
import jwt
from PIL import Image
import psycopg2
from psycopg2.extensions import parse_dsn

from backend.app import AuthenticatedUser, create_app, current_user
from backend.core.config import Settings

MANAGER='00000000-0000-4000-8000-000000000001'
RESIDENT='00000000-0000-4000-8000-000000000002'
WORKER='00000000-0000-4000-8000-000000000003'
OTHER='00000000-0000-4000-8000-000000000004'
DISABLED='00000000-0000-4000-8000-000000000005'
TEAM='10000000-0000-4000-8000-000000000001'
OTHER_TEAM='10000000-0000-4000-8000-000000000002'
DSN=os.environ.get('ENCLAVE_TEST_PG_DSN')


class Media:
    def __init__(self): self.uploads=[]; self.deleted=[]
    def upload(self,key,content,kind):
        self.uploads.append((key,content,kind))
        return 'https://fixture.s3.amazonaws.com/'+key
    def signed_image_url(self,url): return url
    def delete_report_images(self,urls): self.deleted.extend(urls); return True


@unittest.skipUnless(DSN,'Requires the disposable local maintenance test cluster')
class MaintenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info=parse_dsn(DSN)
        if info.get('host')!='127.0.0.1' or info.get('dbname')!='enclave_maintenance_test':
            raise RuntimeError('Refusing an existing or hosted database')
        cls.db=psycopg2.connect(DSN); cls.db.autocommit=True
        with cls.db.cursor() as c:
            c.execute('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
                CREATE SCHEMA auth;
                CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
                CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),email text NOT NULL,full_name text,
                    role text NOT NULL DEFAULT 'resident' CHECK(role IN ('resident','management')));
                CREATE TABLE residents(profile_id uuid,status text,verified_at timestamptz);
                CREATE TABLE reports(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,ticket_id text,
                    user_id uuid REFERENCES profiles(id),description text,status text,is_approved boolean,
                    latitude float8,longitude float8,image_url text,category text,priority text,created_at timestamptz DEFAULT now());
                ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;''')
            folder=Path(__file__).resolve().parents[1]/'sql'
            for name in ('007_report_workflow.sql','009_community_issue_points.sql','017_maintenance_workflow.sql'):
                c.execute((folder/name).read_text(encoding='utf-8'))
            cls.migration=(folder/'017_maintenance_workflow.sql').read_text(encoding='utf-8')

    @classmethod
    def tearDownClass(cls): cls.db.close()

    def sql(self,text,values=None,fetch=False):
        with self.db.cursor() as c:
            c.execute(text,values)
            return c.fetchall() if fetch else None

    def call(self,action,actor=MANAGER,**values):
        db=psycopg2.connect(DSN)
        try:
            with db:
                with db.cursor() as c:
                    c.execute('SET LOCAL ROLE service_role')
                    c.execute('SELECT public.enclave_maintenance_workflow(%s,%s::jsonb)',(action,json.dumps({**values,'actor_id':actor})))
                    return c.fetchone()[0]
        finally: db.close()

    def setUp(self):
        self.sql('''DROP TRIGGER IF EXISTS fail_maintenance_event ON maintenance_task_events;
            TRUNCATE maintenance_notifications,maintenance_evidence,maintenance_task_events,maintenance_tasks,
                maintenance_staff,maintenance_teams,community_issue_reports,community_issues,community_facilities,
                report_status_events,reports,residents,profiles,auth.users RESTART IDENTITY CASCADE;''')
        for who,role in ((MANAGER,'management'),(RESIDENT,'resident'),(WORKER,'resident'),(OTHER,'resident'),(DISABLED,'resident')):
            self.sql('INSERT INTO auth.users VALUES(%s,%s,now()); INSERT INTO profiles(id,email,role) VALUES(%s,%s,%s)',
                (who,who+'@example.com',who,who+'@example.com',role))
        self.sql("INSERT INTO residents VALUES(%s,'active',now()); INSERT INTO maintenance_teams(id,name) VALUES(%s,'Civil'),(%s,'Electrical')",(RESIDENT,TEAM,OTHER_TEAM))
        for who,team,active in ((WORKER,TEAM,True),(OTHER,OTHER_TEAM,True),(DISABLED,TEAM,False)):
            self.sql('INSERT INTO maintenance_staff(profile_id,email,display_name,team_id,active) VALUES(%s,%s,%s,%s,%s)',(who,who+'@example.com','Test worker',team,active))
        self.sql("INSERT INTO reports(ticket_id,user_id,description,status,is_approved,latitude,longitude,image_url) VALUES('TICK-1',%s,'Broken walkway','approved',true,3.22649,101.730755,'https://fixture.s3.amazonaws.com/before.jpg')",(RESIDENT,))
        self.sql("INSERT INTO community_facilities(name,facility_type,latitude,longitude,created_by) VALUES('Walkway','path_surface',3.22649,101.730755,%s)",(MANAGER,))
        self.sql("INSERT INTO community_issues(facility_id,fault_kind) SELECT id,'damage' FROM community_facilities")
        self.sql('INSERT INTO community_issue_reports(issue_id,user_id,report_id) SELECT i.id,%s,r.id FROM community_issues i CROSS JOIN reports r',(RESIDENT,))
        self.media=Media()
        def rpc(request):
            payload=json.loads(request.content)
            self.assertNotIn('Bearer '+WORKER, str(request.headers))
            try:
                if request.url.path.endswith('/enclave_maintenance_workflow'):
                    args=payload['p_args']; result=self.call(payload['p_action'],**{'actor':args.pop('actor_id'),**args})
                elif request.url.path.endswith('/enclave_report_workflow'):
                    with self.db.cursor() as c:
                        c.execute('SET ROLE service_role')
                        try:
                            c.execute('SELECT enclave_report_workflow(%s,%s::jsonb)',(payload['p_action'],json.dumps(payload['p_args'])))
                            result=c.fetchone()[0]
                        finally: c.execute('RESET ROLE')
                else: raise AssertionError('Unexpected HTTP destination')
                return httpx.Response(200,json=result)
            except psycopg2.Error:
                return httpx.Response(400,json={'message':'Synthetic RPC failure'})
        app=create_app(Settings('https://fixture.supabase.co','sb_secret_maintenance_fixture'),
            locations_transport=httpx.MockTransport(lambda request: httpx.Response(404,json={'code':'PGRST202'})),
            maintenance_transport=httpx.MockTransport(rpc), workflow_transport=httpx.MockTransport(rpc),media_services=self.media)
        def verified(request: Request):
            token=request.headers.get('authorization','').removeprefix('Bearer ')
            if token not in (MANAGER,RESIDENT,WORKER,OTHER,DISABLED): raise HTTPException(401,'Invalid fixture token')
            return AuthenticatedUser(UUID(token),'fixture@example.com','synthetic-access-token')
        app.dependency_overrides[current_user]=verified
        self.client=TestClient(app); self.client.__enter__(); self.client.app.state.report_photo_links=self.media
        self.addCleanup(self.client.__exit__,None,None,None)

    def http(self,method,path,actor=MANAGER,**kwargs):
        return self.client.request(method,path,headers={'Authorization':'Bearer '+actor},**kwargs)

    def create_task(self,team=False):
        result=self.call('task_create',ticket_id='TICK-1',title='Repair walkway',instructions='Inspect and repair the surface',
            priority='high',target_date='2026-12-31',assigned_staff_id=None if team else WORKER,assigned_team_id=TEAM if team else None)
        self.assertEqual(result['state'],'ok',result)
        return result['task']

    def start_task(self,task):
        result=self.call('task_start',WORKER,task_id=task['id'],expected_version=task['version'])
        self.assertEqual(result['state'],'ok',result); return result['task']

    def submit(self,task,actor=WORKER):
        data=io.BytesIO(); Image.new('RGB',(4,4),'white').save(data,format='JPEG')
        response=self.http('POST',f"/api/v1/maintenance/tasks/{task['id']}/evidence",actor,
            data={'notes':'Surface repaired and checked','expected_version':str(task['version']),'checked_on_site':'true'},
            files={'file':('repair.jpg',data.getvalue(),'image/jpeg')})
        self.assertEqual(response.status_code,200,response.text); return response.json()

    def test_identity_requires_real_staff_and_revocation_is_immediate(self):
        for who,expected in ((MANAGER,'management'),(WORKER,'maintenance')):
            response=self.http('GET','/api/v1/auth/role',who)
            self.assertEqual(response.status_code,200,response.text); self.assertEqual(response.json()['role'],expected)
        for who in (RESIDENT,DISABLED): self.assertEqual(self.http('GET','/api/v1/auth/role',who).status_code,403)
        self.assertEqual(self.client.get('/api/v1/auth/role').status_code,401)
        response=self.http('PATCH','/api/v1/management/maintenance/staff/'+WORKER,json={'active':False})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.http('GET','/api/v1/auth/role',WORKER).status_code,403)

    def test_staff_provisioning_requires_confirmed_matching_account_and_never_converts_residents(self):
        who=str(uuid4()); self.sql('INSERT INTO auth.users VALUES(%s,%s,now())',(who,'new-staff@example.com'))
        response=self.http('POST','/api/v1/management/maintenance/staff',json={'profile_id':who,'email':'new-staff@example.com','display_name':'Civil staff','team_id':TEAM})
        self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(self.call('identity',who)['identity']['role'],'maintenance')
        for who in (MANAGER,RESIDENT):
            result=self.call('staff_create',profile_id=who,email=who+'@example.com',display_name='Forbidden')
            self.assertEqual(result['state'],'conflict')
        unknown=str(uuid4()); self.sql('INSERT INTO auth.users VALUES(%s,%s,NULL)',(unknown,'unconfirmed@example.com'))
        self.assertEqual(self.call('staff_create',profile_id=unknown,email='unconfirmed@example.com',display_name='No')['state'],'invalid')

    def test_only_management_can_provision_assign_or_review(self):
        t=self.create_task()
        for action,args in (('staff_create',{'profile_id':OTHER}),('team_create',{'name':'bad'}),('task_create',{}),('task_review',{'task_id':t['id']})):
            self.assertEqual(self.call(action,WORKER,**args)['state'],'forbidden')
        response=self.http('POST','/api/v1/management/maintenance/teams',WORKER,json={'name':'Cannot create'})
        self.assertEqual(response.status_code,403)

    def test_unassigned_workers_cannot_read_change_or_upload_to_a_task(self):
        t=self.create_task()
        for action in ('task_get','task_history','task_progress','evidence_access'):
            self.assertEqual(self.call(action,OTHER,task_id=t['id'],expected_version=1,notes='No')['state'],'not_found')
        response=self.http('POST',f"/api/v1/maintenance/tasks/{t['id']}/evidence",OTHER,
            data={'notes':'No','expected_version':'1','checked_on_site':'true'},files={'file':('x.jpg',b'bad','image/jpeg')})
        self.assertEqual(response.status_code,404,response.text); self.assertEqual(self.media.uploads,[])

    def test_team_tasks_and_reassignment_revoke_old_access(self):
        t=self.create_task(team=True)
        self.assertEqual(len(self.call('task_list',WORKER)['items']),1)
        self.assertEqual(self.call('task_list',OTHER)['items'],[])
        result=self.call('task_reassign',task_id=t['id'],expected_version=1,assigned_staff_id=OTHER,assigned_team_id=None,note='Electrical inspection')
        self.assertEqual(result['state'],'ok',result)
        self.assertEqual(self.call('task_get',WORKER,task_id=t['id'])['state'],'not_found')
        self.assertEqual(self.call('task_get',OTHER,task_id=t['id'])['state'],'ok')

    def test_full_workflow_photo_review_resolves_report_and_map_together(self):
        t=self.start_task(self.create_task())
        response=self.http('PATCH',f"/api/v1/maintenance/tasks/{t['id']}/progress",WORKER,json={'expected_version':t['version'],'notes':'Internal spare-part reference 123'})
        self.assertEqual(response.status_code,200,response.text); t=self.submit(response.json())
        self.assertEqual(t['status'],'awaiting_verification'); self.assertEqual(t['report_status'],'in_progress')
        self.assertEqual(self.sql('SELECT status FROM community_issues',fetch=True)[0][0],'open')
        response=self.http('POST',f"/api/v1/management/maintenance/tasks/{t['id']}/review",json={
            'expected_version':t['version'],'decision':'approve','note':'Private team review','public_note':'Walkway repaired and inspected.','repair_verified':True})
        self.assertEqual(response.status_code,200,response.text); self.assertEqual(response.json()['report_status'],'resolved')
        self.assertEqual(self.sql('SELECT status FROM community_issues',fetch=True)[0][0],'resolved')
        history=self.http('GET','/api/v1/reports/TICK-1/history',RESIDENT)
        self.assertEqual(history.status_code,200,history.text)
        self.assertEqual(history.json()['items'][0]['actor_role'],'maintenance')
        self.assertNotIn('Private team review',history.text); self.assertNotIn('spare-part',history.text)
        self.assertNotIn(WORKER,history.text); self.assertIn('Walkway repaired and inspected.',history.text)

    def test_rework_requires_fresh_evidence_before_review(self):
        t=self.submit(self.start_task(self.create_task()))
        t=self.call('task_review',task_id=t['id'],expected_version=t['version'],decision='rework',note='Clearer evidence',repair_verified=False)['task']
        self.assertEqual(t['status'],'changes_requested')
        result=self.call('task_review',task_id=t['id'],expected_version=t['version'],decision='approve',note='No',public_note='No',repair_verified=True)
        self.assertEqual(result['state'],'conflict')
        t=self.submit(t); self.assertEqual(t['status'],'awaiting_verification')
        self.assertEqual(self.sql('SELECT count(*) FROM maintenance_evidence',fetch=True)[0][0],2)

    def test_legacy_status_endpoint_cannot_bypass_evidence_review(self):
        t=self.start_task(self.create_task())
        response=self.http('PATCH','/api/v1/management/reports/TICK-1/status',json={'expected_status':'in_progress','status':'resolved','note':'Bypass','repair_verified':True})
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(self.sql('SELECT status FROM reports',fetch=True)[0][0],'in_progress')
        self.assertEqual(self.call('task_get',WORKER,task_id=t['id'])['task']['status'],'in_progress')

    def test_blocker_and_notifications_are_private_to_recipients(self):
        t=self.start_task(self.create_task())
        result=self.call('task_blocker',WORKER,task_id=t['id'],expected_version=t['version'],notes='Need replacement',blocker_type='parts')
        self.assertEqual(result['state'],'ok',result)
        self.assertEqual(self.call('notifications',OTHER)['items'],[])
        notifications=self.call('notifications',MANAGER)['items']; self.assertEqual(notifications[0]['title'],'Task blocked')
        identifier=notifications[0]['id']
        self.assertEqual(self.call('notification_read',WORKER,notification_id=identifier)['state'],'not_found')
        response=self.http('POST',f'/api/v1/maintenance/notifications/{identifier}/read')
        self.assertEqual(response.status_code,204,response.text)
        self.assertTrue(self.call('notifications',MANAGER)['items'][0]['is_read'])

    def test_versions_and_concurrent_team_start_allow_only_one_change(self):
        t=self.create_task(team=True)
        def start(_): return self.call('task_start',WORKER,task_id=t['id'],expected_version=1)['state']
        with ThreadPoolExecutor(max_workers=2) as pool: result=list(pool.map(start,range(2)))
        self.assertCountEqual(result,['ok','conflict'])
        self.assertEqual(self.sql('SELECT count(*) FROM report_status_events',fetch=True)[0][0],1)

    def test_audit_failure_rolls_back_verification_and_incident_closure(self):
        t=self.submit(self.start_task(self.create_task()))
        self.sql("""CREATE OR REPLACE FUNCTION fail_maintenance_event() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
            CREATE TRIGGER fail_maintenance_event BEFORE INSERT ON maintenance_task_events FOR EACH ROW EXECUTE FUNCTION fail_maintenance_event();""")
        response=self.http('POST',f"/api/v1/management/maintenance/tasks/{t['id']}/review",json={'expected_version':t['version'],'decision':'approve','note':'Review','public_note':'Repaired','repair_verified':True})
        self.assertEqual(response.status_code,503,response.text)
        self.assertEqual(self.sql('SELECT status FROM maintenance_tasks',fetch=True)[0][0],'awaiting_verification')
        self.assertEqual(self.sql('SELECT status FROM reports',fetch=True)[0][0],'in_progress')
        self.assertEqual(self.sql('SELECT status FROM community_issues',fetch=True)[0][0],'open')

    def test_rpc_and_tables_are_inaccessible_to_browser_roles(self):
        for role in ('anon','authenticated'):
            db=psycopg2.connect(DSN)
            try:
                for query in ('SELECT * FROM maintenance_tasks','SELECT enclave_maintenance_workflow(\'identity\',\'{}\'::jsonb)',
                              "SELECT enclave_report_workflow_before_maintenance('list','{}'::jsonb)"):
                    with self.assertRaises(psycopg2.Error):
                        with db:
                            with db.cursor() as c: c.execute('SET LOCAL ROLE '+role); c.execute(query)
            finally: db.close()

    def test_input_spoofing_invalid_photos_and_unverified_resolution_are_rejected(self):
        t=self.start_task(self.create_task())
        response=self.http('PATCH',f"/api/v1/maintenance/tasks/{t['id']}/progress",WORKER,json={'expected_version':t['version'],'notes':'No','actor_id':MANAGER})
        self.assertEqual(response.status_code,422); self.assertNotIn(MANAGER,response.text)
        response=self.http('POST',f"/api/v1/maintenance/tasks/{t['id']}/evidence",WORKER,
            data={'notes':'Bad','expected_version':str(t['version']),'checked_on_site':'true'},files={'file':('fake.jpg',b'not a photo','image/jpeg')})
        self.assertEqual(response.status_code,415); self.assertEqual(self.media.uploads,[])
        response=self.http('POST',f"/api/v1/management/maintenance/tasks/{t['id']}/review",json={'expected_version':t['version'],'decision':'approve','note':'No','repair_verified':False})
        self.assertEqual(response.status_code,422)

    def test_migration_can_be_reapplied_without_resetting_tasks(self):
        t=self.create_task(); self.sql(self.migration)
        self.assertEqual(self.call('task_get',WORKER,task_id=t['id'])['task']['version'],1)

    def test_duplicate_and_unapproved_reports_cannot_create_extra_tasks(self):
        self.sql("UPDATE reports SET status='pending',is_approved=false")
        result=self.call('task_create',ticket_id='TICK-1',title='No',instructions='No',priority='low',target_date='2026-12-31',assigned_staff_id=WORKER)
        self.assertEqual(result['state'],'conflict')
        self.sql("UPDATE reports SET status='approved',is_approved=true")
        self.create_task()
        self.assertEqual(self.call('task_create',ticket_id='TICK-1')['state'],'conflict')

    def test_teams_pagination_and_clearing_membership(self):
        response=self.http('POST','/api/v1/management/maintenance/teams',json={'name':'Plumbing'})
        self.assertEqual(response.status_code,201,response.text)
        response=self.http('GET','/api/v1/management/maintenance/teams?limit=1&offset=0')
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(len(response.json()['items']),1); self.assertTrue(response.json()['has_more'])
        task=self.create_task(team=True)
        response=self.http('PATCH','/api/v1/management/maintenance/staff/'+WORKER,json={'team_id':None})
        self.assertEqual(response.status_code,200,response.text); self.assertIsNone(response.json()['team_id'])
        self.assertEqual(self.call('task_get',WORKER,task_id=task['id'])['state'],'not_found')

    def test_upload_rejection_removes_object_but_ambiguous_commit_preserves_it(self):
        from backend.maintenance.repository import MaintenanceRejected, MaintenanceUnavailable
        task=self.start_task(self.create_task())
        repository=self.client.app.state.maintenance
        original=repository.call
        for ambiguous in (False,True):
            async def intercepted(action,actor_id,**values):
                if action=='task_evidence':
                    if ambiguous: raise MaintenanceUnavailable()
                    raise MaintenanceRejected(409,'Synthetic concurrent change')
                return await original(action,actor_id,**values)
            repository.call=intercepted
            image=io.BytesIO(); Image.new('RGB',(4,4),'white').save(image,format='PNG')
            response=self.http('POST',f"/api/v1/maintenance/tasks/{task['id']}/evidence",WORKER,
                data={'notes':'Checked','expected_version':str(task['version']),'checked_on_site':'true'},
                files={'file':('repair.png',image.getvalue(),'image/png')})
            self.assertEqual(response.status_code,503 if ambiguous else 409,response.text)
            self.assertEqual(len(self.media.deleted),1)
        self.assertEqual(len(self.media.uploads),2)

    def test_staff_email_mismatch_is_rejected(self):
        who=str(uuid4())
        self.sql('INSERT INTO auth.users VALUES(%s,%s,now()); INSERT INTO profiles(id,email) VALUES(%s,%s)',
            (who,'real@example.com',who,'different@example.com'))
        result=self.call('staff_create',profile_id=who,email='real@example.com',display_name='No')
        self.assertEqual(result['state'],'conflict')

    def test_real_jwt_verification_and_database_role_are_both_required(self):
        from backend.core.auth import TokenVerifier
        secret='synthetic-maintenance-test-secret-not-a-real-project-key'
        verifier=TokenVerifier(Settings('https://fixture.supabase.co','sb_secret_maintenance_fixture',jwt_secret=secret))
        self.addCleanup(verifier.close)
        self.client.app.state.verifier=verifier
        self.client.app.dependency_overrides.clear()
        now=int(time.time())
        def token(who,**changes):
            claims={'sub':who,'iss':'https://fixture.supabase.co/auth/v1','aud':'authenticated',
                'role':'authenticated','iat':now-10,'exp':now+3600,
                'user_metadata':{'role':'management'}}
            return jwt.encode({**claims,**changes},secret,algorithm='HS256')
        for who,status in ((WORKER,200),(MANAGER,200),(RESIDENT,403),(DISABLED,403)):
            response=self.http('GET','/api/v1/auth/role',token(who))
            self.assertEqual(response.status_code,status,response.text)
        for bad in (token(WORKER,exp=now-1),token(WORKER,role='management'),'invalid-token'):
            self.assertEqual(self.http('GET','/api/v1/auth/role',bad).status_code,401)
