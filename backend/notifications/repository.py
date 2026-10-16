"""Forward notification reads and writes through Supabase RLS."""

from datetime import datetime, timezone
from uuid import UUID

import httpx

from ..core.config import Settings
from .models import NotificationCreate, NotificationResponse


NOTIFICATION_COLUMNS = "id,title,message,related_report_id,created_at,published_at,expires_at"


class NotificationsUnavailable(RuntimeError):
    """Supabase could not complete a notification operation."""


class NotificationAccessDenied(RuntimeError):
    """The database policy denied a notification operation."""


class NotificationsRepository:
    def __init__(self, settings: Settings, *, transport=None):
        self.url = settings.project_url + "/rest/v1/notifications"
        self.reads_url = settings.project_url + "/rest/v1/notification_reads"
        self.key = settings.api_key
        self.client = httpx.AsyncClient(timeout=10, follow_redirects=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": "Bearer " + token,
            "Accept-Profile": "public",
        }

    @staticmethod
    def _rows(response: httpx.Response) -> list[dict]:
        if response.status_code in (401, 403):
            raise NotificationAccessDenied()
        if response.status_code not in (200, 201):
            raise NotificationsUnavailable()
        try:
            rows = response.json()
        except ValueError:
            raise NotificationsUnavailable() from None
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise NotificationsUnavailable()
        return rows

    async def list_for_user(self, token: str, user_id: UUID, *, limit: int, offset: int):
        headers = self._headers(token)
        try:
            response = await self.client.get(
                self.url,
                headers=headers,
                params={
                    "select": NOTIFICATION_COLUMNS,
                    "audience": "eq.all_residents",
                    "is_published": "eq.true",
                    "order": "published_at.desc.nullslast,created_at.desc,id.desc",
                    "limit": str(limit),
                    "offset": str(offset),
                },
            )
            rows = self._rows(response)
            notification_ids = [row["id"] for row in rows if isinstance(row.get("id"), int)]
            reads: set[int] = set()
            if notification_ids:
                read_response = await self.client.get(
                    self.reads_url,
                    headers=headers,
                    params={
                        "select": "notification_id",
                        "user_id": "eq." + str(user_id),
                        "notification_id": "in.(" + ",".join(map(str, notification_ids)) + ")",
                    },
                )
                reads = {
                    row["notification_id"]
                    for row in self._rows(read_response)
                    if isinstance(row.get("notification_id"), int)
                }
            return [
                NotificationResponse.model_validate({**row, "is_read": row["id"] in reads})
                for row in rows
            ]
        except (httpx.RequestError, KeyError, TypeError, ValueError):
            raise NotificationsUnavailable() from None

    async def create_broadcast(self, token: str, creator_id: UUID, data: NotificationCreate):
        payload = {
            "title": data.title.strip(),
            "message": data.message.strip(),
            "related_report_id": data.related_report_id,
            "audience": "all_residents",
            "created_by": str(creator_id),
            "is_published": True,
            "published_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": data.expires_at.isoformat() if data.expires_at else None,
        }
        try:
            response = await self.client.post(
                self.url,
                headers={**self._headers(token), "Content-Profile": "public", "Prefer": "return=representation"},
                params={"select": NOTIFICATION_COLUMNS},
                json=payload,
            )
            rows = self._rows(response)
            if len(rows) != 1:
                raise NotificationsUnavailable()
            return NotificationResponse.model_validate(rows[0])
        except (httpx.RequestError, KeyError, TypeError, ValueError):
            raise NotificationsUnavailable() from None

    async def mark_read(self, token: str, user_id: UUID, notification_id: int):
        try:
            response = await self.client.post(
                self.reads_url,
                headers={**self._headers(token), "Content-Profile": "public", "Prefer": "resolution=merge-duplicates"},
                params={"on_conflict": "notification_id,user_id"},
                json={"notification_id": notification_id, "user_id": str(user_id)},
            )
            if response.status_code not in (200, 201, 204):
                if response.status_code in (401, 403):
                    raise NotificationAccessDenied()
                raise NotificationsUnavailable()
        except (httpx.RequestError, KeyError, TypeError, ValueError):
            raise NotificationsUnavailable() from None


__all__ = ["NotificationAccessDenied", "NotificationsRepository", "NotificationsUnavailable"]
