"""Exercise signup orchestration and API secrecy with isolated service fakes/transports."""

import hashlib
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from fastapi.testclient import TestClient
import httpx

from backend.registration import PendingEmail, RegistrationRejected
from backend.registration.clients import AccountRejected, RegistrationStore, RegistrationUnavailable, SupabaseSignup
from backend.registration_config import RegistrationSettings
from backend.registration.demo import (DEMO_INVITATION, DEMO_PASSWORD, MANAGER, RESIDENT,
                                       create_demo_app, demo_components)
from backend.registration_models import RequestOTP, VerifySignup
from backend.services.email_service import EmailUnavailable, ResendDelivery


KEY = "synthetic-idempotency-key-000000000001"


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.cloud, self.service, self.store, self.delivery, self.accounts = demo_components()
        self.addCleanup(self.service.close)

    def request(self, **changes):
        body = {"email": "resident@example.com", "invitation_token": DEMO_INVITATION}
        body.update(changes)
        result, pending = self.service.request_otp(RequestOTP(**body), "test-peer")
        if pending:
            self.service.deliver(pending)
        return result.challenge_id

    def verify(self, identifier, *, otp="003482", password=DEMO_PASSWORD, key=KEY):
        return self.service.verify_and_signup(VerifySignup(challenge_id=identifier, otp=otp, password=password), key, "test-peer")

    def test_code_is_only_in_transient_email_not_request_response_or_stored_digest(self):
        identifier = self.request()
        row = self.store.challenges[str(identifier)]
        self.assertEqual(self.delivery.sent[0][1], "003482")
        self.assertNotIn("003482", row["otp_digest"])
        self.assertEqual(len(bytes.fromhex(row["otp_digest"])), 32)
        self.assertNotIn("003482", repr(PendingEmail(identifier, self.store.email, "003482")))

    def test_leading_zero_code_creates_one_account_binds_resident_and_returns_session(self):
        result = self.verify(self.request())
        self.assertEqual(str(result.resident_id), self.store.resident_id)
        self.assertEqual(result.user_id, RESIDENT)
        self.assertEqual(self.store.profile_id, str(RESIDENT))
        self.assertEqual(self.accounts.created, 1)
        self.assertNotIn(result.session.access_token, repr(result))

    def test_wrong_code_commits_counter_and_locks_out_after_five_failures(self):
        identifier = self.request()
        for expected in range(1, 6):
            with self.assertRaises(RegistrationRejected):
                self.verify(identifier, otp="999999")
            self.assertEqual(self.store.challenges[str(identifier)]["attempts"], expected)
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertEqual(self.accounts.created, 0)

    def test_expired_and_unknown_challenges_do_not_authenticate(self):
        identifier = self.request()
        self.store.clock = 301
        for target in (identifier, uuid4()):
            with self.assertRaises(RegistrationRejected):
                self.verify(target)
        self.assertEqual(self.accounts.logged_in, 0)

    def test_resend_revokes_previous_challenge(self):
        first = self.request()
        self.store.clock = 61
        second = self.request()
        self.assertNotEqual(first, second)
        with self.assertRaises(RegistrationRejected):
            self.verify(first)
        self.verify(second)

    def test_send_failure_never_accepts_otp(self):
        self.delivery.fail = True
        identifier = self.request()
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertEqual(self.accounts.created, 0)

    def test_unknown_invitation_returns_acceptance_without_delivery_or_row(self):
        self.request(invitation_token="x" * 43)
        self.assertEqual(self.delivery.sent, [])
        self.assertEqual(self.store.challenges, {})

    def test_email_bound_invitation_cannot_be_used_for_another_address(self):
        self.request(email="someone@example.com")
        self.assertEqual(self.delivery.sent, [])

    def test_context_hmac_cannot_be_transplanted_to_another_challenge(self):
        identifier = self.request()
        first = self.store.call("challenge", id=str(identifier))
        second = {**first, "id": str(uuid4())}
        self.assertNotEqual(self.service.otp_digest(first, "003482"), self.service.otp_digest(second, "003482"))

    def test_duplicate_submit_with_same_key_reuses_account_and_binding(self):
        identifier = self.request()
        first = self.verify(identifier)
        second = self.verify(identifier)
        self.assertEqual(first.user_id, second.user_id)
        self.assertEqual(self.accounts.created, 1)

    def test_replay_with_different_key_cannot_claim_consumed_code(self):
        identifier = self.request()
        self.verify(identifier)
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier, key="another-idempotency-key-0000000000001")
        self.assertEqual(self.accounts.created, 1)

    def test_failed_final_binding_resumes_without_creating_second_account(self):
        identifier = self.request()
        self.store.fail_finish_once = True
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertIsNone(self.store.profile_id)
        self.assertEqual(self.accounts.created, 1)
        self.verify(identifier)
        self.assertEqual(self.accounts.created, 1)

    def test_existing_account_requires_its_password_and_is_never_reset(self):
        self.accounts.password = "existing-correct-password"
        identifier = self.request()
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertIsNone(self.store.profile_id)
        self.assertEqual(self.accounts.password, "existing-correct-password")
        self.verify(identifier, password="existing-correct-password")
        self.assertEqual(self.accounts.created, 0)

    def test_completed_retry_still_requires_password_authentication(self):
        identifier = self.request()
        self.verify(identifier)
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier, password="different-password")

    def test_inactive_resident_cannot_finish_signup(self):
        identifier = self.request()
        self.store.active = False
        with self.assertRaises(RegistrationRejected):
            self.verify(identifier)
        self.assertEqual(self.accounts.created, 0)

    def test_resend_cooldown_and_shared_email_budget(self):
        self.request()
        self.request()
        self.assertEqual(len(self.delivery.sent), 1)
        self.store.clock = 61
        self.request()
        self.store.clock = 122
        self.request()
        self.assertEqual(len(self.delivery.sent), 2)

    def test_concurrent_submit_serializes_auth_creation(self):
        identifier = self.request()
        entered, release = threading.Event(), threading.Event()
        original = self.accounts.login
        def blocking_login(email, password):
            entered.set()
            release.wait(5)
            return original(email, password)
        self.accounts.login = blocking_login
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.verify, identifier)
            self.assertTrue(entered.wait(3))
            with self.assertRaises(RegistrationRejected) as captured:
                self.verify(identifier)
            self.assertEqual(captured.exception.status, 409)
            release.set()
            self.assertEqual(first.result(timeout=5).user_id, RESIDENT)
        self.assertEqual(self.accounts.created, 1)


class RegistrationAPITests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_demo_app())
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def request(self, path="/api/v1/registration/request-otp"):
        return self.client.post(path, json={"email": "resident@example.com", "invitation_token": DEMO_INVITATION})

    def test_public_request_and_legacy_alias_never_return_code_or_provider_response(self):
        for path in ("/api/v1/registration/request-otp", "/api/send-verification-email"):
            response = self.request(path)
            self.assertEqual(response.status_code, 202)
            self.assertEqual(set(response.json()), {"challenge_id", "message"})
            self.assertNotIn("003482", response.text)
            self.assertEqual(response.headers["cache-control"], "no-store")

    def test_full_api_roundtrip_then_own_residency(self):
        identifier = self.request().json()["challenge_id"]
        response = self.client.post("/api/v1/registration/verify-and-signup", headers={"Idempotency-Key": KEY},
                                    json={"challenge_id": identifier, "otp": "003482", "password": DEMO_PASSWORD})
        self.assertEqual(response.status_code, 200)
        token = response.json()["session"]["access_token"]
        own = self.client.get("/api/v1/me/residency", headers={"Authorization": "Bearer " + token})
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own.json()["unit_number"], "DEMO-101")

    def test_validation_does_not_echo_password_code_or_key(self):
        response = self.client.post("/api/v1/registration/verify-and-signup", headers={"Idempotency-Key": KEY},
                                    json={"challenge_id": str(uuid4()), "otp": "123", "password": "secret"})
        self.assertEqual(response.status_code, 422)
        for sensitive in (KEY, "secret", '"123"'):
            self.assertNotIn(sensitive, response.text)

    def test_clients_cannot_supply_role_or_user_identity(self):
        response = self.client.post("/api/v1/registration/request-otp", json={"email": "resident@example.com",
                                    "invitation_token": DEMO_INVITATION, "role": "management", "user_id": str(MANAGER)})
        self.assertEqual(response.status_code, 422)

    def test_missing_or_invalid_token_denies_management_and_residency(self):
        for path in ("/api/v1/me/residency",):
            self.assertEqual(self.client.get(path).status_code, 401)
        body = {"resident_reference": "DEMO-1", "full_name": "Test Resident", "unit_number": "101",
                "registered_email": "resident@example.com"}
        self.assertEqual(self.client.post("/api/v1/management/residents", json=body).status_code, 401)
        response = self.client.post("/api/v1/management/residents", json=body,
                                    headers={"Authorization": "Bearer demo-resident-token"})
        self.assertEqual(response.status_code, 403)


class RegistrationClientTests(unittest.TestCase):
    def setUp(self):
        _, service, _, _, _ = demo_components()
        self.config = service.settings
        service.close()

    def test_resend_uses_configured_sender_five_minutes_and_idempotency(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"id": "synthetic-message-id"})
        client = ResendDelivery(self.config, transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        self.assertEqual(client.send_invite_email("resident@example.com", "003482", "synthetic-challenge"), "synthetic-message-id")
        body = json.loads(requests[0].content)
        self.assertEqual(body["from"], self.config.sender)
        self.assertIn("5 minutes", body["html"])
        self.assertIn("003482", body["html"])
        self.assertEqual(requests[0].headers["Idempotency-Key"], "enclave-otp/synthetic-challenge")

    def test_provider_error_is_not_exposed(self):
        client = ResendDelivery(self.config, transport=httpx.MockTransport(
            lambda req: httpx.Response(403, json={"message": "synthetic-provider-secret"})))
        self.addCleanup(client.close)
        with self.assertRaises(EmailUnavailable) as captured:
            client.send_invite_email("resident@example.com", "003482", "test")
        self.assertNotIn("synthetic-provider-secret", str(captured.exception))

    def test_secret_key_is_apikey_not_bearer_and_rpc_error_is_generic(self):
        def handler(request):
            self.assertEqual(request.headers["apikey"], self.config.admin_key)
            self.assertNotIn("Authorization", request.headers)
            return httpx.Response(404, json={"message": "synthetic-database-secret"})
        client = RegistrationStore(self.config, transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        with self.assertRaises(RegistrationUnavailable) as captured:
            client.call("challenge", id=str(uuid4()))
        self.assertNotIn("synthetic-database-secret", str(captured.exception))

    def test_supabase_create_confirms_email_but_login_returns_session_separately(self):
        requests = []
        def handler(request):
            requests.append(request)
            body = json.loads(request.content)
            if request.url.path.endswith("/admin/users"):
                self.assertTrue(body["email_confirm"])
                self.assertNotIn("role", body)
                return httpx.Response(200, json={"id": str(RESIDENT), "email": "resident@example.com"})
            return httpx.Response(200, json={"access_token": "synthetic-access", "refresh_token": "synthetic-refresh",
                "expires_in": 3600, "token_type": "bearer", "user": {"id": str(RESIDENT), "email": "resident@example.com",
                                                                        "email_confirmed_at": "2026-10-14T00:00:00Z"}})
        client = SupabaseSignup(self.config, transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        self.assertEqual(client.create("resident@example.com", "synthetic-password", "synthetic-challenge"), RESIDENT)
        identifier, session = client.login("resident@example.com", "synthetic-password")
        self.assertEqual(identifier, RESIDENT)
        self.assertEqual(session.access_token, "synthetic-access")
        self.assertNotIn("Authorization", requests[0].headers)
        self.assertEqual(requests[1].headers["apikey"], self.config.cloud.publishable_key)

    def test_upstream_wrong_email_unconfirmed_user_and_empty_tokens_are_rejected(self):
        base = {"access_token": "synthetic-access", "refresh_token": "synthetic-refresh", "expires_in": 3600,
                "user": {"id": str(RESIDENT), "email": "resident@example.com", "email_confirmed_at": "confirmed"}}
        for change in ({"user": {"id": str(RESIDENT), "email": "another@example.com", "email_confirmed_at": "confirmed"}},
                       {"user": {"id": str(RESIDENT), "email": "resident@example.com"}}, {"access_token": ""}):
            with self.subTest(change=list(change)):
                client = SupabaseSignup(self.config, transport=httpx.MockTransport(lambda req: httpx.Response(200, json={**base, **change})))
                self.addCleanup(client.close)
                with self.assertRaises((AccountRejected, RegistrationUnavailable)):
                    client.login("resident@example.com", "synthetic-password")

    def test_secrets_do_not_appear_in_configuration_repr(self):
        for value in (self.config.admin_key, self.config.resend_key, str(self.config.pepper)):
            self.assertNotIn(value, repr(self.config))


if __name__ == "__main__":
    unittest.main()
