"""Run only against the disposable loopback PostgreSQL test database."""
import os
from pathlib import Path
import unittest

import psycopg2
from psycopg2.extensions import parse_dsn

DSN = os.environ.get('ENCLAVE_TEST_PG_DSN')
ACTIVE = '00000000-0000-4000-8000-000000000001'
INACTIVE = '00000000-0000-4000-8000-000000000002'


@unittest.skipUnless(DSN, 'Requires the disposable local PostgreSQL test runner')
class MapPlacesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info = parse_dsn(DSN)
        if info.get('host') != '127.0.0.1' or info.get('dbname') != 'enclave_saved_places_test':
            raise RuntimeError('Refusing existing or hosted databases')
        cls.db = psycopg2.connect(DSN)
        cls.db.autocommit = True
        folder = Path(__file__).resolve().parents[1] / 'sql'
        cls.migration = (folder / '015_map_places.sql').read_text(encoding='utf-8')
        cls.seed = (folder / '016_map_places_seed.sql').read_text(encoding='utf-8')
        with cls.db.cursor() as c:
            c.execute('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
                CREATE SCHEMA auth;
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
                    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
                $$;
                CREATE TABLE public.residents(profile_id uuid PRIMARY KEY,status text,verified_at timestamptz);
                GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
                GRANT SELECT ON public.residents TO authenticated;
                ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
                CREATE POLICY own_resident ON public.residents FOR SELECT TO authenticated USING (profile_id = auth.uid());
                INSERT INTO public.residents VALUES (%s,'active',now()),(%s,'inactive',now());''', (ACTIVE, INACTIVE))
            c.execute(cls.migration)
            c.execute(cls.seed)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def query(self, sql, params=(), actor=ACTIVE, role='authenticated'):
        with self.db.cursor() as c:
            c.execute('SET ROLE ' + role)
            try:
                c.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (actor or '',))
                c.execute(sql, params)
                return c.fetchall() if c.description else c.rowcount
            finally:
                c.execute('RESET ROLE')
                c.execute('RESET request.jwt.claim.sub')

    def search(self, area='kl-east-pilot', query='KL East Mall', limit=8, **kwargs):
        return self.query('SELECT name,address,longitude,latitude FROM public.search_map_places(%s,%s,%s)', (area, query, limit), **kwargs)

    def test_real_names_and_numbered_addresses_scope_correctly(self):
        mall = self.search()[0]
        self.assertEqual(mall[0], 'KL East Mall')
        self.assertGreater(mall[2], 101)
        self.assertLess(mall[3], 4)
        self.assertTrue(self.search('kajang-prima-saujana', '20 Jalan Saujana Mutiara 3'))
        self.assertEqual(self.search('kl-east-pilot', '20 Jalan Saujana Mutiara 3'), [])

    def test_anonymous_inactive_and_unverified_cannot_read(self):
        with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
            self.search(role='anon', actor=None)
        self.assertEqual(self.search(actor=INACTIVE), [])
        self.assertEqual(self.search(actor=None), [])
        with self.db.cursor() as c:
            c.execute('UPDATE public.residents SET verified_at=NULL WHERE profile_id=%s', (ACTIVE,))
        try:
            self.assertEqual(self.search(), [])
        finally:
            with self.db.cursor() as c:
                c.execute('UPDATE public.residents SET verified_at=now() WHERE profile_id=%s', (ACTIVE,))

    def test_client_cannot_add_or_change_catalogue_coordinates(self):
        for sql in ("UPDATE public.map_places SET longitude=0", 'DELETE FROM public.map_places',
                    "INSERT INTO public.map_places(id) VALUES(gen_random_uuid())"):
            with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                self.query(sql)

    def test_empty_long_punctuation_queries_and_limits(self):
        for query in (' ', '%_*', 'x' * 161, "'; DROP TABLE map_places;--"):
            self.assertEqual(self.search(query=query), [])
        self.assertLessEqual(len(self.search(query='KL', limit=1000)), 8)
        self.assertEqual(len(self.search(query='KL', limit=0)), 1)

    def test_schema_and_seed_reapply_without_duplicates_or_data_loss(self):
        with self.db.cursor() as c:
            c.execute('SELECT count(*) FROM public.map_places')
            before = c.fetchone()[0]
            c.execute(self.migration)
            c.execute(self.seed)
            c.execute('SELECT count(*) FROM public.map_places')
            self.assertEqual(c.fetchone()[0], before)
            self.assertEqual(before, 1252)

    def test_database_rejects_invalid_coordinates(self):
        for value in (float('nan'), float('inf'), 181):
            with self.assertRaises(psycopg2.errors.CheckViolation):
                with self.db.cursor() as c:
                    c.execute('UPDATE public.map_places SET longitude=%s', (value,))
