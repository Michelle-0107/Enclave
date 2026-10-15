"""Resident eligibility checks for resident-facing API operations."""

from uuid import UUID

import httpx

from ..core.config import Settings


class ResidentDirectoryUnavailable(RuntimeError):
    """The Supabase resident directory could not be checked safely."""


class ResidentAccessRepository:
    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None):
        self.url = settings.project_url + "/rest/v1/residents"
        self.key = settings.api_key
        self.client = httpx.AsyncClient(timeout=10.0, follow_redirects=False, transport=transport, trust_env=False)

    async def close(self):
        await self.client.aclose()

    async def is_active_verified_resident(self, token: str, user_id: UUID) -> bool:
        try:
            response = await self.client.get(
                self.url,
                headers={
                    "apikey": self.key,
                    "Authorization": "Bearer " + token,
                    "Accept-Profile": "public",
                },
                params={
                    "select": "profile_id,status,verified_at",
                    "profile_id": "eq." + str(user_id),
                    "limit": "2",
                },
            )
        except httpx.RequestError:
            raise ResidentDirectoryUnavailable() from None

        if response.status_code != 200:
            raise ResidentDirectoryUnavailable()
        try:
            rows = response.json()
        except ValueError:
            raise ResidentDirectoryUnavailable() from None
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ResidentDirectoryUnavailable()
        if not rows:
            return False
        if len(rows) != 1:
            raise ResidentDirectoryUnavailable()
        row = rows[0]
        try:
            matches_user = UUID(row["profile_id"]) == user_id
            status = row["status"]
            verified_at = row["verified_at"]
        except (ValueError, TypeError, KeyError, AttributeError):
            raise ResidentDirectoryUnavailable() from None
        if not isinstance(status, str) or (verified_at is not None and not isinstance(verified_at, str)):
            raise ResidentDirectoryUnavailable()
        return matches_user and status == "active" and bool(verified_at)

__all__ = ['ResidentAccessRepository', 'ResidentDirectoryUnavailable']
