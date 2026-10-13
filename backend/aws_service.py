import os
import json
import base64
import io
import boto3
from dotenv import load_dotenv
from botocore.exceptions import ClientError
from google import genai
from PIL import Image

# Load environment variables from .env file
load_dotenv()

# Initialize AWS S3 client
s3_client = boto3.client(
    "s3",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

# Initialize AWS Bedrock Runtime client for generative AI
bedrock_client = boto3.client(
    "bedrock-runtime",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

BUCKET_NAME = os.getenv("S3_BUCKET_NAME")

# Initialize Google Gemini client as a fallback AI provider
gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


# 1. Upload resident-submitted report image to AWS S3 storage
def upload_image_to_s3(file_name: str, file_bytes: bytes, content_type: str):
    try:
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=file_name,
            Body=file_bytes,
            ContentType=content_type,
        )
        # Generate the public or direct access URL for the S3 object
        file_url = f"https://{BUCKET_NAME}.s3.amazonaws.com/{file_name}"
        return file_url
    except Exception as e:
        print(f"S3 Upload Error: {e}")
        return None


# 2. Smart issue analysis (Primary: AWS Nova Lite via Bedrock | Fallback: Google Gemini)
def analyze_report_with_ai(image_bytes: bytes, description: str):
    prompt_text = (
        "You are a community issue management assistant. Please analyze the provided image and resident description, "
        "and return a strict JSON response containing:\n"
        "1. 'category': choose from [Streetlight, Damaged Facility, Blocked Path, Drainage, Waste]\n"
        "2. 'priority': 'high', 'medium', or 'low'\n"
        "3. 'summary': a brief description summary\n"
        f"Resident Description: {description}"
    )

    # ------------------ Strategy A: Try Amazon Nova Lite (Bedrock) first ------------------
    try:
        print("🤖 [AI Route] Attempting to invoke AWS Bedrock (Nova Lite)...")
        model_id = "amazon.nova-lite-v1:0"
        
        # Encode image to Base64 format required by Nova Lite multimodal input
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        
        payload = {
            "messages": [{
                "role": "user",
                "content": [
                    {"image": {"format": "jpeg", "source": {"bytes": base64_image}}},
                    {"text": prompt_text}
                ],
            }],
            "inferenceConfig": {"max_new_tokens": 300, "temperature": 0.2},
        }

        response = bedrock_client.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(payload),
        )
        result = json.loads(response["body"].read())
        
        # Extract text response from Nova model structure
        answer = (
            result.get("output", {})
            .get("message", {})
            .get("content", [{}])[0]
            .get("text", "")
        )
        print("✅ [AI Success] Analysis successfully completed via Bedrock (Nova Lite)!")
        
        # Clean and parse JSON response
        cleaned_answer = answer.strip().removeprefix("```json").removesuffix("```").strip()
        return json.loads(cleaned_answer)

    except (ClientError, Exception) as e:
        print(f"⚠️ [AI Warning] Bedrock invocation failed or account pending approval ({e}). Switching to Google Gemini fallback...")

    # ------------------ Strategy B: Fallback to Google Gemini API ------------------
    try:
        img = Image.open(io.BytesIO(image_bytes))
        # Updated to use gemini-3.6-flash from your available rate limit list
        response = gemini_client.models.generate_content(
            model='gemini-3.6-flash',
            contents=[img, prompt_text]
        )
        
        # Clean and parse JSON response from Gemini
        cleaned_text = response.text.strip().removeprefix("```json").removesuffix("```").strip()
        print("✅ [AI Success] Analysis successfully completed via Google Gemini fallback!")
        return json.loads(cleaned_text)

    except Exception as e:
        print(f"❌ [AI Error] Fallback Gemini also failed: {e}. Using default rule-based fallback.")
        # Ultimate fallback payload to prevent backend crashes and ensure database integrity
        return {
            "category": "Damaged Facility",
            "priority": "medium",
            "summary": description or "Manual review required (AI pending approval)."
        }