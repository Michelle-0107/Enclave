"""Compatibility imports for registration request and response models."""

from ..registration.contracts import (AuthSession, InvitationResult, OTPAccepted, RequestOTP, ResidentInput,
                                     Residency, SignupResult, VerifySignup)

__all__ = ["AuthSession", "InvitationResult", "OTPAccepted", "RequestOTP", "ResidentInput", "Residency",
           "SignupResult", "VerifySignup"]
