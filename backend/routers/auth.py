import random
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from services.email_service import send_invite_email

router = APIRouter(prefix="/api", tags=["Auth"])


class SendCodeRequest(BaseModel):
  email: EmailStr
  # backend generate the code, so we don't need to pass it here


@router.post("/send-verification-email")
def send_verification_email(data: SendCodeRequest):
  try:
    # 1. backend generate the code
    code = "".join([str(random.randint(0, 9)) for _ in range(6)])

    # 2. use the email and code to call the email sending function
    response = send_invite_email(data.email, code)

    return {
        "status": "success",
        "message": "Verification code sent successfully",
        "generated_code": code,  # hint: for testing purposes, you can return the code to see it, but remove this line in production
        "data": response,
    }
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))