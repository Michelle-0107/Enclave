"""Community map authorization, disclosure boundaries, and geographic filtering."""

import json
import time
import unittest
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
import httpx
import jwt

from backend.app import create_app
from backend.core.config import Settings
from backend.reports.map import MAP_COLUMNS
from backend.reports.map_demo import create_map_demo_app


RESIDENT = "00000000-0000-4000-8000-000000000001"


class CommunityMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = ec.generate_private_key(ec.SECP256R1())
        cls.jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(cls.key.public_key()))
        cls.jwk.update(kid="map-fixture", use="sig", alg="ES256")

    def setUp(self):
        self.settings = Settings("https://exampleproject.supabase.co", "sb_secret_map_fixture_only")
        self.map_requests = []
        self.residents = [{"profile_id": RESIDENT, "status": "active", "verified_at": "2026-10-15T00:00:00Z"}]
        now = int(time.time())
        self.token = jwt.encode({"iss": self.settings.project_url + "/auth/v1", "aud": "authenticated",
                                 "role": "authenticated", "sub": RESIDENT, "email": "resident@example.com",
                                 "iat": now - 10, "exp": now + 3600}, self.key,
                                algorithm="ES256", headers={"kid": "map-fixture"})

    def row(self, identifier=1, **changes):
        row = {"id": identifier, "ticket_id": "TICK-MAP-" + str(identifier), "status": "approved",
               "created_at": "2026-10-15T01:00:00Z", "latitude": 3.139, "longitude": 101.687,
               "category": "Streetlight", "priority": "medium", "is_approved": True}
        row.update(changes)
        return row

    def client(self, *, handler=None, rows=None, settings=None, residency_handler=None):
        def maps(request):
            self.map_requests.append(request)
            self.assertEqual(request.method, "GET")
            return handler(request) if handler else httpx.Response(200, json=rows if rows is not None else [self.row()])

        def no_report_access(request):
            raise AssertionError("The map must not use the private owner-report repository")

        application = create_app(settings or self.settings,
            auth_transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"keys": [self.jwk]})),
            residents_transport=httpx.MockTransport(residency_handler or
                (lambda request: httpx.Response(200, json=self.residents))),
            reports_transport=httpx.MockTransport(no_report_access),
            map_transport=httpx.MockTransport(maps))
        client = TestClient(application)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def get(self, client, **params):
        return client.get("/api/v1/map/issues", headers={"Authorization": "Bearer " + self.token}, params=params)

    def test_missing_and_invalid_tokens_deny_access_before_map_query(self):
        client = self.client()
        for headers in ({}, {"Authorization": "Bearer not-a-jwt"}):
            self.assertEqual(client.get("/api/v1/map/issues", headers=headers).status_code, 401)
        self.assertEqual(self.map_requests, [])

    def test_unbound_inactive_and_unverified_users_are_denied(self):
        for residents in ([], [{"profile_id": RESIDENT, "status": "inactive", "verified_at": "2026-10-15T00:00:00Z"}],
                          [{"profile_id": RESIDENT, "status": "active", "verified_at": None}]):
            with self.subTest(residents=residents):
                self.residents = residents
                self.assertEqual(self.get(self.client()).status_code, 403)
        self.assertEqual(self.map_requests, [])

    def test_residency_outage_does_not_query_map(self):
        response = self.get(self.client(residency_handler=lambda request: httpx.Response(503, json={})))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.map_requests, [])

    def test_geojson_uses_longitude_latitude_and_omits_private_fields(self):
        row = self.row(user_id="other-resident-private-id", email="private@example.com",
                       description="private original description", image_url="https://private.example/evidence")
        response = self.get(self.client(rows=[row]))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["type"], "FeatureCollection")
        feature = body["features"][0]
        self.assertEqual(feature["geometry"], {"type": "Point", "coordinates": [101.687, 3.139]})
        self.assertEqual(feature["id"], "1")
        self.assertEqual(feature["properties"]["status"], "approved")
        for value in (row["user_id"], row["email"], row["description"], row["image_url"], self.settings.api_key, self.token):
            self.assertNotIn(value, response.text)
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    def test_query_requests_only_map_columns_and_approved_active_statuses(self):
        self.assertEqual(self.get(self.client()).status_code, 200)
        request = self.map_requests[0]
        self.assertEqual(request.url.params["select"], MAP_COLUMNS)
        self.assertEqual(request.url.params["is_approved"], "eq.true")
        self.assertEqual(request.url.params["status"], "in.(approved,in_progress)")
        self.assertEqual(request.url.params["order"], "created_at.desc.nullslast,id.desc")
        self.assertEqual(request.headers["apikey"], self.settings.api_key)
        self.assertNotIn("authorization", request.headers)
        self.assertNotIn("user_id", request.url.params)

    def test_bbox_is_validated_and_applied_in_database_query(self):
        response = self.get(self.client(), bbox="101.6,3.1,101.8,3.2")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.map_requests[0].url.params["and"],
                         "(longitude.gte.101.6,longitude.lte.101.8,latitude.gte.3.1,latitude.lte.3.2)")

    def test_invalid_bounds_and_pagination_never_query_map(self):
        client = self.client()
        for params in ({"bbox": "nan,0,1,1"}, {"bbox": "0,0,inf,1"}, {"bbox": "2,0,1,1"},
                       {"bbox": "0,2,1,1"}, {"bbox": "-181,0,1,1"}, {"bbox": "0,0,1,91"},
                       {"bbox": "0,0,1"}, {"bbox": "0,0,1,1),or=(true)"},
                       {"limit": 0}, {"limit": 201}, {"offset": -1}, {"include_resolved": "invalid"}):
            with self.subTest(params=params):
                self.assertEqual(self.get(client, **params).status_code, 422)
        self.assertEqual(self.map_requests, [])

    def test_pagination_uses_a_lookahead_row_without_returning_it(self):
        response = self.get(self.client(rows=[self.row(1), self.row(2), self.row(3)]), limit=2, offset=4)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["features"]), 2)
        self.assertEqual(response.json()["pagination"], {"limit": 2, "offset": 4, "returned": 2, "has_more": True})
        self.assertEqual(self.map_requests[0].url.params["limit"], "3")
        self.assertEqual(self.map_requests[0].url.params["offset"], "4")

    def test_empty_map_is_successful_and_not_an_error(self):
        response = self.get(self.client(rows=[]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["features"], [])
        self.assertFalse(response.json()["pagination"]["has_more"])

    def test_resolved_is_opt_in_and_is_never_an_active_barrier(self):
        client = self.client(rows=[self.row(status="resolved")])
        self.assertEqual(self.get(client).status_code, 503)
        response = self.get(client, include_resolved=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["features"][0]["properties"]["status"], "resolved")
        self.assertEqual(self.map_requests[-1].url.params["status"], "in.(approved,in_progress,resolved)")

    def test_unapproved_pending_rejected_and_bad_coordinates_fail_closed(self):
        for changes in ({"is_approved": False}, {"is_approved": 1}, {"status": "pending"},
                        {"status": "rejected"}, {"latitude": 91}, {"longitude": None}):
            with self.subTest(changes=changes):
                response = self.get(self.client(rows=[self.row(**changes)]))
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"detail": "Community map unavailable"})

    def test_upstream_row_outside_requested_bounds_is_not_exposed(self):
        response = self.get(self.client(rows=[self.row(latitude=4)]), bbox="101.6,3.1,101.8,3.2")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("TICK-MAP-1", response.text)

    def test_duplicate_ids_and_oversized_provider_result_fail_closed(self):
        for rows in ([self.row(), self.row()], [self.row(i) for i in range(1, 5)]):
            self.assertEqual(self.get(self.client(rows=rows), limit=2).status_code, 503)

    def test_provider_failures_are_redacted_and_redirects_not_followed(self):
        for status, payload in ((403, {"message": "synthetic-private-provider-body"}),
                                (500, {"message": self.settings.api_key}), (200, {"private": "not-a-list"})):
            response = self.get(self.client(handler=lambda request, status=status, payload=payload:
                                           httpx.Response(status, json=payload)))
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("synthetic-private-provider-body", response.text)
            self.assertNotIn(self.settings.api_key, response.text)
        before = len(self.map_requests)
        self.assertEqual(self.get(self.client(handler=lambda request:
                         httpx.Response(302, headers={"Location": "https://untrusted.example"}))).status_code, 503)
        self.assertEqual(len(self.map_requests), before + 1)

    def test_network_and_invalid_json_errors_are_generic(self):
        def failed(request):
            raise httpx.ConnectError("synthetic-private-network-detail", request=request)
        for handler in (failed, lambda request: httpx.Response(200, content=b"not-json")):
            response = self.get(self.client(handler=handler))
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {"detail": "Community map unavailable"})

    def test_legacy_backend_key_uses_service_bearer_not_resident_token(self):
        key = jwt.encode({"role": "service_role"}, "synthetic-service-role-secret-long-enough", algorithm="HS256")
        settings = Settings(self.settings.project_url, key)
        self.assertEqual(self.get(self.client(settings=settings)).status_code, 200)
        self.assertEqual(self.map_requests[-1].headers["Authorization"], "Bearer " + key)
        self.assertNotEqual(self.map_requests[-1].headers["Authorization"], "Bearer " + self.token)

    def test_report_timestamp_is_not_misrepresented_as_verification_time(self):
        response = self.get(self.client())
        properties = response.json()["features"][0]["properties"]
        self.assertIsNone(properties["verified_at"])
        self.assertTrue(properties["reported_at"].startswith("2026-10-15T01:00:00"))

    def test_openapi_requires_auth_and_exposes_geojson_contract(self):
        schema = create_app().openapi()
        operation = schema["paths"]["/api/v1/map/issues"]["get"]
        self.assertEqual(operation["security"], [{"SupabaseAccessToken": []}])
        self.assertIn("CommunityMapResponse", operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"])


class CommunityMapDemoTests(unittest.TestCase):
    def test_demo_filters_markers_and_requires_only_its_synthetic_token(self):
        with TestClient(create_map_demo_app()) as client:
            path = "/api/v1/map/issues"
            self.assertEqual(client.get(path).status_code, 401)
            headers = {"Authorization": "Bearer demo-resident-token"}
            response = client.get(path, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["features"]), 2)
            self.assertNotIn("DEMO-PENDING", response.text)
            resolved = client.get(path, headers=headers, params={"include_resolved": True})
            self.assertEqual(len(resolved.json()["features"]), 3)
            nearby = client.get(path, headers=headers, params={"bbox": "101.686,3.138,101.688,3.140"})
            self.assertEqual(len(nearby.json()["features"]), 1)


if __name__ == "__main__":
    unittest.main()
