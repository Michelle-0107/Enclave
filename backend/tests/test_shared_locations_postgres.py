"""Shared registry integration on a disposable loopback PostgreSQL database only."""
import json
from pathlib import Path
import unittest
import psycopg2
from backend.tests import test_community_postgres as community

@unittest.skipUnless(community.DSN,'Requires a disposable local PostgreSQL test database')
class SharedLocationsPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        community.CommunityPostgresTests.setUpClass.__func__(cls)
        cls.folder=Path(__file__).resolve().parents[1]/'sql'
        with cls.db.cursor() as c:
            c.execute("""CREATE SCHEMA auth;
              CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
              CREATE TABLE maintenance_staff(profile_id uuid PRIMARY KEY,active boolean NOT NULL);
              GRANT USAGE ON SCHEMA auth TO authenticated;
              INSERT INTO maintenance_staff VALUES('00000000-0000-4000-8000-000000000005',true);
              INSERT INTO profiles VALUES('00000000-0000-4000-8000-000000000005','resident');""")
            for name in ['015_map_places.sql','016_map_places_seed.sql','010_management_what_if_snapshot.sql','018_what_if_candidate_review.sql','019_road_section_reporting.sql','020_shared_map_locations.sql']:
                c.execute((cls.folder/name).read_text(encoding='utf-8'))
            for path in sorted(cls.folder.glob('021*shared_map_locations*.sql')):
                c.execute(path.read_text(encoding='utf-8'))

    @classmethod
    def tearDownClass(cls):cls.db.close()

    def setUp(self):
        # No TRUNCATE of referenced shared registry: preserve seed and stable IDs.
        with self.db.cursor() as c:
            c.execute('DELETE FROM community_issue_reports; DELETE FROM community_issues; DELETE FROM report_status_events; DELETE FROM reports;')
            c.execute("INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude) VALUES('A-1',%s,'pending',false,3.22649,101.730755)",(community.A,))

    def call(self,action,actor=community.A,role='service_role',**args):
        with self.db.cursor() as c:
            c.execute('SET ROLE '+role)
            try:
                c.execute('SELECT public.enclave_map_locations(%s,%s::jsonb)',(action,json.dumps(dict(actor_id=actor,area_id='kl-east-pilot',**args))))
                return c.fetchone()[0]
            finally:c.execute('RESET ROLE')

    def test_all_places_and_sections_are_seeded_with_real_geometry(self):
        with self.db.cursor() as c:
            c.execute("SELECT kind,count(*) FROM map_locations GROUP BY kind")
            counts=dict(c.fetchall());self.assertEqual(counts['place'],1252);self.assertEqual(counts['road_section'],2072)
            c.execute("SELECT count(*) FROM map_locations WHERE kind='road_section' AND metadata->'road_section'->>'field_verified'='false'")
            self.assertEqual(c.fetchone()[0],2072)
        found=self.call('search',query='KL East Mall',limit=8)['items']
        self.assertEqual(found[0]['name'],'KL East Mall')

    def test_access_for_active_resident_manager_worker_and_no_browser_writes(self):
        for actor in (community.A,community.MANAGER,'00000000-0000-4000-8000-000000000005'):
            self.assertEqual(self.call('search',actor=actor,query='KL East Mall')['state'],'ok')
        for actor in (community.INACTIVE,None):self.assertEqual(self.call('search',actor=actor,query='Mall')['state'],'forbidden')
        for role in ('anon','authenticated'):
            with self.assertRaises(psycopg2.errors.InsufficientPrivilege):self.call('labels',role=role,points=[])
            with self.db.cursor() as c:
                c.execute('SET ROLE '+role)
                try:
                    with self.assertRaises(psycopg2.errors.InsufficientPrivilege):c.execute('SELECT * FROM map_locations')
                finally:c.execute('RESET ROLE')

    def test_report_reference_preserves_exact_pin_and_snapshot(self):
        with self.db.cursor() as c:
            c.execute("SELECT id,name,latitude,longitude FROM map_locations WHERE kind='road_section' ORDER BY id LIMIT 1")
            ident,name,lat,lon=c.fetchone()
            c.execute("INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude,location_id) VALUES('EXACT',%s,'pending',false,%s,%s,%s)",(community.A,lat+0.00001,lon,ident))
            c.execute("SELECT latitude,longitude,location_id,location_name FROM reports WHERE ticket_id='EXACT'")
            row=c.fetchone();self.assertEqual(row[:3],(lat+0.00001,lon,ident));self.assertIn(name,row[3]);snapshot=row[3]
            c.execute('UPDATE map_locations SET name=%s WHERE id=%s',('Temporary test rename',ident))
            c.execute("UPDATE reports SET status='approved',is_approved=true WHERE ticket_id='EXACT'")
            c.execute("SELECT location_name FROM reports WHERE ticket_id='EXACT'");self.assertEqual(c.fetchone()[0],snapshot)
            c.execute('UPDATE map_locations SET name=%s WHERE id=%s',(name,ident))
            with self.assertRaises(psycopg2.errors.CheckViolation):
                c.execute("INSERT INTO reports(ticket_id,user_id,latitude,longitude,location_id) VALUES('FAR',%s,0,0,%s)",(community.A,ident))

    def test_linked_facility_updates_reference_and_is_immediately_searchable(self):
        point={'id':'90000000-0000-4000-8000-000000000001','name':'Synthetic shared section','facility_type':'path_surface','latitude':3.22649,'longitude':101.730755}
        with self.db.cursor() as c:
            c.execute('SET ROLE service_role')
            try:
                c.execute('SELECT enclave_community_issues(%s,%s::jsonb)',('open_road_issue',json.dumps(dict(actor_id=community.A,facility_id=point['id'],report_ticket_id='A-1',fault_kind='damage',road_point=point))))
                self.assertEqual(c.fetchone()[0]['state'],'ok')
            finally:c.execute('RESET ROLE')
            c.execute("SELECT location_id,latitude,longitude FROM reports WHERE ticket_id='A-1'");row=c.fetchone()
            self.assertEqual(str(row[0]),point['id']);self.assertEqual(row[1:],(3.22649,101.730755))
        self.assertEqual(self.call('search',query='Synthetic shared section')['items'][0]['id'],point['id'])
        values=self.call('labels',points=[dict(ticket_id='A-1',latitude=3.22649,longitude=101.730755)])['items']
        self.assertEqual(values[0]['location_name'],point['name'])

    def test_area_scope_nearby_and_pagination_are_stable(self):
        first=self.call('road_sections',latitude=3.22649,longitude=101.730755,limit=1)['items']
        second=self.call('road_sections',latitude=3.22649,longitude=101.730755,limit=1,offset=1)['items']
        self.assertTrue(first);self.assertTrue(second);self.assertNotEqual(first[0]['id'],second[0]['id'])
        self.assertTrue(all(p['distance_meters']<=100 for p in first+second))
        self.assertEqual(self.call('nearby',latitude=0,longitude=0)['items'],[])
        self.assertEqual(self.call('search',query='20 Jalan Saujana Mutiara 3')['items'],[])

    def test_rerunnable_migrations_and_legacy_search_use_registry(self):
        with self.db.cursor() as c:
            for name in ['020_shared_map_locations.sql',*[p.name for p in sorted(self.folder.glob('021*shared_map_locations*.sql'))]]:
                c.execute((self.folder/name).read_text(encoding='utf-8'))
            c.execute("SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',%s,false)",(community.A,))
            try:
                c.execute("SELECT name FROM search_map_places('kl-east-pilot','Section',8)")
                self.assertEqual(len(c.fetchall()),8)
            finally:c.execute('RESET ROLE')
        self.assertEqual(self.call('search',query='   ')['state'],'invalid')

    def test_http_location_api_uses_database_and_cannot_spoof_actor(self):
        import httpx
        from uuid import UUID
        from fastapi import Depends,HTTPException
        from fastapi.testclient import TestClient
        from backend.app import create_app,current_user,active_resident,AuthenticatedUser,bearer
        from backend.core.config import Settings
        calls=[]
        def rpc(request):
            payload=json.loads(request.content);calls.append(payload)
            with self.db.cursor() as c:
                c.execute('SET ROLE service_role')
                try:
                    c.execute('SELECT enclave_map_locations(%s,%s::jsonb)',(payload['p_action'],json.dumps(payload['p_args'])))
                    value=c.fetchone()[0]
                finally:c.execute('RESET ROLE')
            return httpx.Response(200,json=value)
        app=create_app(Settings('https://fixture.supabase.co','sb_secret_locations_fixture'),locations_transport=httpx.MockTransport(rpc))
        def user(credentials=Depends(bearer)):
            if credentials is None:raise HTTPException(401,'Test authentication required')
            return AuthenticatedUser(UUID(credentials.credentials),'synthetic@example.com','synthetic-token')
        app.dependency_overrides[current_user]=user;app.dependency_overrides[active_resident]=user
        with TestClient(app) as client:
            url='/api/v1/locations?area_id=kl-east-pilot&q=KL%20East%20Mall'
            self.assertEqual(client.get(url).status_code,401)
            response=client.get(url,headers={'Authorization':'Bearer '+community.A})
            self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['storage'],'database')
            self.assertEqual(response.json()['items'][0]['name'],'KL East Mall')
            self.assertEqual(response.headers['cache-control'],'private, no-store')
            self.assertEqual(client.get(url+'&actor_id='+community.MANAGER,headers={'Authorization':'Bearer '+community.INACTIVE}).status_code,403)
            self.assertEqual(calls[-1]['p_args']['actor_id'],community.INACTIVE)
            response=client.get('/api/v1/facilities/road-sections?latitude=3.22649&longitude=101.730755',headers={'Authorization':'Bearer '+community.A})
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.headers['x-enclave-location-storage'],'database')
            self.assertTrue(response.json()['items'][0]['road_section']['geometry'])
            self.assertEqual(client.get('/api/v1/locations?area_id=kl-east-pilot&latitude=NaN&longitude=101.73',headers={'Authorization':'Bearer '+community.A}).status_code,422)

    def test_section_counts_and_what_if_approval_keep_their_original_rules(self):
        with self.db.cursor() as c:
            c.execute("SELECT id,name,latitude,longitude FROM map_locations WHERE kind='road_section' AND public.enclave_location_distance(3.22649,101.730755,latitude,longitude)<=100 ORDER BY id LIMIT 2")
            points=c.fetchall();self.assertEqual(len(points),2)
            c.execute("INSERT INTO reports(ticket_id,user_id,status,is_approved,latitude,longitude) VALUES('B-1',%s,'pending',false,3.22649,101.730755),('B-2',%s,'pending',false,3.22649,101.730755)",(community.B,community.B))
        def report(point,actor,ticket):
            ident,name,lat,lon=point
            values=dict(actor_id=actor,facility_id=ident,report_ticket_id=ticket,fault_kind='damage',road_point=dict(id=ident,name=name,facility_type='path_surface',latitude=lat,longitude=lon))
            with self.db.cursor() as c:
                c.execute('SET ROLE service_role')
                try:
                    c.execute('SELECT enclave_community_issues(%s,%s::jsonb)',('open_road_issue',json.dumps(values)))
                    return c.fetchone()[0]
                finally:c.execute('RESET ROLE')
        first=report(points[0],community.A,'A-1');second=report(points[1],community.B,'B-1')
        self.assertEqual(first['state'],'ok');self.assertEqual(second['state'],'ok')
        self.assertEqual(first['issue']['reporter_count'],1);self.assertEqual(second['issue']['reporter_count'],1)
        self.assertEqual(report(points[0],community.B,'B-2')['issue']['reporter_count'],2)
        with self.db.cursor() as c:
            c.execute('UPDATE map_locations SET name=%s WHERE id=%s',('Registry section label',points[0][0]))
            try:
                c.execute('SET ROLE service_role')
                c.execute('SELECT enclave_what_if_snapshot(%s)',(community.MANAGER,));snapshot=c.fetchone()[0]
                self.assertEqual(len(snapshot['issues']),1);self.assertEqual(snapshot['issues'][0]['facility_name'],'Registry section label')
                self.assertIsNotNone(snapshot['issues'][0]['review_ticket_id'])
                c.execute("UPDATE reports SET status='approved',is_approved=true WHERE ticket_id='A-1'")
                c.execute('SELECT enclave_what_if_snapshot(%s)',(community.MANAGER,));snapshot=c.fetchone()[0]
                self.assertEqual(len(snapshot['issues']),1);self.assertIsNone(snapshot['issues'][0]['review_ticket_id'])
            finally:
                c.execute('RESET ROLE');c.execute('UPDATE map_locations SET name=%s WHERE id=%s',(points[0][1],points[0][0]))

    def test_finalize_rejects_missing_seed_records_before_backfill(self):
        from backend.tools.build_location_seed import generate_files
        parts=generate_files()
        with self.db.cursor() as c:
            c.execute("SELECT id FROM map_locations l WHERE kind='road_section' AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.location_id=l.id) AND NOT EXISTS(SELECT 1 FROM community_facilities f WHERE f.id=l.id) LIMIT 1")
            missing=c.fetchone()[0]
            c.execute('DELETE FROM map_locations WHERE id=%s',(missing,))
            c.execute('SELECT ticket_id,location_id,location_name FROM reports ORDER BY ticket_id');before=c.fetchall()
            try:
                with self.assertRaises(psycopg2.errors.CheckViolation):c.execute(next(sql for name,sql in parts.items() if 'finalize' in name))
            finally:c.execute('ROLLBACK')
            c.execute('SELECT ticket_id,location_id,location_name FROM reports ORDER BY ticket_id');self.assertEqual(c.fetchall(),before)
            for sql in parts.values():c.execute(sql)
            c.execute('SELECT count(*) FROM map_locations WHERE id=%s',(missing,));self.assertEqual(c.fetchone()[0],1)
