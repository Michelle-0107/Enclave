"""Real transaction/RLS checks in a dedicated loopback PostgreSQL database only.

Requires ENCLAVE_TEST_PG_DSN with host 127.0.0.1 and dbname enclave_otp_test.
Auth/email are synthetic. Never reads the application's .env or a hosted database.
"""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import threading
import time
import unittest
from uuid import uuid4
import psycopg2
from psycopg2.extensions import parse_dsn
from psycopg2.extras import Json

from backend.registration import RegistrationService, RegistrationRejected
from backend.registration.demo import DEMO_INVITATION, DEMO_PASSWORD, MANAGER, RESIDENT, FakeAccounts, FakeDelivery, demo_components
from backend.registration_models import RequestOTP, VerifySignup


KEY = "synthetic-postgres-idempotency-key-0000001"


class SQLStore:
    def __init__(self, dsn):
        self.dsn = dsn

    def close(self):
        pass

    def call(self, action, **args):
        connection = psycopg2.connect(self.dsn)
        try:
            with connection:
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL ROLE service_role")
                    cursor.execute("SELECT public.enclave_registration_transition(%s, %s::jsonb)", (action, Json(args)))
                    return cursor.fetchone()[0]
        finally:
            connection.close()


@unittest.skipUnless(os.environ.get("ENCLAVE_TEST_PG_DSN"), "Dedicated local PostgreSQL is not configured")
class PostgresRegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["ENCLAVE_TEST_PG_DSN"]
        parsed = parse_dsn(cls.dsn)
        if parsed.get("host") != "127.0.0.1" or parsed.get("dbname") != "enclave_otp_test":
            raise RuntimeError("SQL tests require the dedicated loopback test database; no schema changes made.")
        connection = psycopg2.connect(cls.dsn)
        try:
            with connection:
                with connection.cursor() as cursor:
                    cursor.execute("""
                        CREATE ROLE anon NOLOGIN;
                        CREATE ROLE authenticated NOLOGIN;
                        CREATE ROLE service_role NOLOGIN BYPASSRLS;
                        CREATE SCHEMA auth;
                        CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
                        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
                            'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
                        CREATE TABLE public.profiles (
                            id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
                            email text NOT NULL, full_name text,
                            role text DEFAULT 'resident' CHECK (role IN ('resident','management')),
                            created_at timestamptz NOT NULL DEFAULT now()
                        );
                        GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
                        GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
                    """)
                    sql_dir = Path(__file__).resolve().parents[1] / "sql"
                    for name in ("003_single_community_registration_draft.sql", "004_profile_registration_access.sql",
                                 "005_registration_transitions.sql"):
                        # These scripts own their BEGIN/COMMIT; this database is disposable and dedicated.
                        cursor.execute((sql_dir / name).read_text(encoding="utf-8"))
        finally:
            connection.close()

    def sql(self, source, params=(), *, role=None, user_id=None, fetch=False):
        connection = psycopg2.connect(self.dsn)
        try:
            with connection:
                with connection.cursor() as cursor:
                    if role:
                        from psycopg2 import sql
                        cursor.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(role)))
                    if user_id:
                        cursor.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
                    cursor.execute(source, params)
                    return cursor.fetchall() if fetch else None
        finally:
            connection.close()

    def setUp(self):
        self.sql("TRUNCATE public.registration_rate_limits, public.email_verification_challenges, public.resident_invitations, public.residents, public.profiles, auth.users CASCADE")
        self.sql("INSERT INTO auth.users(id) VALUES (%s), (%s)", (str(MANAGER), str(RESIDENT)))
        self.sql("INSERT INTO public.profiles(id,email,full_name,role) VALUES (%s,'manager@example.com','Test Manager','management')", (str(MANAGER),))
        _, old_service, _, _, _ = demo_components()
        config = old_service.settings
        old_service.close()
        self.store, self.delivery, self.accounts = SQLStore(self.dsn), FakeDelivery(), FakeAccounts()
        self.service = RegistrationService(config, self.store, self.delivery, self.accounts, otp_factory=lambda: "003482")
        self.addCleanup(self.service.close)
        resident = self.store.call("create_resident", actor_id=str(MANAGER), resident_reference="PG-1", full_name="Test Resident",
                                   unit_number="101", registered_email="resident@example.com")
        self.resident_id = resident["resident_id"]
        self.invitation_id = str(uuid4())
        result = self.store.call("issue_invitation", actor_id=str(MANAGER), resident_id=self.resident_id,
                                 id=self.invitation_id, token_digest=hashlib.sha256(DEMO_INVITATION.encode()).hexdigest())
        self.assertEqual(result["state"], "created")

    def request(self):
        accepted, pending = self.service.request_otp(RequestOTP(email="resident@example.com", invitation_token=DEMO_INVITATION), "pg-peer")
        if pending:
            self.service.deliver(pending)
        return accepted.challenge_id

    def verify(self, identifier, *, otp="003482", password=DEMO_PASSWORD, key=KEY):
        return self.service.verify_and_signup(VerifySignup(challenge_id=identifier, otp=otp, password=password), key, "pg-peer")

    def test_real_rpc_full_signup_commits_profile_binding_invitation_and_challenge(self):
        identifier = self.request()
        result = self.verify(identifier)
        self.assertEqual(result.user_id, RESIDENT)
        row = self.sql("""SELECT r.profile_id, p.role, i.used_by, c.auth_user_id, c.completed_at IS NOT NULL
                          FROM public.residents r JOIN public.profiles p ON p.id=r.profile_id
                          JOIN public.resident_invitations i ON i.resident_id=r.id
                          JOIN public.email_verification_challenges c ON c.invitation_id=i.id WHERE c.id=%s""",
                       (str(identifier),), fetch=True)[0]
        self.assertEqual(row[:4], (str(RESIDENT), "resident", str(RESIDENT), str(RESIDENT)))
        self.assertTrue(row[4])

    def test_failed_attempt_increments_survive_transaction_returns(self):
        identifier = self.request()
        for attempt in range(1, 6):
            with self.assertRaises(RegistrationRejected):
                self.verify(identifier, otp="999999")
            self.assertEqual(self.sql("SELECT attempt_count FROM public.email_verification_challenges WHERE id=%s",
                                      (str(identifier),), fetch=True)[0][0], attempt)
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertEqual(self.accounts.created, 0)

    def test_expired_otp_cannot_create_account(self):
        identifier = self.request()
        self.sql("UPDATE public.email_verification_challenges SET created_at=now()-interval '10 minutes', expires_at=now()-interval '1 second' WHERE id=%s", (str(identifier),))
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertEqual(self.accounts.created, 0)

    def test_resend_replaces_row_and_rejects_old_code(self):
        first = self.request()
        self.sql("UPDATE public.email_verification_challenges SET created_at=now()-interval '61 seconds' WHERE id=%s", (str(first),))
        second = self.request()
        self.assertNotEqual(first, second)
        with self.assertRaises(RegistrationRejected):
            self.verify(first)
        self.verify(second)

    def test_same_key_retry_reuses_account_and_other_key_is_rejected(self):
        identifier = self.request()
        self.verify(identifier)
        self.verify(identifier)
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier, key="another-postgres-idempotency-key-0000001")
        self.assertEqual(self.accounts.created, 1)

    def test_failed_profile_transaction_preserves_retry_and_does_not_consume_invite(self):
        identifier = self.request()
        # An existing mismatched profile must not be overwritten by signup.
        self.sql("INSERT INTO public.profiles(id,email,role) VALUES (%s,'different@example.com','resident')", (str(RESIDENT),))
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertIsNone(self.sql("SELECT used_at FROM public.resident_invitations WHERE id=%s", (self.invitation_id,), fetch=True)[0][0])
        self.assertIsNone(self.sql("SELECT profile_id FROM public.residents WHERE id=%s", (self.resident_id,), fetch=True)[0][0])
        self.sql("UPDATE public.profiles SET email='resident@example.com' WHERE id=%s", (str(RESIDENT),))
        self.verify(identifier)
        self.assertEqual(self.accounts.created, 1)

    def test_clients_cannot_call_rpc_or_edit_role_and_can_only_read_themselves(self):
        self.verify(self.request())
        for role in ("anon", "authenticated"):
            with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                self.sql("SELECT public.enclave_registration_transition('create_resident', '{}'::jsonb)", role=role)
            for table in ("resident_invitations", "email_verification_challenges", "registration_rate_limits"):
                with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
                    self.sql("SELECT id FROM public." + table if table != "registration_rate_limits" else "SELECT scope FROM public.registration_rate_limits", role=role)
        own = self.sql("SELECT id FROM public.profiles", role="authenticated", user_id=RESIDENT, fetch=True)
        self.assertEqual(own, [(str(RESIDENT),)])
        with self.assertRaises(psycopg2.errors.InsufficientPrivilege):
            self.sql("UPDATE public.profiles SET role='management' WHERE id=%s", (str(RESIDENT),), role="authenticated", user_id=RESIDENT)
        self.sql("UPDATE public.profiles SET full_name='Changed display name' WHERE id=%s", (str(RESIDENT),), role="authenticated", user_id=RESIDENT)
        self.assertEqual(self.sql("SELECT role FROM public.profiles WHERE id=%s", (str(RESIDENT),), fetch=True)[0][0], "resident")

    def test_manager_authorization_duplicate_records_and_shared_unit_rules(self):
        self.assertEqual(self.store.call("create_resident", actor_id=str(RESIDENT), resident_reference="PG-2", full_name="Fake", unit_number="101", registered_email="second@example.com")["state"], "forbidden")
        second = self.store.call("create_resident", actor_id=str(MANAGER), resident_reference="PG-2", full_name="Second Resident", unit_number="101", registered_email="second@example.com")
        self.assertEqual(second["state"], "created")
        duplicate = self.store.call("create_resident", actor_id=str(MANAGER), resident_reference="PG-3", full_name="Duplicate", unit_number="102", registered_email="resident@example.com")
        self.assertEqual(duplicate["state"], "conflict")

    def test_replacement_invitation_revokes_old_one_without_deleting_audit(self):
        result = self.service.issue_invitation(MANAGER, self.resident_id)
        self.assertIsNotNone(self.sql("SELECT revoked_at FROM public.resident_invitations WHERE id=%s", (self.invitation_id,), fetch=True)[0][0])
        self.assertEqual(self.sql("SELECT count(*) FROM public.resident_invitations WHERE resident_id=%s", (self.resident_id,), fetch=True)[0][0], 2)
        self.assertNotEqual(str(result.invitation_id), self.invitation_id)

    def test_rate_budget_is_shared_across_store_instances(self):
        digest = "ab" * 32
        first = SQLStore(self.dsn)
        second = SQLStore(self.dsn)
        for store in (first, second, first):
            self.assertTrue(store.call("rate", scope="request-email", digest=digest)["allowed"])
        self.assertFalse(second.call("rate", scope="request-email", digest=digest)["allowed"])

    def test_concurrent_requests_create_only_one_account(self):
        identifier = self.request()
        entered, release = threading.Event(), threading.Event()
        original = self.accounts.login
        def blocking(email, password):
            entered.set()
            release.wait(5)
            return original(email, password)
        self.accounts.login = blocking
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.verify, identifier)
            self.assertTrue(entered.wait(3))
            with self.assertRaises(RegistrationRejected) as captured:
                self.verify(identifier)
            self.assertEqual(captured.exception.status, 409)
            release.set()
            self.assertEqual(first.result(5).user_id, RESIDENT)
        self.assertEqual(self.accounts.created, 1)

    def test_expired_processing_lease_cannot_write_after_recovery(self):
        identifier = self.request()
        context = self.store.call("challenge", id=str(identifier))
        args = {"id": str(identifier), "expected_digest": context["otp_digest"], "matches": True,
                "request_digest": hashlib.sha256(KEY.encode()).hexdigest()}
        old_lease, new_lease = str(uuid4()), str(uuid4())
        self.assertEqual(self.store.call("acquire", **args, lease=old_lease)["state"], "acquired")
        time.sleep(0.05)
        self.sql("UPDATE public.email_verification_challenges SET processing_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=%s", (str(identifier),))
        self.assertEqual(self.store.call("acquire", **args, lease=new_lease)["state"], "acquired")
        self.assertFalse(self.store.call("remember_auth", id=str(identifier), lease=old_lease, user_id=str(RESIDENT))["recorded"])
        self.assertTrue(self.store.call("remember_auth", id=str(identifier), lease=new_lease, user_id=str(RESIDENT))["recorded"])
        self.assertEqual(self.store.call("finish", id=str(identifier), lease=old_lease, user_id=str(RESIDENT))["state"], "invalid")
        self.assertEqual(self.store.call("finish", id=str(identifier), lease=new_lease, user_id=str(RESIDENT))["state"], "completed")

    def bootstrap_sql(self, identifier, email):
        source = (Path(__file__).resolve().parents[1] / "sql" / "bootstrap_management.sql").read_text(encoding="utf-8")
        source = source.replace("v_user_id uuid := '00000000-0000-0000-0000-000000000000'", "v_user_id uuid := '" + str(identifier) + "'", 1)
        return source.replace("v_expected_email text := 'REPLACE_WITH_MANAGEMENT_APP_EMAIL'", "v_expected_email text := '" + email + "'", 1)

    def test_management_bootstrap_requires_placeholders_confirmed_account_and_matching_email(self):
        source = (Path(__file__).resolve().parents[1] / "sql" / "bootstrap_management.sql").read_text(encoding="utf-8")
        with self.assertRaises(psycopg2.errors.RaiseException):
            self.sql(source)
        identifier = str(uuid4())
        self.sql("INSERT INTO auth.users(id,email) VALUES (%s,'approved-manager@example.com')", (identifier,))
        with self.assertRaises(psycopg2.errors.RaiseException):
            self.sql(self.bootstrap_sql(identifier, "approved-manager@example.com"))
        self.sql("UPDATE auth.users SET email_confirmed_at=now() WHERE id=%s", (identifier,))
        with self.assertRaises(psycopg2.errors.RaiseException):
            self.sql(self.bootstrap_sql(identifier, "wrong-manager@example.com"))
        self.assertEqual(self.sql("SELECT count(*) FROM public.profiles WHERE id=%s", (identifier,), fetch=True)[0][0], 0)

    def test_management_bootstrap_provisions_only_the_approved_account_and_is_repeatable(self):
        identifier = str(uuid4())
        self.sql("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (%s,'approved-manager@example.com',now())", (identifier,))
        source = self.bootstrap_sql(identifier, "approved-manager@example.com")
        self.sql(source)
        self.sql(source)
        self.assertEqual(self.sql("SELECT email,role FROM public.profiles WHERE id=%s", (identifier,), fetch=True),
                         [("approved-manager@example.com", "management")])
        created = self.store.call("create_resident", actor_id=identifier, resident_reference="PG-NEW", full_name="Approved Resident",
                                  unit_number="102", registered_email="new-resident@example.com")
        self.assertEqual(created["state"], "created")

    def test_management_bootstrap_refuses_accounts_with_resident_registration_history(self):
        self.verify(self.request())
        self.sql("UPDATE auth.users SET email='resident@example.com', email_confirmed_at=now() WHERE id=%s", (str(RESIDENT),))
        with self.assertRaises(psycopg2.errors.RaiseException):
            self.sql(self.bootstrap_sql(RESIDENT, "resident@example.com"))
        self.assertEqual(self.sql("SELECT role FROM public.profiles WHERE id=%s", (str(RESIDENT),), fetch=True)[0][0], "resident")


if __name__ == "__main__":
    unittest.main()
