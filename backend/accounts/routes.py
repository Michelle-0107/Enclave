"""Authenticated account profile-photo endpoints shared by all account roles."""

from io import BytesIO
import logging
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict

from .profile import AccountProfileDenied, AccountProfileUnavailable


MAX_ACCOUNT_PHOTO_BYTES = 5 * 1024 * 1024
ACCOUNT_PHOTO_TYPES = {"image/jpeg": ("jpg", "JPEG"), "image/png": ("png", "PNG")}
MAX_ACCOUNT_PHOTO_PIXELS = 40_000_000
logger = logging.getLogger(__name__)


class AccountProfileResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    avatar_url: str | None


def _validate_photo(data: bytes, declared_type: str | None) -> tuple[str, str]:
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError:
        raise HTTPException(503, "Photo validation service unavailable") from None
    declared = ACCOUNT_PHOTO_TYPES.get((declared_type or "").lower())
    if declared is None:
        raise HTTPException(415, "Use a JPEG or PNG photo")
    try:
        with Image.open(BytesIO(data)) as image:
            actual_format = image.format
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(415, "The uploaded file is not a valid JPEG or PNG image") from None
    if actual_format != declared[1]:
        raise HTTPException(415, "The photo content does not match its file type")
    if width < 1 or height < 1 or width * height > MAX_ACCOUNT_PHOTO_PIXELS:
        raise HTTPException(413, "The photo dimensions are too large")
    return declared


def _is_owned_photo_url(value: str | None, owner: str) -> bool:
    if not value:
        return False
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.fragment):
            return False
    except ValueError:
        return False
    key = unquote(parsed.path.lstrip("/"))
    parts = PurePosixPath(key).parts
    return len(parts) == 3 and parts[0] == "profile-photos" and parts[1] == owner and parts[2] not in ("", ".", "..")


def create_router(current_user_dependency) -> APIRouter:
    router = APIRouter(tags=["Account"])

    @router.get("/api/v1/account/profile", response_model=AccountProfileResponse,
                summary="Get the authenticated user's profile photo",
                responses={401: {"description": "Invalid credentials"}, 403: {"description": "Profile access denied"}, 503: {"description": "Profile service unavailable"}})
    async def get_account_profile(request: Request, response: Response,
                                  user=Depends(current_user_dependency)):
        response.headers["Cache-Control"] = "no-store"
        try:
            stored_url = await request.app.state.account_profiles.get_avatar_url(user.user_id)
            if stored_url is None:
                avatar_url = None
            elif not _is_owned_photo_url(stored_url, str(user.user_id)):
                avatar_url = None
            else:
                avatar_url = await run_in_threadpool(request.app.state.media.signed_image_url, stored_url)
                if avatar_url == stored_url:
                    raise RuntimeError("Stored profile photo is not in the configured private bucket")
        except AccountProfileDenied:
            raise HTTPException(403, "Profile access denied") from None
        except AccountProfileUnavailable:
            raise HTTPException(503, "Profile service unavailable") from None
        except Exception:
            logger.warning("Account profile photo link could not be generated.")
            raise HTTPException(503, "Profile photo service unavailable") from None
        return AccountProfileResponse(avatar_url=avatar_url)

    @router.post("/api/v1/account/avatar", response_model=AccountProfileResponse,
                 summary="Upload or replace the authenticated user's profile photo",
                 responses={401: {"description": "Invalid credentials"}, 403: {"description": "Profile access denied"}, 413: {"description": "Photo exceeds size or dimension limits"}, 415: {"description": "Unsupported or invalid photo"}, 503: {"description": "Profile photo storage unavailable"}})
    async def upload_account_avatar(request: Request, response: Response, photo: UploadFile = File(...),
                                    user=Depends(current_user_dependency)):
        response.headers["Cache-Control"] = "no-store"
        data = await photo.read(MAX_ACCOUNT_PHOTO_BYTES + 1)
        if len(data) > MAX_ACCOUNT_PHOTO_BYTES:
            raise HTTPException(413, "Photo exceeds the 5 MiB limit")
        extension, content_type = _validate_photo(data, photo.content_type)
        owner = str(user.user_id)
        profiles = request.app.state.account_profiles
        try:
            previous_url = await profiles.get_avatar_url(user.user_id)
        except AccountProfileDenied:
            raise HTTPException(403, "Profile access denied") from None
        except AccountProfileUnavailable:
            raise HTTPException(503, "Profile service unavailable") from None

        key = str(PurePosixPath("profile-photos") / owner / (uuid4().hex + "." + extension))
        media = request.app.state.media
        try:
            new_url = await run_in_threadpool(media.upload, key, data, content_type.lower())
        except Exception:
            raise HTTPException(503, "Profile photo storage unavailable") from None

        try:
            await profiles.set_avatar_url(user.user_id, new_url)
        except AccountProfileDenied:
            # A definite upstream denial means the PATCH did not commit.
            try:
                await run_in_threadpool(media.delete_report_images, [new_url])
            except Exception:
                logger.warning("Unreferenced profile photo cleanup did not complete.")
            raise HTTPException(403, "Profile access denied") from None
        except AccountProfileUnavailable:
            # A network failure can happen after PostgREST commits the PATCH.
            # Keep the uploaded object so an ambiguous commit cannot break the
            # stored avatar URL; an unreferenced object is safer than a dead link.
            raise HTTPException(503, "Profile could not be updated") from None

        if previous_url and previous_url != new_url and _is_owned_photo_url(previous_url, owner):
            try:
                await run_in_threadpool(media.delete_report_images, [previous_url])
            except Exception:
                logger.warning("Replaced profile photo cleanup did not complete.")
        try:
            avatar_url = await run_in_threadpool(media.signed_image_url, new_url)
        except Exception:
            logger.warning("New profile photo was stored but its access link could not be generated.")
            raise HTTPException(503, "Photo saved, but its access link is temporarily unavailable") from None
        return AccountProfileResponse(avatar_url=avatar_url)

    return router


__all__ = ["ACCOUNT_PHOTO_TYPES", "MAX_ACCOUNT_PHOTO_BYTES", "create_router"]
