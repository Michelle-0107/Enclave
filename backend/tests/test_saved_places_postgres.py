"""Personal preset ownership/validation against a disposable local PostgreSQL cluster."""
import os
from pathlib import Path
import unittest

import psycopg2
from psycopg2.extensions import parse_dsn

DSN = os.environ.get('ENCLAVE_TEST_PG_DSN')
A = '00000000-0000-4000-8000-000000000001'
B = '00000000-0000-4000-8000-000000000002'


@unittest.skipUnless(DSN, 'Requires a dedicated disposable local PostgreSQL database')
class SavedPlacesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info = parse_dsn(DSN)
        if info.get('host') != '127.0.0.1' or info.get('dbname') != 'enclave_saved_places_test':
            raise RuntimeError('Refusing existing or hosted databases')
        cls.db = psycopg2.connect(DSN)
        cls.db.autocommit = True
        cls.migration = (Path(__file__).resolve().parents[1] / 'sql' / '012_user_saved_places.sql').read_text(encoding='utf-8')
        with cls.db.cursor() as c:
            c.execute('''CREATE ROLE anon; CREATE ROLE authenticated;
                CREATE SCHEMA auth;
                CREATE TABLE auth.users(id uuid PRIMARY KEY);
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
                    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
                $$;
                GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
                INSERT INTO auth.users VALUES (%s),(%s);''', (A, B))
            c.execute(cls.migration)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        with self.db.cursor() as c:
            c.execute('TRUNCATE public.user_saved_places')

    def query(self, sql, params=(), actor=A, role='authenticated'):
        with self.db.cursor() as c:
            c.execute('SET ROLE ' + role)
            try:
                c.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (actor or '',))
                c.execute(sql, params)
                return c.fetchall() if c.description else c.rowcount
            finally:
                c.execute('RESET ROLE')
                c.execute('RESET request.jwt.claim.sub')

    def insert(self, name='Home', actor=A):
        return self.query('''INSERT INTO user_saved_places(name,latitude,longitude)
            VALUES (%s,3.22649,101.730755) RETURNING id,user_id,name,latitude,longitude''', (name,), actor)[0]

    def test_save_default_owner_and_account_specific_lists(self):
        row = self.insert()
        self.assertEqual(str(row[1]), A)
        self.assertEqual(self.query('SELECT name FROM user_saved_places'), [('Home',)])
        self.assertEqual(self.query('SELECT name FROM user_saved_places', actor=B), [])
        self.insert('Home', B)
        self.assertEqual(len(self.query('SELECT id FROM user_saved_places', actor=B)), 1)

    def test_own_edit_move_and_delete_persist(self):
        row = self.insert()
        result = self.query('''UPDATE user_saved_places SET name='Office',latitude=3.225,longitude=101.731
            WHERE id=%s RETURNING name,latitude,longitude''', (row[0],))
        self.assertEqual(result, [('Office', 3.225, 101.731)])
        self.assertEqual(self.query('DELETE FROM user_saved_places WHERE id=%s', (row[0],)), 1)
        self.assertEqual(self.query('SELECT id FROM user_saved_places'), [])

    def test_other_user_cannot_read_edit_or_delete_even_with_known_id(self):
        row = self.insert()
        self.assertEqual(self.query('SELECT id FROM user_saved_places WHERE id=%s', (row[0],), B), [])
        self.assertEqual(self.query("UPDATE user_saved_places SET name='Stolen' WHERE id=%s", (row[0],), B), 0)
        self.assertEqual(self.query('DELETE FROM user_saved_places WHERE id=%s', (row[0],), B), 0)
        self.assertEqual(self.query('SELECT name FROM user_saved_places'), [('Home',)])

    def test_cannot_spoof_owner_on_insert_or_transfer_existing_row(self):
        row = self.insert()
        with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
            self.query('''INSERT INTO user_saved_places(user_id,name,latitude,longitude)
                VALUES (%s,'Spoof',3.22,101.73)''', (B,))
        with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
            self.query('UPDATE user_saved_places SET user_id=%s WHERE id=%s', (B, row[0]))
        self.assertEqual(self.query('SELECT name FROM user_saved_places', actor=B), [])

    def test_same_name_case_insensitive_per_account(self):
        self.insert('Home')
        with self.assertRaises(psycopg2.errors.UniqueViolation):
            self.insert('home')
        self.insert('home', B)

    def test_invalid_names_coordinates_and_nonfinite_numbers_rejected(self):
        for name, lat, lon in [('',3.22,101.73),(' X ',3.22,101.73),('x'*61,3.22,101.73),
                               ('X',91,101),('X',3,181),('X',float('nan'),101),('X',3,float('inf'))]:
            with self.subTest(name=name, lat=lat, lon=lon):
                with self.assertRaises(psycopg2.errors.CheckViolation):
                    self.query('INSERT INTO user_saved_places(name,latitude,longitude) VALUES(%s,%s,%s)', (name,lat,lon))

    def test_anonymous_and_missing_identity_denied(self):
        self.insert()
        with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
            self.query('SELECT id FROM user_saved_places', actor=None, role='anon')
        self.assertEqual(self.query('SELECT id FROM user_saved_places', actor=None), [])
        with self.assertRaises(psycopg2.Error):
            self.insert(actor=None)

    def test_migration_can_be_reapplied_without_losing_places(self):
        self.insert()
        with self.db.cursor() as c:
            c.execute(self.migration)
        self.assertEqual(self.query('SELECT name FROM user_saved_places'), [('Home',)])

    def test_account_deletion_removes_private_presets(self):
        self.insert(actor=B)
        with self.db.cursor() as c:
            c.execute('DELETE FROM auth.users WHERE id=%s', (B,))
            c.execute('SELECT count(*) FROM user_saved_places')
            self.assertEqual(c.fetchone()[0], 0)
            c.execute('INSERT INTO auth.users VALUES (%s)', (B,))
