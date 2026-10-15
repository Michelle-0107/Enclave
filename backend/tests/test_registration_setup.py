"""Check the fixed registration environment contract without mutating private settings."""

from pathlib import Path
import tempfile
import unittest

import httpx

from backend.core.config import ConfigurationError
from backend.registration.demo import demo_components
from backend.tools.check_registration import check_configuration, check_database
from backend.tools.setup_registration import prepare_env


JWT_SECRET = "synthetic-jwt-secret-for-registration-tests-0001"


class RegistrationSetupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / ".env"

    def test_environment_check_reports_only_canonical_missing_names_and_never_writes(self):
        original = ("SUPABASE_URL=https://exampleproject.supabase.co\n"
                    "SUPABASE_KEY=sb_secret_synthetic_admin_key_long_enough_for_otp_derivation\n")
        self.path.write_text(original, encoding="utf-8")
        before = self.path.read_bytes()
        self.assertEqual(prepare_env(self.path), ("RESEND_API_KEY",))
        self.assertEqual(self.path.read_bytes(), before)

    def test_complete_synthetic_config_passes_without_provider_calls(self):
        text = ("SUPABASE_URL=https://exampleproject.supabase.co\n"
                "SUPABASE_KEY=sb_secret_synthetic_admin_key_long_enough_for_otp_derivation\n"
                "RESEND_API_KEY=re_fixture\n")
        self.path.write_text(text, encoding="utf-8")
        before = self.path.read_bytes()
        result, settings = check_configuration(env_file=self.path, environ={})
        self.assertTrue(result.ready)
        # Keep the OTP key protocol compatible with the local cloud package.
        self.assertEqual(settings.pepper.hex(),
                         "73617786d20b7ac73159a4eae394f3e407143799f0d4f93a95fee486f6683e44")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertNotIn(settings.admin_key, repr(result))
        self.assertNotIn(settings.resend_key, repr(result))
        self.assertNotIn(JWT_SECRET, repr(result))

    def test_optional_but_invalid_jwt_secret_is_redacted_and_fails_closed(self):
        self.path.write_text(
            "SUPABASE_URL=https://exampleproject.supabase.co\n"
            "SUPABASE_KEY=sb_secret_synthetic_admin_key_long_enough_for_otp_derivation\n"
            "SUPABASE_JWT_SECRET=too-short-secret\n"
            "RESEND_API_KEY=re_fixture\n",
            encoding="utf-8",
        )
        result, settings = check_configuration(env_file=self.path, environ={})
        self.assertFalse(result.ready)
        self.assertIsNone(settings)
        self.assertNotIn("too-short-secret", repr(result))

    def test_shared_example_file_is_read_only_and_rejected_by_private_checker(self):
        with self.assertRaises(ConfigurationError):
            prepare_env(self.path.with_name(".env.example"))

    def test_database_probe_uses_only_the_non_mutating_unknown_action(self):
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
