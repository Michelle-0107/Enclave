import os
import random
import string
import json
import base64
import io
import boto3
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from botocore.exceptions import ClientError
from google import genai
from PIL import Image
from supabase import create_client, Client

# Load environment variables from .env file
load_dotenv()

# Initialize Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize AWS S3 & Bedrock clients
s3_client = boto3.client(
    "s3",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

bedrock_client = boto3.client(
    "bedrock-runtime",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

BUCKET_NAME = os.getenv("S3_BUCKET_NAME")

# Initialize Google Gemini client as a fallback AI provider
gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI(title="Enclave Backend API")


@app.get("/")
def read_root():
    return {"message": "Welcome to Enclave API"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


# Helper 1: Upload image to AWS S3 storage
def upload_image_to_s3(file_name: str, file_bytes: bytes, content_type: str):
    try:
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=file_name,
            Body=file_bytes,
            ContentType=content_type,
        )
        file_url = f"https://{BUCKET_NAME}.s3.amazonaws.com/{file_name}"
        return file_url
    except Exception as e:
        print(f"S3 Upload Error: {e}")
        return None


# Helper 2: Smart AI analysis with Bedrock -> Gemini fallback strategy
def analyze_report_with_ai(image_bytes: bytes, description: str):
    prompt_text = (
        "You are a community issue management assistant. Please analyze the provided image and resident description, "
        "and return a strict JSON response containing:\n"
        "1. 'category': choose strictly from [Streetlight, Damaged Facility, Blocked Path, Drainage, Waste]\n"
        "2. 'priority': 'high', 'medium', or 'low'\n"
        "3. 'summary': a brief description summary\n"
        f"Resident Description: {description}"
    )

    # Strategy A: Try Amazon Nova Lite (Bedrock) first
    try:
        print("🤖 [AI Route] Attempting to invoke AWS Bedrock (Nova Lite)...")
        model_id = "amazon.nova-lite-v1:0"
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
        answer = (
            result.get("output", {})
            .get("message", {})
            .get("content", [{}])[0]
            .get("text", "")
        )
        print("✅ [AI Success] Analysis successfully completed via Bedrock (Nova Lite)!")
        cleaned_answer = answer.strip().removeprefix("```json").removesuffix("```").strip()
        return json.loads(cleaned_answer)

    except (ClientError, Exception) as e:
        print(f"⚠️ [AI Warning] Bedrock invocation failed ({e}). Switching to Google Gemini fallback...")

    # Strategy B: Fallback to Google Gemini API (gemini-3.6-flash)
    try:
        img = Image.open(io.BytesIO(image_bytes))
        response = gemini_client.models.generate_content(
            model='gemini-3.5-flash-lite',
            contents=[img, prompt_text]
        )
        cleaned_text = response.text.strip().removeprefix("```json").removesuffix("```").strip()
        print("✅ [AI Success] Analysis successfully completed via Google Gemini fallback!")
        return json.loads(cleaned_text)

    except Exception as e:
        print(f"❌ [AI Error] Fallback Gemini also failed: {e}. Using default rule-based fallback.")
        return {
            "category": "Damaged Facility",
            "priority": "medium",
            "summary": description or "Manual review required (AI pending approval)."
        }

# Core API: Receive image + description + location -> S3 -> AI Analysis -> Supabase Database
@app.post("/api/v1/reports")
async def create_report(
    description: str = Form(...),
    latitude: float = Form(0.0),
    longitude: float = Form(0.0),
    user_id: str = Form(None),
    file: UploadFile = File(...)
):
    try:
        # 1. Read image file bytes
        file_bytes = await file.read()
        file_ext = file.filename.split(".")[-1] if file.filename else "jpg"
        unique_file_name = f"report_{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}.{file_ext}"

        # 2. Upload image to AWS S3
        image_url = upload_image_to_s3(unique_file_name, file_bytes, file.content_type or "image/jpeg")
        if not image_url:
            raise HTTPException(status_code=500, detail="Failed to upload image to S3 storage.")

        # 3. Call AI Service (Bedrock with Gemini Fallback) for automated categorization and priority
        ai_result = analyze_report_with_ai(file_bytes, description)

        # 4. Generate unique Ticket ID
        ticket_id = "TICK-" + "".join(random.choices(string.digits, k=4))

        # 5. Prepare row data corresponding to our Supabase normalized schema
        report_data = {
            "ticket_id": ticket_id,
            "description": ai_result.get("summary", description),
            "status": "pending",
            "image_url": image_url,
            "category": ai_result.get("category", "Damaged Facility"),
            "priority": ai_result.get("priority", "medium"),
            "latitude": latitude,
            "longitude": longitude,
            "is_approved": False,  # Default unverified for public privacy protection
        }

        # Fix: Only add user_id if a valid UUID is provided and not placeholders
        if user_id and user_id not in ["string", "None", ""]:
            report_data["user_id"] = user_id

        # Fix: Only include user_id if it's a valid UUID (ignore placeholder strings like "string" from Swagger)
        if user_id and user_id != "string" and user_id.strip() != "":
            report_data["user_id"] = user_id

        # 6. Insert data into Supabase 'reports' table
        response = supabase.table("reports").insert(report_data).execute()

        return {
            "success": True,
            "message": "Report successfully created, analyzed by AI, and stored.",
            "ticket_id": ticket_id,
            "ai_analysis": ai_result,
            "image_url": image_url,
            "data": response.data
        }

    except Exception as e:
        print(f"API Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))