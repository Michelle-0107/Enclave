"""Mocked tests for the read-only connection probe; no Supabase account required."""

from contextlib import redirect_stdout
import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import httpx
import check_supabase as checker


class SupabaseCheckTests(unittest.TestCase):
    def setUp(self):
        self.key = "sb_publishable_synthetic_test_fixture"
        self.settings = checker.Settings("https://exampleproject.supabase.co", self.key)

    def response(self, status, payload):
        return checker.probe_reports(
            self.settings,
            transport=httpx.MockTransport(lambda request: httpx.Response(status, json=payload)),
        )

    def test_probe_is_a_zero_row_get_with_key_in_header_only(self):
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json=[])
        ok, message = checker.probe_reports(self.settings, transport=httpx.MockTransport(handler))
        self.assertTrue(ok)
        self.assertEqual(len(calls), 1)
        request = calls[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(request.url.path, "/rest/v1/reports")
        self.assertEqual(request.url.params["limit"], "0")
        self.assertEqual(request.url.params["select"], ",".join(checker.REPORT_COLUMNS))
        self.assertEqual(request.headers["apikey"], self.key)
        self.assertEqual(request.headers["Accept-Profile"], "public")
        self.assertNotIn("Authorization", request.headers)
        self.assertNotIn(self.key, str(request.url))
        self.assertEqual(request.content, b"")
        self.assertEqual(request.extensions["timeout"]["read"], 10.0)
        self.assertNotIn(self.key, message)

    def test_missing_settings_fail_before_network(self):
        with self.assertRaises(checker.ConfigurationError):
            checker.Settings("", "")

    def test_key_is_excluded_from_settings_repr(self):
        self.assertNotIn(self.key, repr(self.settings))

    def test_rejects_untrusted_or_non_root_project_urls(self):
        urls = [
            "http://exampleproject.supabase.co", "https://supabase.co.attacker.example",
            "https://exampleproject.supabase.co.attacker.example", "https://127.0.0.1",
            "https://exampleproject.supabase.co/rest/v1", "https://exampleproject.supabase.co?key=x",
            "https://exampleproject.supabase.co#fragment", "https://user@exampleref.supabase.co",
            "https://exampleproject.supabase.co:8080", "https://[invalid",
        ]
        for url in urls:
            with self.subTest(url=url), self.assertRaises(checker.ConfigurationError):
                checker.Settings(url, self.key)

    def test_rejects_secret_keys_and_invalid_header_values(self):
        for key in ["sb_secret_synthetic_fixture", self.key + "\nInjected: value", "your-key", "sb_publishable_\u4e2d"]:
            with self.subTest(key_type=key.split("_", 2)[:2]), self.assertRaises(checker.ConfigurationError):
                checker.Settings(self.settings.project_url, key)

    def test_reads_only_named_env_file_and_preserves_environment(self):
        with TemporaryDirectory(prefix="enclave-env-") as directory:
            root = Path(directory)
            (root / ".env").write_text("SUPABASE_PUBLISHABLE_KEY=parent-value\n", encoding="utf-8")
            child = root / "backend"
            child.mkdir()
            env_file = child / ".env"
            env_file.write_text(
                f"SUPABASE_URL={self.settings.project_url}\nSUPABASE_PUBLISHABLE_KEY={self.key}\n",
                encoding="utf-8",
            )
            environment = {}
            result = checker.load_settings(env_file=env_file, environ=environment)
            self.assertEqual(result, self.settings)
            self.assertEqual(environment, {})
            environment["SUPABASE_URL"] = "https://otherproject.supabase.co"
            self.assertEqual(checker.load_settings(env_file=env_file, environ=environment).project_url,
                             "https://otherproject.supabase.co")

    def test_does_not_expand_env_variable_references(self):
        with TemporaryDirectory(prefix="enclave-env-") as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                f"SUPABASE_URL={self.settings.project_url}\nSUPABASE_PUBLISHABLE_KEY=${{OTHER_KEY}}\n",
                encoding="utf-8",
            )
            with self.assertRaises(checker.ConfigurationError):
                checker.load_settings(env_file=env_file, environ={"OTHER_KEY": self.key})

    def test_permission_error_is_actionable_and_redacted(self):
        ok, message = self.response(403, {"code": "42501", "message": self.key})
        self.assertFalse(ok)
        self.assertIn("grants", message)
        self.assertNotIn(self.key, message)

    def test_invalid_key_error_does_not_echo_upstream_body(self):
        ok, message = self.response(401, {"message": self.key})
        self.assertFalse(ok)
        self.assertIn("API key was rejected", message)
        self.assertNotIn(self.key, message)

    def test_missing_column_and_table_errors(self):
        ok, message = self.response(400, {"code": "42703", "message": self.key})
        self.assertFalse(ok)
        self.assertIn("column is missing", message)
        self.assertNotIn(self.key, message)
        ok, message = self.response(404, {"code": "PGRST205", "message": self.key})
        self.assertFalse(ok)
        self.assertIn("route is unavailable", message)

    def test_redirect_is_not_followed(self):
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(307, headers={"Location": "https://attacker.example/"})
        ok, message = checker.probe_reports(self.settings, transport=httpx.MockTransport(handler))
        self.assertFalse(ok)
        self.assertEqual(len(calls), 1)
        self.assertIn("not followed", message)

    def test_network_and_timeout_exceptions_are_redacted(self):
        for error_type in (httpx.ReadTimeout, httpx.ConnectError):
            def handler(request):
                raise error_type(self.key, request=request)
            ok, message = checker.probe_reports(self.settings, transport=httpx.MockTransport(handler))
            self.assertFalse(ok)
            self.assertNotIn(self.key, message)

    def test_invalid_success_payload_does_not_print_records(self):
        for payload in (None, {"data": []}, [{"description": self.key}]):
            ok, message = self.response(200, payload)
            self.assertFalse(ok)
            self.assertIn("Unexpected response", message)
            self.assertNotIn(self.key, message)

    def test_non_json_response_is_handled_without_body_output(self):
        transport = httpx.MockTransport(lambda request: httpx.Response(200, text=self.key))
        ok, message = checker.probe_reports(self.settings, transport=transport)
        self.assertFalse(ok)
        self.assertNotIn(self.key, message)

    def test_main_reports_configuration_without_making_a_request(self):
        output = io.StringIO()
        with patch.object(checker, "load_settings", side_effect=checker.ConfigurationError("Set both values")), \
             patch.object(checker, "probe_reports") as probe, redirect_stdout(output):
            self.assertEqual(checker.main(), 2)
        probe.assert_not_called()
        self.assertIn("Configuration required", output.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
