"""Check local S3 settings, or explicitly upload/read/clean up one synthetic PNG."""

import argparse
from dataclasses import dataclass
import io
import ipaddress
import re
from typing import Mapping
from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from PIL import Image

from ..core.config import load_service_values
from ..reports.media import aws_client_options, create_aws_client


@dataclass(frozen=True)
class StorageCheckResult:
    uploaded: bool = False
    verified: bool = False
    cleaned_up: bool = False
    object_key: str | None = None
    messages: tuple[str, ...] = ()

    @property
    def success(self) -> bool:
        return self.uploaded and self.verified and self.cleaned_up


def validate_storage_settings(values: Mapping[str, str]) -> tuple[str, str]:
    """Require an explicit bucket, region, and credential pair for this local check."""
    bucket = (values.get("S3_BUCKET_NAME") or "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket) or ".." in bucket:
        raise ValueError("Set S3_BUCKET_NAME to the intended existing bucket name.")
    try:
        ipaddress.ip_address(bucket)
    except ValueError:
        pass
    else:
        raise ValueError("S3_BUCKET_NAME cannot be an IP address.")
    region = (values.get("AWS_REGION") or "").strip()
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d+", region):
        raise ValueError("Set AWS_REGION to the bucket's region, for example us-east-1.")
    options = aws_client_options(values)
    if "aws_access_key_id" not in options:
        raise ValueError("Fill AWS_ACCESS_KEY and AWS_SECRET_ACCESS_KEY locally; values are never displayed.")
    return bucket, region


def _failure_message(stage: str, error: Exception) -> str:
    if isinstance(error, ClientError):
        code = error.response.get("Error", {}).get("Code")
        if code in ("AccessDenied", "AllAccessDisabled", "403"):
            return f"{stage} denied. Check the IAM action, bucket policy, and any required KMS permissions."
        if code in ("InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidToken", "ExpiredToken", "TokenRefreshRequired"):
            return f"{stage} failed authentication. Check the local key pair and any required session token."
        if code == "NoSuchBucket":
            return f"{stage} failed. Confirm the intended bucket exists."
        if code in ("AuthorizationHeaderMalformed", "PermanentRedirect", "IllegalLocationConstraintException"):
            return f"{stage} failed. Confirm AWS_REGION matches the bucket."
    if isinstance(error, BotoCoreError):
        return f"{stage} could not complete. Check connectivity and AWS configuration."
    return f"{stage} failed. No credentials or raw service error were displayed."


def check_storage(values: Mapping[str, str], *, client=None) -> StorageCheckResult:
    """Write only a new report_storage_check UUID key; delete only that created object/version."""
    bucket, _ = validate_storage_settings(values)
    key = "report_storage_check_" + uuid4().hex + ".png"
    stream = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(stream, format="PNG")
    photo = stream.getvalue()
    uploaded = verified = cleaned_up = False
    version_id = None
    messages = []
    try:
        storage = client if client is not None else create_aws_client("s3", values)
        result = storage.put_object(Bucket=bucket, Key=key, Body=photo, ContentType="image/png", IfNoneMatch="*")
        uploaded = True
        version_id = result.get("VersionId")
    except Exception as error:
        # A lost response can leave a written object. Do not delete an unconfirmed write.
        attempted_key = None if isinstance(error, ClientError) else key
        return StorageCheckResult(object_key=attempted_key, messages=(_failure_message("S3 upload", error),))

    destination = {"Bucket": bucket, "Key": key}
    if version_id:
        destination["VersionId"] = version_id
    body = None
    try:
        response = storage.get_object(**destination)
        body = response["Body"]
        verified = body.read(len(photo) + 1) == photo and response.get("ContentType") == "image/png"
        if not verified:
            messages.append("S3 download did not match the uploaded PNG bytes and content type.")
    except Exception as error:
        messages.append(_failure_message("S3 authenticated download", error))
    finally:
        if body is not None:
            try:
                body.close()
            except Exception:
                messages.append("The download stream could not be closed.")
        try:
            storage.delete_object(**destination)
            cleaned_up = True
        except Exception as error:
            messages.append(_failure_message("S3 test-object cleanup", error))
    return StorageCheckResult(uploaded, verified, cleaned_up, key, tuple(messages))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload-test", action="store_true",
                        help="Upload one synthetic PNG, verify an authenticated download, then attempt to delete that test object.")
    options = parser.parse_args(argv)
    try:
        values = load_service_values()
    except (OSError, UnicodeError):
        print("Could not read the local .env configuration; no raw file error was displayed.")
        return 2
    try:
        bucket, region = validate_storage_settings(values)
    except ValueError as error:
        print(str(error))
        return 2
    print(f"S3 bucket: {bucket}; region: {region}. Credential values are hidden.")
    if not options.upload_test:
        print("Configuration is ready. No AWS requests were made. Run with --upload-test to check storage.")
        return 0
    result = check_storage(values)
    print("S3 upload: " + ("passed" if result.uploaded else "failed"))
    print("S3 authenticated download: " + ("passed" if result.verified else "failed or not attempted"))
    print("S3 test-object cleanup: " + ("passed" if result.cleaned_up else "failed or not attempted"))
    for message in result.messages:
        print(message)
    if result.uploaded and not result.cleaned_up:
        print("Test object remains for the bucket owner to clean up: " + result.object_key)
    elif result.object_key and not result.uploaded:
        print("Upload was not confirmed. If this test object exists, ask the bucket owner to clean it up: " + result.object_key)
    print("No Supabase, AI, bucket-policy, or other-object operations were performed.")
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
