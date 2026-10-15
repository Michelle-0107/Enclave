"""Exercise real JWT signatures and owner isolation using mocked cloud services."""

from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import time
import unittest
from unittest.mock import MagicMock, patch
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
import httpx
import jwt
from PIL import Image

from backend.config import ConfigurationError, Settings, load_settings
from backend.tools.check_session import check_session
from backend.main import AuthenticatedUser, MAX_PHOTO_BYTES, create_app
from backend.media import MediaServices, MediaUnavailable


OWNER_A = "00000000-0000-4000-8000-000000000001"
OWNER_B = "00000000-0000-4000-8000-000000000002"


class FakeMedia:
    def __init__(self):
        self.uploads = []
        self.analyses = []
        self.result = {"category": "Streetlight", "priority": "medium", "summary": "A streetlight is broken"}
        self.fail = False

    def upload(self, name, data, content_type):
        self.uploads.append((name, data, content_type))
        if self.fail:
            raise MediaUnavailable("synthetic-sensitive-detail")
        return "https://synthetic-bucket.s3.amazonaws.com/" + name

    def analyze(self, data, description):
        self.analyses.append((data, description))
        return self.result


class CloudTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = ec.generate_private_key(ec.SECP256R1())
        cls.other_key = ec.generate_private_key(ec.SECP256R1())
        cls.jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(cls.private_key.public_key()))
        cls.jwk.update(kid="synthetic-key", alg="ES256", use="sig")

    def setUp(self):
        self.settings = Settings("https://exampleproject.supabase.co", "sb_publishable_synthetic_fixture")
        self.media = FakeMedia()
        self.requests = []
        self.residency_requests = []
        self.rows = []
        self.auth_requests = []
        self.tokens = {owner: self.token(owner) for owner in [OWNER_A, OWNER_B]}
        self.resident_records = {
            owner: [{"profile_id": owner, "status": "active", "verified_at": "2026-10-14T01:00:00Z"}]
            for owner in [OWNER_A, OWNER_B]
        }

    def token(self, owner=OWNER_A, *, changes=None, key=None):
        now = int(time.time())
        claims = {"iss": self.settings.project_url + "/auth/v1", "aud": "authenticated",
                  "sub": owner, "email": "resident@example.com", "role": "authenticated",
                  "iat": now - 10, "exp": now + 3600}
        claims.update(changes or {})
        return jwt.encode(claims, key or self.private_key, algorithm="ES256", headers={"kid": "synthetic-key"})

    def auth_handler(self, request):
        self.auth_requests.append(request)
        return httpx.Response(200, json={"keys": [self.jwk]})

    def residents_handler(self, request):
        self.residency_requests.append(request)
        token = request.headers["authorization"].removeprefix("Bearer ")
        owner = next(owner for owner, expected in self.tokens.items() if expected == token)
        self.assertEqual(request.url.path, "/rest/v1/residents")
        self.assertEqual(request.headers["apikey"], self.settings.publishable_key)
        self.assertEqual(request.url.params["profile_id"], "eq." + owner)
        self.assertEqual(request.url.params["select"], "profile_id,status,verified_at")
        return httpx.Response(200, json=self.resident_records[owner])

    def report_handler(self, request):
        self.requests.append(request)
        token = request.headers["authorization"].removeprefix("Bearer ")
        owner = next(owner for owner, expected in self.tokens.items() if expected == token)
        self.assertEqual(request.headers["apikey"], self.settings.publishable_key)
        if request.method == "POST":
            row = json.loads(request.content)
            self.assertEqual(row["user_id"], owner)
            row["created_at"] = "2026-10-14T01:00:00Z"
            self.rows.append(row)
            return httpx.Response(201, json=[row])
        self.assertEqual(request.url.params["user_id"], "eq." + owner)
        rows = [row for row in self.rows if row["user_id"] == owner]
        if "ticket_id" in request.url.params:
            ticket = request.url.params["ticket_id"].removeprefix("eq.")
            rows = [row for row in rows if row["ticket_id"] == ticket]
        offset = int(request.url.params.get("offset", "0"))
        limit = int(request.url.params["limit"])
        return httpx.Response(200, json=rows[offset:offset + limit])

    def client(self, *, report_handler=None, auth_handler=None, residents_handler=None):
        client = TestClient(create_app(
            self.settings, auth_transport=httpx.MockTransport(auth_handler or self.auth_handler),
            reports_transport=httpx.MockTransport(report_handler or self.report_handler), media_services=self.media,
            residents_transport=httpx.MockTransport(residents_handler or self.residents_handler),
        ))
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def headers(self, owner=OWNER_A):
        return {"Authorization": "Bearer " + self.tokens[owner]}

    def submit(self, client, *, owner=OWNER_A, fields=None, data=b"synthetic-photo", content_type="image/jpeg"):
        form = {"description": "The community streetlight is broken", "latitude": "3.139", "longitude": "101.687"}
        form.update(fields or {})
        return client.post("/api/v1/reports", headers=self.headers(owner), data=form,
                           files={"file": ("../../untrusted-name.jpg", data, content_type)})

    def test_health_and_root_do_not_initialize_external_services(self):
        with patch("backend.media.MediaServices._client", side_effect=AssertionError("No AWS calls allowed")):
            client = self.client()
            self.assertEqual(client.get("/health").json(), {"status": "ok"})
            self.assertEqual(client.get("/").status_code, 200)
        self.assertEqual(self.requests + self.auth_requests, [])
        self.assertEqual(self.residency_requests, [])

    def test_missing_token_rejects_every_protected_endpoint_before_side_effects(self):
        client = self.client()
        for method, path in [("GET", "/auth/me"), ("GET", "/api/v1/reports"),
                             ("GET", "/api/v1/reports/TICK-example"), ("POST", "/api/v1/reports")]:
            with self.subTest(method=method, path=path):
                response = client.request(method, path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")
        self.assertEqual(self.media.uploads + self.media.analyses + self.requests, [])
        self.assertEqual(self.residency_requests, [])

    def test_invalid_expired_wrong_project_and_wrong_audience_tokens_are_rejected(self):
        client = self.client()
        tokens = ["opaque-local-token", self.token(key=self.other_key),
                  self.token(changes={"exp": int(time.time()) - 1}),
                  self.token(changes={"iss": "https://other.supabase.co/auth/v1"}),
                  self.token(changes={"aud": "wrong-audience"}), self.token(changes={"role": "service_role"})]
        for token in tokens:
            with self.subTest(length=len(token)):
                self.assertEqual(client.get("/api/v1/reports", headers={"Authorization": "Bearer " + token}).status_code, 401)
        self.assertEqual(self.requests, [])

    def test_current_user_contains_verified_identity_and_no_token(self):
        response = self.client().get("/auth/me", headers=self.headers())
        self.assertEqual(response.json(), {"user_id": OWNER_A, "email": "resident@example.com"})
        self.assertNotIn(self.tokens[OWNER_A], response.text)

    def test_create_preserves_pipeline_and_assigns_owner_from_verified_token(self):
        response = self.submit(self.client())
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["data"][0]["user_id"], OWNER_A)
        self.assertEqual(body["data"][0]["status"], "pending")
        self.assertFalse(body["data"][0]["is_approved"])
        self.assertEqual(body["ai_analysis"], self.media.result)
        self.assertEqual(len(self.media.uploads), 1)
        self.assertEqual(len(self.media.analyses), 1)
        self.assertNotIn("..", self.media.uploads[0][0])
        self.assertEqual(self.requests[0].headers["prefer"], "return=representation")
        self.assertEqual(len(self.residency_requests), 1)

    def test_unbound_inactive_and_unverified_accounts_cannot_use_report_api(self):
        cases = [
            ("unbound", []),
            ("inactive", [{"profile_id": OWNER_A, "status": "inactive", "verified_at": "2026-10-14T01:00:00Z"}]),
            ("unverified", [{"profile_id": OWNER_A, "status": "active", "verified_at": None}]),
        ]
        for label, rows in cases:
            with self.subTest(label=label):
                def handler(request, rows=rows):
                    self.residency_requests.append(request)
                    return httpx.Response(200, json=rows)
                response = self.submit(self.client(residents_handler=handler))
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json(), {"detail": "An active verified resident account is required"})
                self.assertEqual(self.media.uploads + self.media.analyses + self.requests, [])

    def test_resident_directory_failure_is_redacted_and_fails_closed(self):
        def unavailable(request):
            self.residency_requests.append(request)
            return httpx.Response(403, json={"message": self.tokens[OWNER_A]})
        response = self.client(residents_handler=unavailable).get("/api/v1/reports", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Resident verification service unavailable"})
        self.assertNotIn(self.tokens[OWNER_A], response.text)
        self.assertEqual(self.requests, [])

    def test_client_supplied_owner_is_rejected_before_upload(self):
        response = self.submit(self.client(), fields={"user_id": OWNER_B})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.media.uploads + self.requests, [])

    def test_two_users_can_only_list_and_read_their_own_reports(self):
        client = self.client()
        ticket_a = self.submit(client).json()["ticket_id"]
        ticket_b = self.submit(client, owner=OWNER_B).json()["ticket_id"]
        for owner, own, other in [(OWNER_A, ticket_a, ticket_b), (OWNER_B, ticket_b, ticket_a)]:
            with self.subTest(owner=owner):
                items = client.get("/api/v1/reports", headers=self.headers(owner)).json()["items"]
                self.assertEqual([item["ticket_id"] for item in items], [own])
                self.assertEqual(client.get("/api/v1/reports/" + own, headers=self.headers(owner)).status_code, 200)
                denied = client.get("/api/v1/reports/" + other, headers=self.headers(owner))
                unknown = client.get("/api/v1/reports/TICK-unknown", headers=self.headers(owner))
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(denied.json(), unknown.json())

    def test_concurrent_reads_do_not_share_user_sessions(self):
        client = self.client()
        self.submit(client)
        self.submit(client, owner=OWNER_B)
        owners = [OWNER_A, OWNER_B] * 8
        def read(owner):
            response = client.get("/api/v1/reports", headers=self.headers(owner))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(all(item["user_id"] == owner for item in response.json()["items"]))
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(read, owners))

    def test_user_id_query_parameter_cannot_select_another_owner(self):
        response = self.client().get("/api/v1/reports", params={"user_id": OWNER_B}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.requests[0].url.params["user_id"], "eq." + OWNER_A)

    def test_pagination_is_bounded_and_owner_filtered(self):
        client = self.client()
        for _ in range(3):
            self.submit(client)
        response = client.get("/api/v1/reports?limit=1&offset=1", headers=self.headers())
        self.assertEqual(len(response.json()["items"]), 1)
        self.assertEqual(response.json()["limit"], 1)
        self.assertEqual(self.requests[-1].url.params["order"], "created_at.desc,ticket_id.desc")
        for query in ["limit=0", "limit=101", "offset=-1", "limit=bad"]:
            self.assertEqual(client.get("/api/v1/reports?" + query, headers=self.headers()).status_code, 422)

    def test_missing_location_and_out_of_range_coordinates_are_rejected(self):
        client = self.client()
        for fields in [{"latitude": "91"}, {"longitude": "181"}, {"latitude": "nan"}, {"longitude": "inf"}]:
            self.assertEqual(self.submit(client, fields=fields).status_code, 422)
        response = client.post("/api/v1/reports", headers=self.headers(), data={"description": "Broken light"},
                               files={"file": ("photo.jpg", b"photo", "image/jpeg")})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.media.uploads, [])

    def test_description_is_trimmed_and_whitespace_only_is_rejected(self):
        client = self.client()
        self.assertEqual(self.submit(client, fields={"description": "   "}).status_code, 422)
        self.assertEqual(self.submit(client, fields={"description": "x" * 1001}).status_code, 422)
        self.assertEqual(self.submit(client, fields={"description": "  Broken light  "}).status_code, 201)
        self.assertEqual(self.media.analyses[0][1], "Broken light")

    def test_empty_oversized_and_unsupported_photos_are_rejected(self):
        client = self.client()
        self.assertEqual(self.submit(client, data=b"").status_code, 422)
        self.assertEqual(self.submit(client, data=b"x" * (MAX_PHOTO_BYTES + 1)).status_code, 413)
        self.assertEqual(self.submit(client, content_type="application/pdf").status_code, 415)
        self.assertEqual(self.media.uploads, [])

    def test_invalid_ai_output_uses_the_manual_review_fallback(self):
        self.media.result = {"category": "invented", "priority": "urgent", "summary": "bad"}
        response = self.submit(self.client())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["ai_analysis"]["category"], "Damaged Facility")
        self.assertEqual(response.json()["ai_analysis"]["summary"], "The community streetlight is broken")

    def test_photo_storage_failure_is_redacted_and_does_not_insert(self):
        self.media.fail = True
        response = self.submit(self.client())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Photo storage unavailable"})
        self.assertNotIn("synthetic-sensitive-detail", response.text)
        self.assertEqual(self.requests, [])

    def test_database_policy_denial_is_403_without_upstream_details(self):
        def handler(request):
            return httpx.Response(403, json={"message": self.tokens[OWNER_A]})
        response = self.submit(self.client(report_handler=handler))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "Report access denied by database policy"})
        self.assertNotIn(self.tokens[OWNER_A], response.text)

    def test_database_network_failure_is_503_and_redacted(self):
        def handler(request):
            raise httpx.ConnectError(self.settings.publishable_key, request=request)
        response = self.client(report_handler=handler).get("/api/v1/reports", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(self.settings.publishable_key, response.text)

    def test_database_redirect_is_not_followed(self):
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(302, headers={"Location": "https://attacker.example"})
        response = self.client(report_handler=handler).get("/api/v1/reports", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(len(calls), 1)

    def test_malformed_database_payload_is_503(self):
        for payload in [{"private": "value"}, [{"ticket_id": "missing-fields"}]]:
            def handler(request):
                return httpx.Response(200, json=payload)
            response = self.client(report_handler=handler).get("/api/v1/reports", headers=self.headers())
            self.assertEqual(response.status_code, 503)

    def test_upstream_owner_mismatch_never_returns_another_users_record(self):
        client = self.client()
        self.submit(client, owner=OWNER_B)
        def handler(request):
            return httpx.Response(200, json=self.rows)
        response = self.client(report_handler=handler).get("/api/v1/reports", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(OWNER_B, response.text)

    def test_insert_response_owner_mismatch_is_rejected(self):
        def handler(request):
            row = json.loads(request.content)
            row["user_id"] = OWNER_B
            return httpx.Response(201, json=[row])
        self.assertEqual(self.submit(self.client(report_handler=handler)).status_code, 503)

    def test_query_filter_injection_in_ticket_id_is_rejected(self):
        response = self.client().get("/api/v1/reports/eq.a,or(user_id.eq.other)", headers=self.headers())
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.requests, [])

    def test_auth_outage_is_503_before_database_requests(self):
        def handler(request):
            return httpx.Response(500, json={"message": "synthetic-secret"})
        response = self.client(auth_handler=handler).get("/api/v1/reports", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.requests, [])

    def test_openapi_defines_authentication_and_does_not_accept_owner_input(self):
        schema = create_app().openapi()
        for path in ["/auth/me", "/api/v1/reports", "/api/v1/reports/{ticket_id}"]:
            for operation in schema["paths"][path].values():
                self.assertEqual(operation["security"], [{"SupabaseAccessToken": []}])
        ref = schema["paths"]["/api/v1/reports"]["post"]["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"]
        body = schema["components"]["schemas"][ref.rsplit("/", 1)[1]]
        self.assertNotIn("user_id", body["properties"])
        self.assertTrue({"latitude", "longitude", "description", "file"}.issubset(set(body["required"])))

    def test_credentials_are_excluded_from_repr(self):
        self.assertNotIn(self.settings.publishable_key, repr(self.settings))
        user = AuthenticatedUser(UUID(OWNER_A), "resident@example.com", self.tokens[OWNER_A])
        self.assertNotIn(self.tokens[OWNER_A], repr(user))

    def test_configuration_does_not_accept_service_keys_or_untrusted_urls(self):
        for url, key in [("https://attacker.example", self.settings.publishable_key),
                         (self.settings.project_url, "sb_secret_synthetic"),
                         (self.settings.project_url, "sb_publishable_x\nInjected")]:
            with self.assertRaises(ConfigurationError):
                Settings(url, key)

    def test_configuration_reads_only_named_file_and_environment_overrides(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("SUPABASE_URL=https://exampleproject.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_file\n",
                            encoding="utf-8")
            configured = load_settings(env_file=path, environ={"SUPABASE_PUBLISHABLE_KEY": "sb_publishable_override"})
            self.assertEqual(configured.publishable_key, "sb_publishable_override")
            self.assertEqual(configured.project_url, self.settings.project_url)

    def test_startup_error_is_sanitized(self):
        with patch("backend.main.load_settings", side_effect=ConfigurationError("synthetic-secret")):
            with self.assertRaises(RuntimeError) as captured:
                with TestClient(create_app()):
                    pass
        self.assertNotIn("synthetic-secret", str(captured.exception))

    def test_missing_s3_settings_do_not_require_aws_or_ai_for_auth(self):
        service = MediaServices(self.settings)
        with self.assertRaises(MediaUnavailable):
            service.upload("photo.jpg", b"photo", "image/jpeg")

    def test_session_helper_verifies_identity_and_hides_token_in_repr(self):
        def handler(request):
            if request.url.host == "exampleproject.supabase.co":
                self.assertEqual(request.headers["apikey"], self.settings.publishable_key)
                return httpx.Response(200, json={"access_token": self.tokens[OWNER_A], "user": {"id": OWNER_A}})
            self.assertEqual(str(request.url), "http://127.0.0.1:8001/auth/me")
            self.assertEqual(request.headers["authorization"], "Bearer " + self.tokens[OWNER_A])
            return httpx.Response(200, json={"user_id": OWNER_A, "email": "resident@example.com"})
        result = check_session(self.settings, "resident@example.com", "synthetic-password", port=8001,
                               transport=httpx.MockTransport(handler))
        self.assertTrue(result.success)
        self.assertEqual(result.access_token, self.tokens[OWNER_A])
        self.assertNotIn(self.tokens[OWNER_A], result.message + repr(result))

    def test_session_helper_redacts_login_errors_and_rejects_user_mismatch(self):
        def failed(request):
            return httpx.Response(400, json={"error_code": "invalid_credentials", "message": "synthetic-password"})
        result = check_session(self.settings, "resident@example.com", "synthetic-password",
                               transport=httpx.MockTransport(failed))
        self.assertFalse(result.success)
        self.assertIn("Authentication > Users", result.message)
        self.assertNotIn("synthetic-password", result.message)
        def mismatch(request):
            if request.url.host == "exampleproject.supabase.co":
                return httpx.Response(200, json={"access_token": self.tokens[OWNER_A], "user": {"id": OWNER_A}})
            return httpx.Response(200, json={"user_id": OWNER_B})
        result = check_session(self.settings, "resident@example.com", "synthetic-password",
                               transport=httpx.MockTransport(mismatch))
        self.assertFalse(result.success)
        self.assertIsNone(result.access_token)

    def image_bytes(self):
        stream = io.BytesIO()
        Image.new("RGB", (2, 2), "white").save(stream, format="PNG")
        return stream.getvalue()

    def test_s3_adapter_preserves_storage_parameters(self):
        settings = Settings(self.settings.project_url, self.settings.publishable_key, {"S3_BUCKET_NAME": "synthetic-bucket"})
        service = MediaServices(settings)
        client = MagicMock()
        with patch.object(service, "_client", return_value=client):
            url = service.upload("photo.png", b"synthetic-photo", "image/png")
        self.assertEqual(url, "https://synthetic-bucket.s3.amazonaws.com/photo.png")
        client.put_object.assert_called_once_with(Bucket="synthetic-bucket", Key="photo.png", Body=b"synthetic-photo", ContentType="image/png")

    def test_bedrock_adapter_preserves_analysis_and_uses_actual_png_format(self):
        service = MediaServices(self.settings)
        client = MagicMock()
        client.invoke_model.return_value = {"body": io.BytesIO(json.dumps({"output": {"message": {
            "content": [{"text": json.dumps(self.media.result)}]}}}).encode())}
        with patch.object(service, "_client", return_value=client):
            result = service.analyze(self.image_bytes(), "Broken light")
        self.assertEqual(result, self.media.result)
        payload = json.loads(client.invoke_model.call_args.kwargs["body"])
        self.assertEqual(payload["messages"][0]["content"][0]["image"]["format"], "png")

    def test_bedrock_failure_uses_gemini_fallback(self):
        settings = Settings(self.settings.project_url, self.settings.publishable_key, {"GEMINI_API_KEY": "synthetic-test-key"})
        service = MediaServices(settings)
        client = MagicMock()
        client.__enter__.return_value = client
        client.models.generate_content.return_value.text = json.dumps(self.media.result)
        with patch.object(service, "_client", side_effect=RuntimeError("synthetic failure")), \
             patch("google.genai.Client", return_value=client):
            result = service.analyze(self.image_bytes(), "Broken light")
        self.assertEqual(result, self.media.result)
        client.models.generate_content.assert_called_once()

    def test_unavailable_ai_providers_use_manual_review_fallback(self):
        service = MediaServices(self.settings)
        with patch.object(service, "_client", side_effect=RuntimeError("synthetic failure")):
            result = service.analyze(self.image_bytes(), "Broken light")
        self.assertEqual(result, {"category": "Damaged Facility", "priority": "medium", "summary": "Broken light"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
