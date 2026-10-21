"""Read-only, portal-scoped staff history; authorization lives in SQL 027."""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ValidationError


class ActivityLog(BaseModel):
    id: str
    created_at: datetime
    actor_name: str
    actor_role: Literal['management', 'maintenance']
    action: str
    target_label: str
    target_id: str | None
    result: Literal['success', 'failed']
    summary: str


class ActivityLogPage(BaseModel):
    items: list[ActivityLog]
    has_more: bool


class ActivityLogsRepository:
    def __init__(self, settings, *, transport=None):
        self.url = settings.project_url + '/rest/v1/rpc/enclave_activity_logs'
        self.headers = {'apikey': settings.api_key, 'Content-Profile': 'public'}
        if not settings.api_key.startswith('sb_secret_'):
            self.headers['Authorization'] = 'Bearer ' + settings.api_key
        self.client = httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    async def list(self, actor: UUID, portal: str, **filters) -> ActivityLogPage:
        try:
            response = await self.client.post(self.url, headers=self.headers, json={
                'p_args': {**filters, 'actor_id': str(actor), 'portal': portal}})
            if response.status_code != 200:
                raise ValueError()
            data = response.json()
            if data.get('state') == 'forbidden':
                raise HTTPException(403, 'This activity history is not available to your account')
            if data.get('state') != 'ok':
                raise ValueError()
            page = ActivityLogPage.model_validate(data)
            if len(page.items) > filters['limit'] or any(row.actor_role != portal for row in page.items):
                raise ValueError()
            return page
        except (httpx.RequestError, ValueError, TypeError, AttributeError, ValidationError):
            raise HTTPException(503, 'Activity history unavailable. Confirm backend deployment and SQL 027.') from None


def create_router(authenticate):
    router = APIRouter(tags=['Activity logs'])

    @router.get('/api/v1/management/activity-logs', response_model=ActivityLogPage)
    @router.get('/api/v1/maintenance/activity-logs', response_model=ActivityLogPage)
    async def logs(request: Request, response: Response, user=Depends(authenticate),
                   search: str = Query('', max_length=200),
                   role: Literal['management', 'maintenance', 'resident', 'system'] | None = None,
                   result: Literal['success', 'failed'] | None = None,
                   from_date: date | None = Query(None, alias='from'),
                   to_date: date | None = Query(None, alias='to'),
                   limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=100000)):
        response.headers['Cache-Control'] = 'private, no-store'
        if from_date and to_date and from_date > to_date:
            raise HTTPException(422, 'Choose an end date on or after the start date')
        portal = 'management' if '/management/' in request.url.path else 'maintenance'
        return await request.app.state.activity_logs.list(user.user_id, portal,
            search=search.strip(), role=role, result=result,
            **{'from': from_date.isoformat() if from_date else None,
               'to': to_date.isoformat() if to_date else None}, limit=limit, offset=offset)

    return router
