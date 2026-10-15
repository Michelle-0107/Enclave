"""The deployed root entry point must expose the authenticated cloud application."""

import unittest


class EntrypointTests(unittest.TestCase):
    def test_render_entrypoint_uses_protected_application_and_registration_contract(self):
        from main import app as deployed
        from backend.app import app as protected

        self.assertIs(deployed, protected)
        schema = deployed.openapi()
        self.assertEqual(schema["info"]["version"], "0.4.0")
        self.assertIn("SupabaseAccessToken", schema["paths"]["/api/v1/reports"]["post"]["security"][0])
        request_schema = schema["paths"]["/api/send-verification-email"]["post"]["requestBody"]
        self.assertIn("RequestOTP", request_schema["content"]["application/json"]["schema"]["$ref"])


if __name__ == "__main__":
    unittest.main()
