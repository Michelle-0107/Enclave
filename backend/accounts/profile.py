"""Owner-scoped profile photo persistence through Supabase PostgREST."""

from uuid import UUID

import httpx

from ..core.config import Settings


class AccountProfileUnavailable(RuntimeError):
    """The profile table or Supabase API could not complete the operation."""


class AccountProfileDenied(RuntimeError):
    """The profile row is not available to this account."""


class AccountProfileRepository:
    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None):
        self.url = settings.project_url + "/rest/v1/profiles"
        self.key = settings.api_key
        self.client = httpx.AsyncClient(timeout=10.0, follow_redirects=False, transport=transport)

    async def close(self) -> None:
        await self.client.aclose()

    def _headers(self) -> dict[str, str]:
        # Only backend code uses this admin key. The caller always supplies the
        # UUID extracted from a verified user access token.
        headers = {"apikey": self.key, "Accept-Profile": "public"}
        # New sb_secret keys are opaque API keys, not JWTs. The Supabase API
        # gateway derives the privileged role from apikey when Authorization
        # is omitted; legacy service_role keys remain valid bearer JWTs.
        if not self.key.startswith("sb_secret_"):
            headers["Authorization"] = "Bearer " + self.key
        return headers

    @staticmethod
    def _rows(response: httpx.Response) -> list[dict]:
        if response.status_code in (401, 403):
            raise AccountProfileDenied()
        if response.status_code not in (200, 201):
            raise AccountProfileUnavailable()
        try:
            rows = response.json()
        except ValueError:
            raise AccountProfileUnavailable() from None
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise AccountProfileUnavailable()
        return rows

    async def get_avatar_url(self, owner: UUID) -> str | None:
        try:
            response = await self.client.get(self.url, headers=self._headers(), params={
                "select": "avatar_url", "id": "eq." + str(owner), "limit": "2",
            })
        except httpx.RequestError:
            raise AccountProfileUnavailable() from None
        rows = self._rows(response)
        if len(rows) != 1:
            if not rows:
                raise AccountProfileDenied()
            raise AccountProfileUnavailable()
        value = rows[0].get("avatar_url")
        if value is not None and not isinstance(value, str):
            raise AccountProfileUnavailable()
        return value

    async def set_avatar_url(self, owner: UUID, avatar_url: str) -> None:
        try:
            response = await self.client.patch(self.url, headers={
                **self._headers(), "Content-Profile": "public", "Prefer": "return=representation",
            }, params={"select": "avatar_url", "id": "eq." + str(owner)}, json={"avatar_url": avatar_url})
        except httpx.RequestError:
            raise AccountProfileUnavailable() from None
        rows = self._rows(response)
        if len(rows) != 1:
            if not rows:
                raise AccountProfileDenied()
            raise AccountProfileUnavailable()
        if rows[0].get("avatar_url") != avatar_url:
            raise AccountProfileUnavailable()


__all__ = ["AccountProfileDenied", "AccountProfileRepository", "AccountProfileUnavailable"]
