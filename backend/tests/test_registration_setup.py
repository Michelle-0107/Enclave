"""Verify private setup preserves credentials and diagnostic probes cannot mutate registration."""

import base64
from io import StringIO
from pathlib import Path
import tempfile
import unittest

from dotenv import dotenv_values
import httpx

from backend.check_registration import check_configuration, check_database
from backend.config import ConfigurationError
from backend.registration_demo import demo_components
from backend.setup_registration import prepare_env


class RegistrationSetupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / ".env"

    def values(self):
        return dotenv_values(self.path, interpolate=False, encoding="utf-8-sig")

    def test_generated_secret_is_32_bytes_and_preserves_existing_settings_and_private_backup(self):
        original = 'SUPABASE_URL=https://exampleproject.supabase.co\r\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture\r\nAWS_SECRET_ACCESS_KEY="synthetic-$-secret"\r\nCUSTOM_VALUE="${literal}"\r\n'
        self.path.write_bytes(original.encode())
        initialized, backup = prepare_env(self.path)
        self.assertTrue(initialized)
        self.assertEqual(backup.read_bytes(), original.encode())
        values = self.values()
        encoded = values["OTP_HMAC_SECRET"]
        self.assertEqual(len(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))), 32)
        self.assertEqual(values["OTP_HMAC_VERSION"], "1")
        for key, value in dotenv_values(stream=StringIO(original), interpolate=False).items():
            self.assertEqual(values[key], value)
        self.assertEqual(values["SUPABASE_SECRET_KEY"], "")
        self.assertEqual(values["RESEND_API_KEY"], "")
        self.assertEqual(values["RESEND_FROM_EMAIL"], "")

    def test_repeated_setup_keeps_secret_and_file_identical(self):
        prepare_env(self.path)
        original = self.path.read_bytes()
        initialized, backup = prepare_env(self.path)
        self.assertFalse(initialized)
        self.assertIsNone(backup)
        self.assertEqual(self.path.read_bytes(), original)

    def test_whitespace_only_otp_fields_are_prepared_as_missing_values(self):
        self.path.write_text('OTP_HMAC_SECRET="   "\nOTP_HMAC_VERSION="   "\n', encoding="utf-8")
        initialized, _ = prepare_env(self.path)
        self.assertTrue(initialized)
        self.assertEqual(self.values()["OTP_HMAC_VERSION"], "1")
        self.assertTrue(self.values()["OTP_HMAC_SECRET"].strip())

    def test_existing_secret_version_and_bom_are_preserved(self):
        secret = base64.urlsafe_b64encode(b"synthetic-existing-key-32-bytes!!!").decode().rstrip("=")
        text = "OTP_HMAC_SECRET=" + secret + "\nOTP_HMAC_VERSION=9\n"
        self.path.write_bytes(b"\xef\xbb\xbf" + text.encode())
        initialized, _ = prepare_env(self.path)
        self.assertFalse(initialized)
        self.assertTrue(self.path.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertEqual(self.values()["OTP_HMAC_SECRET"], secret)
        self.assertEqual(self.values()["OTP_HMAC_VERSION"], "9")

    def test_invalid_existing_secret_or_version_is_not_silently_rotated(self):
        for text in ("OTP_HMAC_SECRET=invalid-private-value\n", "OTP_HMAC_VERSION=32768\n"):
            self.path.write_text(text, encoding="utf-8")
            original = self.path.read_bytes()
            with self.assertRaises(ConfigurationError) as captured:
                prepare_env(self.path)
            self.assertNotIn("invalid-private-value", str(captured.exception))
            self.assertEqual(self.path.read_bytes(), original)

    def test_duplicate_settings_and_shared_template_are_refused_before_writing(self):
        self.path.write_text("RESEND_API_KEY=first\nRESEND_API_KEY=second\n", encoding="utf-8")
        original = self.path.read_bytes()
        with self.assertRaises(ConfigurationError):
            prepare_env(self.path)
        self.assertEqual(self.path.read_bytes(), original)
        with self.assertRaises(ConfigurationError):
            prepare_env(self.path.with_name(".env.example"))

    def test_offline_check_reports_only_three_missing_fields_after_preparation(self):
        self.path.write_text("SUPABASE_URL=https://exampleproject.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture\n", encoding="utf-8")
        prepare_env(self.path)
        result, settings = check_configuration(env_file=self.path, environ={})
        self.assertFalse(result.ready)
        self.assertIsNone(settings)
        self.assertIn("OTP secret/version: valid; value hidden.", result.messages)
        missing = result.messages[-1]
        self.assertIn("SUPABASE_SECRET_KEY", missing)
        self.assertIn("RESEND_API_KEY", missing)
        self.assertIn("RESEND_FROM_EMAIL", missing)
        self.assertNotIn("OTP_HMAC_SECRET", missing)
        self.assertNotIn(self.values()["OTP_HMAC_SECRET"], repr(result))

    def test_complete_synthetic_config_passes_without_any_provider_calls(self):
        self.path.write_text("SUPABASE_URL=https://exampleproject.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture\nSUPABASE_SECRET_KEY=sb_secret_fixture\nRESEND_API_KEY=re_fixture\nRESEND_FROM_EMAIL=Enclave <fixture@example.com>\n", encoding="utf-8")
        prepare_env(self.path)
        result, settings = check_configuration(env_file=self.path, environ={})
        self.assertTrue(result.ready)
        self.assertNotIn(settings.admin_key, repr(result))
        self.assertNotIn(settings.resend_key, repr(result))

    def test_database_probe_uses_only_the_unsupported_no_mutation_action(self):
        _, service, _, _, _ = demo_components()
        self.addCleanup(service.close)
        def handler(request):
            import json
            self.assertEqual(json.loads(request.content), {"p_action": "__readiness_no_mutation__", "p_args": {}})
            self.assertNotIn("Authorization", request.headers)
            self.assertEqual(request.headers["apikey"], service.settings.admin_key)
            return httpx.Response(200, json={"state": "invalid"})
        self.assertTrue(check_database(service.settings, transport=httpx.MockTransport(handler)).ready)

    def test_database_probe_error_does_not_display_provider_body_or_keys(self):
        _, service, _, _, _ = demo_components()
        self.addCleanup(service.close)
        result = check_database(service.settings, transport=httpx.MockTransport(
            lambda request: httpx.Response(403, json={"message": "synthetic-private-error"})))
        self.assertFalse(result.ready)
        self.assertNotIn("synthetic-private-error", repr(result))
        self.assertNotIn(service.settings.admin_key, repr(result))


if __name__ == "__main__":
    unittest.main()
