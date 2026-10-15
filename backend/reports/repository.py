"""Forward user JWTs to Supabase and filter every report read by verified owner."""

from uuid import UUID

import httpx

from ..config import Settings
from ..models import ReportResponse


REPORT_COLUMNS = "ticket_id,user_id,description,status,created_at,latitude,longitude,image_url,category,priority,is_approved"


class ReportsUnavailable(RuntimeError):
    """Supabase could not complete a report operation."""


class ReportAccessDenied(RuntimeError):
    """Database grants or policies rejected the authenticated report operation."""


class ReportsRepository:
    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None):
        self.url = settings.project_url + "/rest/v1/reports"
        self.key = settings.publishable_key
        self.client = httpx.AsyncClient(timeout=10.0, follow_redirects=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    def _headers(self, token: str) -> dict[str, str]:
        # Authorization is per request; never mutate a shared client's login session.
        return {"apikey": self.key, "Authorization": "Bearer " + token, "Accept-Profile": "public"}

    def _rows(self, response: httpx.Response) -> list[dict]:
        if response.status_code in (401, 403):
            raise ReportAccessDenied()
        if response.status_code not in (200, 201):
            raise ReportsUnavailable()
        try:
            rows = response.json()
        except ValueError:
            raise ReportsUnavailable() from None
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ReportsUnavailable()
        return rows

    def _owned_records(self, rows: list[dict], owner: UUID) -> list[ReportResponse]:
        # Fail closed if the upstream response contradicts the requested owner filter.
        try:
            records = [ReportResponse.model_validate(row) for row in rows]
        except ValueError:
            raise ReportsUnavailable() from None
        if any(record.user_id != owner for record in records):
            raise ReportsUnavailable()
        return records

    async def create(self, row: dict, token: str, owner: UUID) -> ReportResponse:
        try:
            response = await self.client.post(
                self.url, params={"select": REPORT_COLUMNS}, json=row,
                headers={**self._headers(token), "Content-Profile": "public", "Prefer": "return=representation"},
            )
        except httpx.RequestError:
            raise ReportsUnavailable() from None
        records = self._owned_records(self._rows(response), owner)
        if len(records) != 1 or records[0].ticket_id != row["ticket_id"]:
            raise ReportsUnavailable()
        return records[0]

    async def list_for_owner(self, token: str, owner: UUID, *, limit: int, offset: int) -> list[ReportResponse]:
        try:
            response = await self.client.get(
                self.url, headers=self._headers(token), params={
                    "select": REPORT_COLUMNS, "user_id": "eq." + str(owner),
                    "order": "created_at.desc,ticket_id.desc", "limit": str(limit), "offset": str(offset),
                },
            )
        except httpx.RequestError:
            raise ReportsUnavailable() from None
        records = self._owned_records(self._rows(response), owner)
        if len(records) > limit:
            raise ReportsUnavailable()
        return records

    async def get_for_owner(self, token: str, owner: UUID, ticket_id: str) -> ReportResponse | None:
        try:
            response = await self.client.get(
                self.url, headers=self._headers(token), params={
                    "select": REPORT_COLUMNS, "user_id": "eq." + str(owner),
                    "ticket_id": "eq." + ticket_id, "limit": "1",
                },
            )
        except httpx.RequestError:
            raise ReportsUnavailable() from None
        records = self._owned_records(self._rows(response), owner)
        if not records:
            return None
        if len(records) != 1 or records[0].ticket_id != ticket_id:
            raise ReportsUnavailable()
        return records[0]
