"""Public registration contracts; no plaintext OTP is returned by request-OTP."""

from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator


class RegistrationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RequestOTP(RegistrationInput):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return str(value).strip().lower()


class VerifySignup(RegistrationInput):
    challenge_id: UUID
    otp: str = Field(strict=True, pattern=r"^[0-9]{6}$", repr=False)
    password: SecretStr = Field(min_length=8, max_length=128)


class OTPAccepted(BaseModel):
    challenge_id: UUID
    message: str = "If the invitation is eligible, a verification email will be sent."


class AuthSession(BaseModel):
    access_token: str = Field(min_length=1, max_length=16384, repr=False)
    refresh_token: str = Field(min_length=1, max_length=8192, repr=False)
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(gt=0)


class SignupResult(BaseModel):
    status: Literal["registered"] = "registered"
    resident_id: UUID
    user_id: UUID
    session: AuthSession


class ResidentInput(RegistrationInput):
    resident_reference: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=150)
    unit_number: str = Field(min_length=1, max_length=100)
    registered_email: EmailStr

    @field_validator("resident_reference", "full_name", "unit_number")
    @classmethod
    def trim_nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Value must contain non-whitespace text")
        return value

    @field_validator("registered_email")
    @classmethod
    def normalize_email(cls, value):
        return str(value).strip().lower()


class ResidentUpdate(ResidentInput):
    status: Literal["active", "inactive"]


class ManagementResident(BaseModel):
    resident_id: UUID
    resident_reference: str
    full_name: str
    unit_number: str
    registered_email: EmailStr
    status: Literal["active", "inactive"]
    account_linked: bool
    verified_at: datetime | None
    created_at: datetime


class ManagementResidentList(BaseModel):
    residents: list[ManagementResident]


class Residency(BaseModel):
    resident_id: UUID
    full_name: str | None = None
    unit_number: str
    status: Literal["active", "inactive"]
    verified_at: datetime | None


class InvitationResult(BaseModel):
    invitation_id: UUID
    resident_id: UUID
    invitation_token: str = Field(repr=False)
    expires_at: datetime
