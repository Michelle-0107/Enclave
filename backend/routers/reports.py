import random
import string
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from supabase import create_client, Client
import os

from backend.services.reports_service import upload_image_to_s3, analyze_report_with_ai

router = APIRouter(prefix="/api/v1", tags=["Reports"])

# initialize Supabase
supabase: Client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

@router.post("/reports")
async def create_report(
    description: str = Form(...),
    latitude: float = Form(0.0),
    longitude: float = Form(0.0),
    user_id: str = Form(None),
    file: UploadFile = File(...)
):
    try:
        file_bytes = await file.read()
        file_ext = file.filename.split(".")[-1] if file.filename else "jpg"
        unique_file_name = f"report_{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}.{file_ext}"

        # 1. use AWS S3 service to upload the image and get the public URL
        image_url = upload_image_to_s3(unique_file_name, file_bytes, file.content_type or "image/jpeg")
        if not image_url:
            raise HTTPException(status_code=500, detail="Failed to upload image to S3 storage.")

        # 2. use the AI analysis service
        ai_result = analyze_report_with_ai(file_bytes, description)
        ticket_id = "TICK-" + "".join(random.choices(string.digits, k=4))

        report_data = {
            "ticket_id": ticket_id,
            "description": ai_result.get("summary", description),
            "status": "pending",
            "image_url": image_url,
            "category": ai_result.get("category", "Damaged Facility"),
            "priority": ai_result.get("priority", "medium"),
            "latitude": latitude,
            "longitude": longitude,
            "is_approved": False,
        }

        if user_id and user_id not in ["string", "None", ""] and user_id.strip() != "":
            report_data["user_id"] = user_id

        # 3. write to Supabase database
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