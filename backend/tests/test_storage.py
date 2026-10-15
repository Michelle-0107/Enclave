"""Validate AWS credential wiring and storage checks without contacting AWS."""

from contextlib import redirect_stdout
import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError, EndpointConnectionError
from PIL import Image

from backend.check_storage import check_storage, main, validate_storage_settings
from backend.config import load_service_values
from backend.media import MediaServices, MediaUnavailable, aws_client_options, create_aws_client
from backend.config import Settings


VALUES = {
    "AWS_ACCESS_KEY_ID": "synthetic-key-id", "AWS_SECRET_ACCESS_KEY": "synthetic-secret-value",
    "AWS_REGION": "us-east-1", "S3_BUCKET_NAME": "synthetic-bucket",
}


class StorageTests(unittest.TestCase):
    def client(self, *, version=None):
        client = MagicMock()
        client.put_object.return_value = {"VersionId": version} if version else {}
        def download(**kwargs):
            return {"Body": io.BytesIO(client.put_object.call_args.kwargs["Body"]), "ContentType": "image/png"}
        client.get_object.side_effect = download
        return client

    def error(self, operation="GetObject"):
        return ClientError({"Error": {"Code": "AccessDenied", "Message": VALUES["AWS_SECRET_ACCESS_KEY"]}}, operation)

    def test_service_loader_does_not_require_supabase_or_expose_unrelated_settings(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("AWS_ACCESS_KEY_ID=synthetic-file-id\nAWS_SECRET_ACCESS_KEY=synthetic-file-secret\n"
                            "AWS_REGION=us-east-1\nS3_BUCKET_NAME=synthetic-bucket\nUNRELATED_PASSWORD=private\n", encoding="utf-8")
            values = load_service_values(env_file=path, environ={"AWS_ACCESS_KEY_ID": VALUES["AWS_ACCESS_KEY_ID"]})
        self.assertEqual(validate_storage_settings(values), ("synthetic-bucket", "us-east-1"))
        self.assertEqual(values["AWS_ACCESS_KEY_ID"], VALUES["AWS_ACCESS_KEY_ID"])
        self.assertNotIn("UNRELATED_PASSWORD", values)

    def test_standard_credentials_are_wired_into_the_sdk_with_bounded_s3_requests(self):
        values = {**VALUES, "AWS_SESSION_TOKEN": "synthetic-session-token"}
        with patch("boto3.client") as factory:
            client = create_aws_client("s3", values)
        self.assertIs(client, factory.return_value)
        arguments = factory.call_args.kwargs
        self.assertEqual(factory.call_args.args, ("s3",))
        self.assertEqual(arguments["aws_access_key_id"], VALUES["AWS_ACCESS_KEY_ID"])
        self.assertEqual(arguments["aws_secret_access_key"], VALUES["AWS_SECRET_ACCESS_KEY"])
        self.assertEqual(arguments["aws_session_token"], "synthetic-session-token")
        self.assertEqual(arguments["config"].connect_timeout, 5)
        self.assertEqual(arguments["config"].read_timeout, 10)
        self.assertTrue(arguments["config"].ignore_configured_endpoint_urls)

    def test_legacy_access_key_and_default_region_are_supported(self):
        values = {"AWS_ACCESS_KEY": VALUES["AWS_ACCESS_KEY_ID"], "AWS_SECRET_ACCESS_KEY": VALUES["AWS_SECRET_ACCESS_KEY"],
                  "AWS_DEFAULT_REGION": "ap-southeast-1", "S3_BUCKET_NAME": "synthetic-bucket"}
        self.assertEqual(validate_storage_settings(values), ("synthetic-bucket", "ap-southeast-1"))
        self.assertEqual(aws_client_options(values)["aws_access_key_id"], VALUES["AWS_ACCESS_KEY_ID"])
        self.assertNotIn("aws_access_key_id", aws_client_options({}))

    def test_incomplete_or_conflicting_credentials_fail_before_sdk_creation(self):
        cases = [{"AWS_ACCESS_KEY_ID": "synthetic-id"}, {"AWS_SECRET_ACCESS_KEY": "synthetic-secret"},
                 {"AWS_SESSION_TOKEN": "synthetic-token"}, {**VALUES, "AWS_ACCESS_KEY": "different-synthetic-id"}]
        for values in cases:
            with self.subTest(names=sorted(values)), patch("boto3.client") as factory:
                with self.assertRaises(ValueError):
                    create_aws_client("s3", values)
                factory.assert_not_called()

    def test_smoke_test_rejects_missing_destination_and_default_credential_discovery(self):
        for overrides in [{"S3_BUCKET_NAME": ""}, {"S3_BUCKET_NAME": "https://example.test/bucket"},
                          {"S3_BUCKET_NAME": "127.0.0.1"}, {"AWS_REGION": ""}, {"AWS_REGION": "bad"},
                          {"AWS_ACCESS_KEY_ID": "", "AWS_SECRET_ACCESS_KEY": ""}]:
            with self.subTest(fields=sorted(overrides)), patch("backend.check_storage.create_aws_client") as factory:
                with self.assertRaises(ValueError):
                    check_storage({**VALUES, **overrides})
                factory.assert_not_called()

    def test_default_cli_is_configuration_only_and_never_displays_credentials(self):
        output = io.StringIO()
        with patch("backend.check_storage.load_service_values", return_value=VALUES), \
             patch("backend.check_storage.check_storage") as checker, redirect_stdout(output):
            self.assertEqual(main([]), 0)
        checker.assert_not_called()
        self.assertIn("No AWS requests", output.getvalue())
        for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
            self.assertNotIn(VALUES[name], output.getvalue())

    def test_success_uploads_a_new_png_reads_it_and_cleans_up_only_that_key(self):
        client = self.client()
        result = check_storage(VALUES, client=client)
        self.assertTrue(result.success)
        uploaded = client.put_object.call_args.kwargs
        self.assertRegex(uploaded["Key"], r"^report_storage_check_[0-9a-f]{32}\.png$")
        self.assertEqual(uploaded["IfNoneMatch"], "*")
        self.assertEqual(uploaded["ContentType"], "image/png")
        with Image.open(io.BytesIO(uploaded["Body"])) as photo:
            self.assertEqual(photo.format, "PNG")
            self.assertEqual(photo.size, (2, 2))
        destination = {"Bucket": VALUES["S3_BUCKET_NAME"], "Key": result.object_key}
        client.get_object.assert_called_once_with(**destination)
        client.delete_object.assert_called_once_with(**destination)
        client.list_buckets.assert_not_called()
        client.put_bucket_policy.assert_not_called()

    def test_versioned_bucket_reads_and_deletes_exactly_the_created_version(self):
        client = self.client(version="synthetic-created-version")
        result = check_storage(VALUES, client=client)
        self.assertTrue(result.success)
        destination = {"Bucket": VALUES["S3_BUCKET_NAME"], "Key": result.object_key, "VersionId": "synthetic-created-version"}
        client.get_object.assert_called_once_with(**destination)
        client.delete_object.assert_called_once_with(**destination)

    def test_failed_upload_never_reads_or_deletes_any_object(self):
        client = self.client()
        client.put_object.side_effect = self.error("PutObject")
        result = check_storage(VALUES, client=client)
        self.assertFalse(result.uploaded)
        self.assertIsNone(result.object_key)
        client.get_object.assert_not_called()
        client.delete_object.assert_not_called()
        self.assertNotIn(VALUES["AWS_SECRET_ACCESS_KEY"], repr(result))

    def test_failed_read_still_cleans_up_the_created_object_and_redacts_errors(self):
        client = self.client()
        client.get_object.side_effect = self.error()
        result = check_storage(VALUES, client=client)
        self.assertTrue(result.uploaded)
        self.assertFalse(result.verified)
        self.assertTrue(result.cleaned_up)
        client.delete_object.assert_called_once_with(Bucket=VALUES["S3_BUCKET_NAME"], Key=result.object_key)
        self.assertNotIn(VALUES["AWS_SECRET_ACCESS_KEY"], repr(result))

    def test_mismatched_download_is_not_reported_as_success_and_is_cleaned_up(self):
        client = self.client()
        body = io.BytesIO(b"different-photo")
        client.get_object.side_effect = None
        client.get_object.return_value = {"Body": body, "ContentType": "image/png"}
        result = check_storage(VALUES, client=client)
        self.assertFalse(result.verified)
        self.assertTrue(result.cleaned_up)
        self.assertTrue(body.closed)

    def test_cleanup_denial_reports_the_remaining_test_key_without_secrets(self):
        client = self.client()
        client.delete_object.side_effect = self.error("DeleteObject")
        result = check_storage(VALUES, client=client)
        output = io.StringIO()
        with patch("backend.check_storage.load_service_values", return_value=VALUES), \
             patch("backend.check_storage.check_storage", return_value=result), redirect_stdout(output):
            self.assertEqual(main(["--upload-test"]), 1)
        self.assertTrue(result.uploaded and result.verified)
        self.assertFalse(result.cleaned_up)
        self.assertIn(result.object_key, output.getvalue())
        self.assertIn("Test object remains", output.getvalue())
        self.assertNotIn(VALUES["AWS_SECRET_ACCESS_KEY"], output.getvalue())

    def test_network_error_never_displays_endpoint_or_credentials(self):
        client = self.client()
        client.put_object.side_effect = EndpointConnectionError(endpoint_url="https://" + VALUES["AWS_SECRET_ACCESS_KEY"])
        result = check_storage(VALUES, client=client)
        self.assertFalse(result.success)
        self.assertRegex(result.object_key, r"^report_storage_check_[0-9a-f]{32}\.png$")
        client.delete_object.assert_not_called()
        self.assertNotIn(VALUES["AWS_SECRET_ACCESS_KEY"], repr(result))

    def test_report_adapter_uses_standard_credentials_and_redacts_partial_configuration(self):
        settings = Settings("https://exampleproject.supabase.co", "sb_publishable_synthetic", VALUES)
        service = MediaServices(settings)
        with patch("boto3.client") as factory:
            service.upload("report_synthetic.png", b"synthetic-photo", "image/png")
        self.assertEqual(factory.call_args.kwargs["aws_access_key_id"], VALUES["AWS_ACCESS_KEY_ID"])
        broken = MediaServices(Settings(settings.project_url, settings.publishable_key,
                                       {"S3_BUCKET_NAME": "synthetic-bucket", "AWS_SECRET_ACCESS_KEY": "private"}))
        with patch("boto3.client") as factory:
            with self.assertRaises(MediaUnavailable) as captured:
                broken.upload("report_synthetic.png", b"synthetic-photo", "image/png")
            factory.assert_not_called()
        self.assertNotIn("private", str(captured.exception))


if __name__ == "__main__":
    unittest.main()
