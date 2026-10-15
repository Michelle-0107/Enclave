"""Existing S3 and Bedrock/Gemini report pipeline, initialized only when needed."""

import base64
import io
import json
import logging
import threading
from typing import Mapping

from ..core.config import Settings


logger = logging.getLogger(__name__)


class MediaUnavailable(RuntimeError):
    """Photo storage is missing configuration or failed."""


def aws_client_options(values: Mapping[str, str]) -> dict:
    """Build AWS options from the team's fixed environment variable names."""
    access_key = (values.get("AWS_ACCESS_KEY") or "").strip()
    secret_key = (values.get("AWS_SECRET_ACCESS_KEY") or "").strip()
    if bool(access_key) != bool(secret_key):
        raise ValueError("Configure both AWS_ACCESS_KEY and AWS_SECRET_ACCESS_KEY.")
    options = {"region_name": (values.get("AWS_REGION") or "us-east-1").strip()}
    if access_key:
        options.update(aws_access_key_id=access_key, aws_secret_access_key=secret_key)
    return options


def create_aws_client(service: str, values: Mapping[str, str]):
    """Use the same credential configuration for reports and the storage smoke test."""
    import boto3
    from botocore.config import Config

    options = aws_client_options(values)
    if service == "s3":
        options["config"] = Config(
            signature_version="s3v4", connect_timeout=5, read_timeout=10,
            retries={"mode": "standard", "total_max_attempts": 2},
            ignore_configured_endpoint_urls=True,
        )
    return boto3.client(service, **options)


class MediaServices:
    def __init__(self, settings: Settings):
        self.values = settings.service_values
        self._s3 = None
        self._bedrock = None
        self.lock = threading.Lock()

    def _client(self, service: str):
        return create_aws_client(service, self.values)

    def upload(self, file_name: str, file_bytes: bytes, content_type: str) -> str:
        bucket = self.values.get("S3_BUCKET_NAME")
        if not bucket:
            raise MediaUnavailable()
        try:
            with self.lock:
                if self._s3 is None:
                    self._s3 = self._client("s3")
                client = self._s3
            client.put_object(Bucket=bucket, Key=file_name, Body=file_bytes, ContentType=content_type)
            return f"https://{bucket}.s3.amazonaws.com/{file_name}"
        except Exception:
            logger.warning("Report photo upload failed.")
            raise MediaUnavailable() from None

    def analyze(self, image_bytes: bytes, description: str) -> dict:
        # Retain the team's Bedrock -> Gemini -> manual-review fallback sequence.
        prompt = (
            "You are a community issue management assistant. Please analyze the provided image and resident description, "
            "and return a strict JSON response containing:\n"
            "1. 'category': choose strictly from [Streetlight, Damaged Facility, Blocked Path, Drainage, Waste]\n"
            "2. 'priority': 'high', 'medium', or 'low'\n"
            "3. 'summary': a brief description summary\n"
            f"Resident Description: {description}"
        )
        try:
            from PIL import Image
            with Image.open(io.BytesIO(image_bytes)) as image:
                image_format = "png" if image.format == "PNG" else "jpeg"
            with self.lock:
                if self._bedrock is None:
                    self._bedrock = self._client("bedrock-runtime")
                client = self._bedrock
            payload = {
                "messages": [{"role": "user", "content": [
                    {"image": {"format": image_format, "source": {"bytes": base64.b64encode(image_bytes).decode("utf-8")}}},
                    {"text": prompt},
                ]}],
                "inferenceConfig": {"max_new_tokens": 300, "temperature": 0.2},
            }
            response = client.invoke_model(
                modelId=self.values.get("BEDROCK_MODEL_ID") or "amazon.nova-lite-v1:0", contentType="application/json",
                accept="application/json", body=json.dumps(payload),
            )
            result = json.loads(response["body"].read())
            answer = result.get("output", {}).get("message", {}).get("content", [{}])[0].get("text", "")
            return json.loads(answer.strip().removeprefix("```json").removesuffix("```").strip())
        except Exception:
            logger.info("Bedrock analysis unavailable; trying Gemini.")
        try:
            from google import genai
            from PIL import Image
            key = self.values.get("GEMINI_API_KEY")
            if not key:
                raise RuntimeError()
            with genai.Client(api_key=key) as client:
                with Image.open(io.BytesIO(image_bytes)) as image:
                    response = client.models.generate_content(model="gemini-3.5-flash-lite", contents=[image, prompt])
            return json.loads(response.text.strip().removeprefix("```json").removesuffix("```").strip())
        except Exception:
            logger.info("AI providers unavailable; report requires manual review.")
            return {"category": "Damaged Facility", "priority": "medium", "summary": description}

__all__ = ['MediaServices', 'MediaUnavailable', 'aws_client_options', 'create_aws_client']
