"""One read-only SQL snapshot, authorized against the trusted management profile."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from pydantic import BaseModel, Field, model_validator

from ..reports.issues import CommunityIssue


class WhatIfUnavailable(RuntimeError):
    pass


class WhatIfRejected(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Snapshot(BaseModel):
    checked_at: datetime
    issues: list[CommunityIssue] = Field(max_length=100)

    @model_validator(mode='after')
    def qualified_unique_issues(self):
        if self.checked_at.tzinfo is None or len({i.id for i in self.issues}) != len(self.issues):
            raise ValueError('Invalid snapshot')
        if any(i.status != 'open' or i.reporter_count < 2 for i in self.issues):
            raise ValueError('Snapshot must contain only threshold-qualified open issues')
        facilities = {}
        pairs = set()
        for issue in self.issues:
            identity = (issue.facility_name, issue.facility_type, issue.latitude, issue.longitude)
            if issue.facility_id in facilities and facilities[issue.facility_id] != identity:
                raise ValueError('Inconsistent facility projection')
            pair = (issue.facility_id, issue.fault_kind)
            if pair in pairs:
                raise ValueError('Duplicate open incident')
            facilities[issue.facility_id] = identity
            pairs.add(pair)
        return self


class WhatIfRepository:
    def __init__(self, settings, *, transport=None):
        self.url = settings.project_url + '/rest/v1/rpc/enclave_what_if_snapshot'
        self.headers = {'apikey': settings.api_key, 'Content-Profile': 'public'}
        if not settings.api_key.startswith('sb_secret_'):
            self.headers['Authorization'] = 'Bearer ' + settings.api_key
        self.client = httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    async def snapshot(self, actor_id: UUID):
        try:
            async with self.client.stream('POST', self.url, headers=self.headers,
                                         json={'p_actor_id': str(actor_id)}) as response:
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > 1_048_576:
                        raise WhatIfUnavailable()
                if response.status_code != 200:
                    raise WhatIfUnavailable()
                import json
                data = json.loads(payload)
            if not isinstance(data, dict):
                raise WhatIfUnavailable()
            if data.get('state') == 'forbidden':
                raise WhatIfRejected(403, 'Management role required for repair simulations')
            if data.get('state') != 'ok':
                raise WhatIfUnavailable()
            snapshot = Snapshot.model_validate(data)
            now = datetime.now(timezone.utc)
            if not now - timedelta(seconds=60) <= snapshot.checked_at <= now + timedelta(seconds=5):
                raise WhatIfUnavailable()
            return snapshot
        except (httpx.HTTPError, ValueError, TypeError, KeyError, RecursionError):
            raise WhatIfUnavailable() from None
