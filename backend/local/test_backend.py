from contextlib import redirect_stdout
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from threading import Barrier
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient
import main as backend
import create_manager


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = "EnclaveTest123!"
        cls.fixture_hash = backend.password_hasher.hash(cls.password)
        cls.user_ids = {
            "alice": "00000000-0000-4000-8000-000000000001",
            "bob": "00000000-0000-4000-8000-000000000002",
            "manager": "00000000-0000-4000-8000-000000000003",
        }

    def setUp(self):
        self.temp = TemporaryDirectory(prefix="enclave-tests-")
        self.addCleanup(self.temp.cleanup)
        original_path = backend.DATABASE_PATH
        self.addCleanup(setattr, backend, "DATABASE_PATH", original_path)
        backend.DATABASE_PATH = Path(self.temp.name) / "test.db"
        self.client = TestClient(backend.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.auth_cache = {}
        with backend.database_connection() as connection:
            for username, user_id in self.user_ids.items():
                connection.execute(
                    """INSERT INTO users (user_id, username, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?, ?)""",
                    (
                        user_id, username, self.fixture_hash,
                        "management" if username == "manager" else "resident",
                        "2026-10-13T01:00:00+00:00",
                    ),
                )

    def auth(self, username="alice"):
        if username not in self.auth_cache:
            response = self.client.post(
                "/auth/login", json={"username": username, "password": self.password}
            )
            self.assertEqual(response.status_code, 200)
            self.auth_cache[username] = {
                "Authorization": "Bearer " + response.json()["access_token"]
            }
        return self.auth_cache[username]

    def report(self, username="alice", description="The street light at the community park entrance is not working"):
        response = self.client.post(
            "/reports", headers=self.auth(username),
            json={"description": description, "latitude": 3.139, "longitude": 101.687},
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def change_status(self, ticket_id, status, username="manager", **extra):
        return self.client.patch(
            f"/management/reports/{ticket_id}/status", headers=self.auth(username),
            json={"status": status, "note": "The issue has been checked and the action recorded", **extra},
        )

    def history(self, ticket_id, username="alice"):
        return self.client.get(f"/reports/{ticket_id}/history", headers=self.auth(username))

    def test_health_is_public(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_signup_hashes_password_and_hides_it(self):
        response = self.client.post(
            "/auth/signup", json={"username": "new_resident", "password": self.password}
        )
        self.assertEqual(response.status_code, 201)
        user = response.json()
        self.assertEqual(user["role"], "resident")
        self.assertNotIn("password", user)
        self.assertNotIn("password_hash", user)
        UUID(user["user_id"])
        with backend.database_connection() as connection:
            row = connection.execute(
                "SELECT password_hash FROM users WHERE user_id = ?", (user["user_id"],)
            ).fetchone()
        self.assertNotEqual(row["password_hash"], self.password)
        self.assertTrue(backend.password_hasher.verify(self.password, row["password_hash"]))

    def test_signup_normalizes_username_and_rejects_duplicates(self):
        response = self.client.post(
            "/auth/signup", json={"username": " New_User ", "password": self.password}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["username"], "new_user")
        duplicate = self.client.post(
            "/auth/signup", json={"username": "NEW_USER", "password": self.password}
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_signup_cannot_choose_management_role(self):
        response = self.client.post(
            "/auth/signup",
            json={"username": "intruder", "password": self.password, "role": "management"},
        )
        self.assertEqual(response.status_code, 422)

    def test_signup_requires_long_password(self):
        response = self.client.post(
            "/auth/signup", json={"username": "short_password", "password": "short"}
        )
        self.assertEqual(response.status_code, 422)

    def test_signup_username_validation(self):
        for username in ("ab", "invalid name", "name@example.com", "x" * 33):
            with self.subTest(username=username):
                response = self.client.post(
                    "/auth/signup", json={"username": username, "password": self.password}
                )
                self.assertEqual(response.status_code, 422)

    def test_password_spaces_are_preserved(self):
        password = "  " + self.password + "  "
        response = self.client.post(
            "/auth/signup", json={"username": "spaces", "password": password}
        )
        self.assertEqual(response.status_code, 201)
        exact = self.client.post(
            "/auth/login", json={"username": "spaces", "password": password}
        )
        trimmed = self.client.post(
            "/auth/login", json={"username": "spaces", "password": password.strip()}
        )
        self.assertEqual(exact.status_code, 200)
        self.assertEqual(trimmed.status_code, 401)

    def test_login_wrong_and_unknown_users(self):
        wrong = self.client.post(
            "/auth/login", json={"username": "alice", "password": "WrongPassword123!"}
        )
        unknown = self.client.post(
            "/auth/login", json={"username": "unknown", "password": self.password}
        )
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json())
        self.assertEqual(wrong.headers["www-authenticate"], "Bearer")

    def test_login_returns_token_and_me(self):
        response = self.client.post(
            "/auth/login", json={"username": " ALICE ", "password": self.password}
        )
        self.assertEqual(response.status_code, 200)
        token = response.json()
        self.assertEqual(token["token_type"], "bearer")
        self.assertEqual(token["expires_in"], 3600)
        current = self.client.get(
            "/auth/me", headers={"Authorization": "Bearer " + token["access_token"]}
        )
        self.assertEqual(current.status_code, 200)
        self.assertEqual(current.json()["user_id"], self.user_ids["alice"])
        self.assertEqual(current.json()["role"], "resident")
        self.assertNotIn("password_hash", current.json())

    def test_tokens_are_stored_as_hashes(self):
        token = self.auth()["Authorization"].removeprefix("Bearer ")
        with backend.database_connection() as connection:
            row = connection.execute("SELECT token_hash FROM sessions").fetchone()
        self.assertNotEqual(row["token_hash"], token)
        self.assertEqual(len(row["token_hash"]), 64)
        self.assertEqual(self.client.get("/auth/me", headers=self.auth()).status_code, 200)

    def test_missing_and_invalid_tokens(self):
        for endpoint in ("/auth/me", "/reports", "/reports/missing", "/management/reports"):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.client.get(endpoint).status_code, 401)
        self.assertEqual(
            self.client.post(
                "/reports", json={"description": "Light", "latitude": 3, "longitude": 101}
            ).status_code, 401,
        )
        for header in ("Bearer invalid-token", "Bearer", "Basic invalid"):
            with self.subTest(header=header):
                response = self.client.get("/auth/me", headers={"Authorization": header})
                self.assertEqual(response.status_code, 401)

    def test_expired_tokens_are_rejected(self):
        headers = self.auth()
        token = headers["Authorization"].removeprefix("Bearer ")
        with backend.database_connection() as connection:
            connection.execute(
                "UPDATE sessions SET expires_at = 0 WHERE token_hash = ?",
                (backend.hash_token(token),),
            )
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)

    def test_logout_revokes_token(self):
        headers = self.auth()
        response = self.client.post("/auth/logout", headers=headers)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)

    def test_report_is_bound_to_logged_in_user(self):
        ticket = self.report()
        self.assertEqual(ticket["user_id"], self.user_ids["alice"])
        self.assertEqual(ticket["status"], "pending_review")
        UUID(ticket["ticket_id"])
        self.assertIsNotNone(datetime.fromisoformat(ticket["created_at"]).utcoffset())
        response = self.client.get("/reports/" + ticket["ticket_id"], headers=self.auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), ticket)
        self.assertEqual(self.client.get("/reports/missing", headers=self.auth()).status_code, 404)

    def test_report_body_cannot_spoof_owner_or_status(self):
        valid = {"description": "Light", "latitude": 3, "longitude": 101}
        for extra in ({"user_id": self.user_ids["bob"]}, {"status": "resolved"}):
            response = self.client.post("/reports", json={**valid, **extra}, headers=self.auth())
            self.assertEqual(response.status_code, 422)

    def test_report_validation_is_preserved(self):
        valid = {"description": "Light", "latitude": 3, "longitude": 101}
        for body in (
            {"latitude": 3, "longitude": 101},
            {**valid, "description": "   "},
            {**valid, "description": "x" * 1001},
            {**valid, "latitude": 100},
            {**valid, "longitude": 181},
        ):
            self.assertEqual(
                self.client.post("/reports", json=body, headers=self.auth()).status_code, 422
            )

    def test_other_resident_cannot_read_report(self):
        ticket = self.report("alice")
        response = self.client.get("/reports/" + ticket["ticket_id"], headers=self.auth("bob"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Report not found"})

    def test_resident_list_and_total_only_include_own_reports(self):
        alice_tickets = [self.report("alice", f"Light {index}") for index in range(3)]
        bob_ticket = self.report("bob")
        alice_list = self.client.get("/reports", headers=self.auth("alice")).json()
        bob_list = self.client.get("/reports", headers=self.auth("bob")).json()
        self.assertEqual(alice_list["total"], 3)
        self.assertEqual(
            {item["ticket_id"] for item in alice_list["items"]},
            {ticket["ticket_id"] for ticket in alice_tickets},
        )
        self.assertEqual(bob_list["total"], 1)
        self.assertEqual(bob_list["items"], [bob_ticket])
        first = self.client.get("/reports?limit=2&offset=0", headers=self.auth()).json()
        last = self.client.get("/reports?limit=2&offset=2", headers=self.auth()).json()
        beyond = self.client.get("/reports?limit=2&offset=3", headers=self.auth()).json()
        self.assertEqual(first["items"] + last["items"], alice_list["items"])
        self.assertEqual(len(first["items"]), 2)
        self.assertEqual(len(last["items"]), 1)
        self.assertEqual(last["total"], 3)
        self.assertEqual(beyond["items"], [])
        self.assertEqual(beyond["total"], 3)

    def test_pagination_defaults_and_validation(self):
        response = self.client.get("/reports", headers=self.auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"items": [], "total": 0, "limit": 10, "offset": 0})
        self.assertEqual(self.client.get("/reports?limit=100", headers=self.auth()).status_code, 200)
        for query in (
            "limit=0", "limit=-1", "limit=101", "limit=1.5", "limit=abc",
            "offset=-1", "offset=1.5", "offset=abc",
        ):
            with self.subTest(query=query):
                self.assertEqual(
                    self.client.get("/reports?" + query, headers=self.auth()).status_code, 422
                )

    def test_ordering_is_deterministic(self):
        with backend.database_connection() as connection:
            for ticket_id in ("00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"):
                connection.execute(
                    """INSERT INTO reports
                    (ticket_id, description, latitude, longitude, status, created_at, user_id)
                    VALUES (?, 'Light', 3, 101, 'pending_review', ?, ?)""",
                    (ticket_id, "2026-10-13T01:00:00+00:00", self.user_ids["alice"]),
                )
        items = self.client.get("/reports", headers=self.auth()).json()["items"]
        self.assertEqual(
            [item["ticket_id"] for item in items],
            ["00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000011"],
        )

    def test_management_can_view_all_reports(self):
        tickets = [self.report("alice"), self.report("bob")]
        headers = self.auth("manager")
        general = self.client.get("/reports", headers=headers)
        management = self.client.get("/management/reports", headers=headers)
        self.assertEqual(general.status_code, 200)
        self.assertEqual(management.status_code, 200)
        self.assertEqual(general.json(), management.json())
        self.assertEqual(management.json()["total"], 2)
        for ticket in tickets:
            response = self.client.get("/reports/" + ticket["ticket_id"], headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), ticket)

    def test_resident_cannot_access_management_endpoint(self):
        response = self.client.get("/management/reports", headers=self.auth())
        self.assertEqual(response.status_code, 403)

    def test_manager_bootstrap_cli(self):
        output = io.StringIO()
        with patch("builtins.input", return_value="test_manager"), patch.object(
            create_manager, "getpass", side_effect=[self.password, self.password]
        ), redirect_stdout(output):
            create_manager.main()
        self.assertNotIn(self.password, output.getvalue())
        response = self.client.post(
            "/auth/login", json={"username": "test_manager", "password": self.password}
        )
        self.assertEqual(response.status_code, 200)
        headers = {"Authorization": "Bearer " + response.json()["access_token"]}
        self.assertEqual(self.client.get("/auth/me", headers=headers).json()["role"], "management")
        self.assertEqual(self.client.get("/management/reports", headers=headers).status_code, 200)

    def test_bootstrap_password_confirmation_mismatch(self):
        with patch("builtins.input", return_value="mismatch"), patch.object(
            create_manager, "getpass", side_effect=[self.password, "DifferentPassword123!"]
        ):
            with self.assertRaises(SystemExit):
                create_manager.main()
        with backend.database_connection() as connection:
            row = connection.execute("SELECT user_id FROM users WHERE username = 'mismatch'").fetchone()
        self.assertIsNone(row)

    def test_bootstrap_does_not_promote_existing_resident(self):
        with patch("builtins.input", return_value="alice"), patch.object(
            create_manager, "getpass", side_effect=[self.password, self.password]
        ):
            with self.assertRaises(SystemExit):
                create_manager.main()
        self.assertEqual(self.client.get("/auth/me", headers=self.auth()).json()["role"], "resident")

    def test_schema_migration_preserves_legacy_reports(self):
        legacy_path = Path(self.temp.name) / "legacy.db"
        original_path = backend.DATABASE_PATH
        legacy = ("legacy-ticket", "Old light report", 3.139, 101.687, "pending_review", "2026-10-12T01:00:00+00:00")
        connection = sqlite3.connect(legacy_path)
        try:
            connection.execute(
                """CREATE TABLE reports (ticket_id TEXT PRIMARY KEY NOT NULL, description TEXT NOT NULL,
                latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)"""
            )
            connection.execute("INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?)", legacy)
            connection.commit()
        finally:
            connection.close()
        backend.DATABASE_PATH = legacy_path
        try:
            backend.initialize_database()
            backend.initialize_database()
            with backend.database_connection() as connection:
                row = connection.execute("SELECT * FROM reports").fetchone()
            self.assertEqual(tuple(row)[:6], legacy)
            self.assertIsNone(row["user_id"])
            for username, role in (("legacy_manager", "management"), ("legacy_resident", "resident")):
                backend.create_account(backend.UserCreate(username=username, password=self.password), role=role)
            manager_headers = self.auth("legacy_manager")
            resident_headers = self.auth("legacy_resident")
            self.assertEqual(self.client.get("/reports/legacy-ticket", headers=manager_headers).status_code, 200)
            self.assertEqual(self.client.get("/reports/legacy-ticket", headers=resident_headers).status_code, 404)
            self.assertEqual(self.client.get("/reports", headers=resident_headers).json()["total"], 0)
            self.assertEqual(self.client.get("/management/reports", headers=manager_headers).json()["total"], 1)
            history = self.client.get("/reports/legacy-ticket/history", headers=manager_headers)
            self.assertEqual(history.json(), {"ticket_id": "legacy-ticket", "status": "pending_review", "items": []})
            self.assertEqual(
                self.client.get("/reports/legacy-ticket/history", headers=resident_headers).status_code, 404,
            )
            changed = self.client.patch(
                "/management/reports/legacy-ticket/status", headers=manager_headers,
                json={"status": "approved", "note": "The legacy report has been checked"},
            )
            self.assertEqual(changed.status_code, 200)
            self.assertIsNone(changed.json()["user_id"])
            events = self.client.get("/reports/legacy-ticket/history", headers=manager_headers).json()["items"]
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["from_status"], "pending_review")
        finally:
            backend.DATABASE_PATH = original_path

    def test_account_token_and_report_survive_process_restart(self):
        ticket = self.report()
        payload = {
            "headers": self.auth(),
            "user_id": self.user_ids["alice"],
            "ticket": ticket,
        }
        payload_path = Path(self.temp.name) / "restart.json"
        payload_path.write_text(json.dumps(payload), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, "-B", str(Path(__file__).resolve()), "--restart-check",
             str(backend.DATABASE_PATH), str(payload_path)],
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_foreign_keys_reject_unknown_report_owner(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with backend.database_connection() as connection:
                connection.execute(
                    """INSERT INTO reports
                    (ticket_id, description, latitude, longitude, status, created_at, user_id)
                    VALUES ('invalid-owner', 'Light', 3, 101, 'pending_review', ?, 'unknown-user')""",
                    ("2026-10-13T01:00:00+00:00",),
                )
        self.assertEqual(self.client.get("/reports", headers=self.auth()).json()["total"], 0)

    def test_sql_like_description_stays_data(self):
        description = "Broken light'); DROP TABLE reports; --"
        ticket = self.report(description=description)
        response = self.client.get("/reports/" + ticket["ticket_id"], headers=self.auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["description"], description)
        self.assertEqual(self.client.get("/reports", headers=self.auth()).json()["total"], 1)

    def test_openapi_marks_routes_as_protected(self):
        schema = self.client.get("/openapi.json").json()
        self.assertEqual(schema["components"]["securitySchemes"]["EnclaveToken"]["scheme"], "bearer")
        for path, method in (
            ("/auth/me", "get"), ("/auth/logout", "post"), ("/reports", "get"),
            ("/reports", "post"), ("/reports/{ticket_id}", "get"), ("/management/reports", "get"),
            ("/reports/{ticket_id}/history", "get"), ("/management/reports/{ticket_id}/status", "patch"),
        ):
            self.assertEqual(schema["paths"][path][method]["security"], [{"EnclaveToken": []}])
        for path, method in (("/auth/signup", "post"), ("/auth/login", "post"), ("/health", "get")):
            self.assertFalse(schema["paths"][path][method].get("security"))

    def test_documented_errors_match_runtime_responses(self):
        schema = self.client.get("/openapi.json").json()
        responses = [
            ("/auth/login", "post", self.client.post(
                "/auth/login", json={"username": "alice", "password": "WrongPassword123!"},
            )),
            ("/auth/signup", "post", self.client.post(
                "/auth/signup", json={"username": "alice", "password": self.password},
            )),
            ("/management/reports", "get", self.client.get(
                "/management/reports", headers=self.auth(),
            )),
            ("/reports/{ticket_id}", "get", self.client.get(
                "/reports/missing", headers=self.auth(),
            )),
            ("/reports", "post", self.client.post(
                "/reports", headers=self.auth(),
                json={"description": "Light", "latitude": 100, "longitude": 101},
            )),
            ("/reports", "get", self.client.get("/reports?limit=0", headers=self.auth())),
            ("/auth/signup", "post", self.client.post(
                "/auth/signup", json={"username": "ab", "password": self.password},
            )),
        ]
        self.assertEqual([r.status_code for _, _, r in responses], [401, 409, 403, 404, 422, 422, 422])
        for path, method, response in responses:
            with self.subTest(path=path, status=response.status_code):
                contract = schema["paths"][path][method]["responses"][str(response.status_code)]
                content = contract["content"]["application/json"]
                model = backend.ValidationErrorResponse if response.status_code == 422 else backend.ErrorResponse
                self.assertEqual(content["schema"]["$ref"], f"#/components/schemas/{model.__name__}")
                model.model_validate(response.json())
                if response.status_code == 401:
                    self.assertEqual(response.headers["www-authenticate"], "Bearer")
                    self.assertIn("WWW-Authenticate", contract["headers"])
                if "example" in content:
                    self.assertEqual(response.json(), content["example"])

    def test_full_maintenance_workflow_records_actor_and_verification(self):
        ticket = self.report()
        ticket_id = ticket["ticket_id"]
        for status in ("approved", "in_progress", "resolved"):
            response = self.change_status(
                ticket_id, status, repair_verified=(status == "resolved"), note=f"  Confirmed {status}  ",
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], status)
            self.assertEqual(response.json()["user_id"], ticket["user_id"])
            self.assertEqual(response.json()["created_at"], ticket["created_at"])
            current = self.client.get(f"/reports/{ticket_id}", headers=self.auth()).json()
            self.assertEqual(current["status"], status)
        result = self.history(ticket_id).json()
        self.assertEqual(result["status"], "resolved")
        events = result["items"]
        self.assertEqual([e["to_status"] for e in events], ["pending_review", "approved", "in_progress", "resolved"])
        self.assertEqual([e["from_status"] for e in events], [None, "pending_review", "approved", "in_progress"])
        self.assertEqual(events[0]["changed_by"], self.user_ids["alice"])
        self.assertEqual([e["changed_by"] for e in events[1:]], [self.user_ids["manager"]] * 3)
        self.assertEqual([e["repair_verified"] for e in events], [False, False, False, True])
        self.assertEqual(events[-1]["note"], "Confirmed resolved")
        self.assertEqual([e["event_id"] for e in events], sorted(e["event_id"] for e in events))
        self.assertIsNotNone(datetime.fromisoformat(events[-1]["created_at"]).utcoffset())

    def test_workflow_requires_management_and_history_preserves_privacy(self):
        ticket_id = self.report()["ticket_id"]
        route = f"/management/reports/{ticket_id}/status"
        self.assertEqual(self.client.patch(route, json={"status": "approved", "note": "Checked"}).status_code, 401)
        for resident in ("alice", "bob"):
            self.assertEqual(self.change_status(ticket_id, "approved", resident).status_code, 403)
        self.assertEqual(self.client.get(f"/reports/{ticket_id}/history").status_code, 401)
        self.assertEqual(self.history(ticket_id, "bob").status_code, 404)
        self.assertEqual(self.history(ticket_id, "manager").status_code, 200)
        self.assertEqual(self.history("missing", "alice").status_code, 404)
        self.assertEqual(len(self.history(ticket_id).json()["items"]), 1)

    def test_rejected_report_is_terminal(self):
        ticket_id = self.report()["ticket_id"]
        self.assertEqual(self.change_status(ticket_id, "rejected", note="The issue is a duplicate or cannot be verified").status_code, 200)
        response = self.change_status(ticket_id, "approved")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Cannot change report status from rejected to approved")
        result = self.history(ticket_id).json()
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(len(result["items"]), 2)

    def test_workflow_rejects_skips_duplicates_and_backward_moves(self):
        ticket_id = self.report()["ticket_id"]
        for status in ("in_progress", "resolved"):
            response = self.change_status(ticket_id, status, repair_verified=(status == "resolved"))
            self.assertEqual(response.status_code, 409)
        self.assertEqual(self.change_status(ticket_id, "approved").status_code, 200)
        self.assertEqual(self.change_status(ticket_id, "approved").status_code, 409)
        self.assertEqual(self.change_status(ticket_id, "resolved", repair_verified=True).status_code, 409)
        self.assertEqual(self.change_status(ticket_id, "in_progress").status_code, 200)
        self.assertEqual(self.change_status(ticket_id, "rejected").status_code, 409)
        self.assertEqual(self.change_status(ticket_id, "resolved", repair_verified=True).status_code, 200)
        self.assertEqual(self.change_status(ticket_id, "in_progress").status_code, 409)
        self.assertEqual(len(self.history(ticket_id).json()["items"]), 4)

    def test_workflow_body_validation_and_manual_verification(self):
        ticket_id = self.report()["ticket_id"]
        self.assertEqual(self.change_status(ticket_id, "approved").status_code, 200)
        self.assertEqual(self.change_status(ticket_id, "in_progress").status_code, 200)
        invalid_bodies = [
            {"status": "resolved", "note": "Checked"},
            {"status": "resolved", "note": "Checked", "repair_verified": False},
            {"status": "resolved", "note": "Checked", "repair_verified": "true"},
            {"status": "resolved", "note": "Checked", "repair_verified": 1},
            {"status": "resolved", "note": "   ", "repair_verified": True},
            {"status": "resolved", "note": "x" * 1001, "repair_verified": True},
            {"status": "resolved", "repair_verified": True},
            {"status": "pending_review", "note": "Reset"},
            {"status": "approved", "note": "Checked", "repair_verified": True},
            {"status": "resolved", "note": "Checked", "repair_verified": True, "changed_by": self.user_ids["bob"]},
        ]
        for body in invalid_bodies:
            with self.subTest(body=body):
                response = self.client.patch(
                    f"/management/reports/{ticket_id}/status", headers=self.auth("manager"), json=body,
                )
                self.assertEqual(response.status_code, 422)
                backend.ValidationErrorResponse.model_validate(response.json())
        result = self.history(ticket_id).json()
        self.assertEqual(result["status"], "in_progress")
        self.assertEqual(len(result["items"]), 3)

    def test_missing_report_cannot_be_updated(self):
        response = self.change_status("missing", "approved")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Report not found"})

    def test_status_filter_applies_to_visible_total_and_pagination(self):
        alice_tickets = [self.report("alice") for _ in range(3)]
        bob_ticket = self.report("bob")
        for ticket in [*alice_tickets[:2], bob_ticket]:
            self.assertEqual(self.change_status(ticket["ticket_id"], "approved").status_code, 200)
        response = self.client.get("/reports?status=approved&limit=1", headers=self.auth())
        self.assertEqual(response.status_code, 200)
        page = response.json()
        self.assertEqual(page["total"], 2)
        self.assertEqual(len(page["items"]), 1)
        self.assertEqual(page["items"][0]["user_id"], self.user_ids["alice"])
        pending = self.client.get("/reports?status=pending_review", headers=self.auth()).json()
        self.assertEqual(pending["total"], 1)
        self.assertEqual(pending["items"][0]["ticket_id"], alice_tickets[-1]["ticket_id"])
        management = self.client.get("/management/reports?status=approved", headers=self.auth("manager")).json()
        self.assertEqual(management["total"], 3)
        empty = self.client.get("/reports?status=resolved", headers=self.auth()).json()
        self.assertEqual(empty["total"], 0)
        self.assertEqual(empty["items"], [])
        for route in ("/reports", "/management/reports"):
            invalid = self.client.get(route, params={"status": "unknown"}, headers=self.auth("manager"))
            self.assertEqual(invalid.status_code, 422)

    def test_status_change_rolls_back_if_history_cannot_be_saved(self):
        ticket_id = self.report()["ticket_id"]
        manager_headers = self.auth("manager")
        with patch.object(backend, "insert_status_event", side_effect=RuntimeError("Test audit failure")):
            with self.assertRaisesRegex(RuntimeError, "Test audit failure"):
                self.client.patch(
                    f"/management/reports/{ticket_id}/status", headers=manager_headers,
                    json={"status": "approved", "note": "Checked"},
                )
        result = self.history(ticket_id).json()
        self.assertEqual(result["status"], "pending_review")
        self.assertEqual(len(result["items"]), 1)

    def test_concurrent_duplicate_review_has_one_change_and_one_event(self):
        ticket_id = self.report()["ticket_id"]
        headers = self.auth("manager")
        barrier = Barrier(2)

        def review(index):
            barrier.wait(timeout=5)
            return self.client.patch(
                f"/management/reports/{ticket_id}/status", headers=headers,
                json={"status": "approved", "note": f"Review {index}"},
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(review, (1, 2)))
        self.assertEqual(sorted(results), [200, 409])
        events = self.history(ticket_id).json()["items"]
        self.assertEqual([event["to_status"] for event in events], ["pending_review", "approved"])

    def test_status_and_history_survive_process_restart(self):
        ticket_id = self.report()["ticket_id"]
        self.assertEqual(self.change_status(ticket_id, "approved").status_code, 200)
        payload = {
            "headers": self.auth(), "user_id": self.user_ids["alice"],
            "ticket": self.client.get(f"/reports/{ticket_id}", headers=self.auth()).json(),
            "history": self.history(ticket_id).json(),
        }
        payload_path = Path(self.temp.name) / "workflow-restart.json"
        payload_path.write_text(json.dumps(payload), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, "-B", str(Path(__file__).resolve()), "--restart-check",
             str(backend.DATABASE_PATH), str(payload_path)],
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_workflow_error_responses_are_in_the_contract(self):
        ticket_id = self.report()["ticket_id"]
        schema = self.client.get("/openapi.json").json()
        path = "/management/reports/{ticket_id}/status"
        responses = [
            self.client.patch(f"/management/reports/{ticket_id}/status", json={"status": "approved", "note": "Checked"}),
            self.change_status(ticket_id, "approved", "alice"),
            self.change_status("missing", "approved"),
            self.change_status(ticket_id, "resolved", repair_verified=True),
            self.change_status(ticket_id, "approved", note=""),
        ]
        self.assertEqual([r.status_code for r in responses], [401, 403, 404, 409, 422])
        for response in responses:
            contract = schema["paths"][path]["patch"]["responses"][str(response.status_code)]
            model = backend.ValidationErrorResponse if response.status_code == 422 else backend.ErrorResponse
            content = contract["content"]["application/json"]
            self.assertEqual(content["schema"]["$ref"], f"#/components/schemas/{model.__name__}")
            model.model_validate(response.json())
            self.assertEqual(content["example"], response.json())


def restart_check(database_path, payload_path):
    backend.DATABASE_PATH = Path(database_path)
    payload = json.loads(Path(payload_path).read_text(encoding="utf-8"))
    with TestClient(backend.app) as client:
        current = client.get("/auth/me", headers=payload["headers"])
        assert current.status_code == 200
        assert current.json()["user_id"] == payload["user_id"]
        report = client.get("/reports/" + payload["ticket"]["ticket_id"], headers=payload["headers"])
        assert report.status_code == 200
        assert report.json() == payload["ticket"]
        if "history" in payload:
            history = client.get("/reports/" + payload["ticket"]["ticket_id"] + "/history", headers=payload["headers"])
            assert history.status_code == 200
            assert history.json() == payload["history"]


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--restart-check":
        restart_check(sys.argv[2], sys.argv[3])
    else:
        unittest.main(verbosity=2)
