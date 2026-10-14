"""Existing S3 and Bedrock/Gemini report pipeline, initialized only when needed."""

import base64
import io
import json
import logging
import threading

from .config import Settings


logger = logging.getLogger(__name__)


class MediaUnavailable(RuntimeError):
    """Photo storage is missing configuration or failed."""


class MediaServices:
    def __init__(self, settings: Settings):
        self.values = settings.service_values
        self._s3 = None
        self._bedrock = None
        self.lock = threading.Lock()

    def _client(self, service: str):
        import boto3
        options = {"region_name": self.values.get("AWS_REGION") or "us-east-1"}
        access_key = self.values.get("AWS_ACCESS_KEY")
        secret_key = self.values.get("AWS_SECRET_ACCESS_KEY")
        if access_key and secret_key:
            options.update(aws_access_key_id=access_key, aws_secret_access_key=secret_key)
            if self.values.get("AWS_SESSION_TOKEN"):
                options["aws_session_token"] = self.values["AWS_SESSION_TOKEN"]
        return boto3.client(service, **options)

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
                modelId="amazon.nova-lite-v1:0", contentType="application/json",
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
