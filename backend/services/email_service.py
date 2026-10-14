import os
import resend

# get the Resend API Key from the environment variables and configure it
resend.api_key = os.environ.get("RESEND_API_KEY")

def send_invite_email(to_email: str, code: str):
    """
    use Resend to send registration invitation/verification emails
    """
    params = {
        "from": "noreply@enclave.com",
        "to": [to_email],
        "subject": "【Community Management】Your Registration Invitation Code",
        "html": f"""
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>Community Account Registration</h2>
                <p>Dear user, you are applying for a community account. Your exclusive invitation/verification code is:</p>
                <h1 style="color: #4A90E2; letter-spacing: 2px;">{code}</h1>
                <p>Please enter this verification code in the App to complete registration. The verification code is valid for 10 minutes.</p>
                <p style="color: #888; font-size: 12px; margin-top: 30px;">If this is not your operation, please ignore this email.</p>
            </div>
        """
    }

    response = resend.Emails.send(params)
    return response