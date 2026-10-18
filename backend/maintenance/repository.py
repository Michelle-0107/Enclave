"""Only the verified server actor can execute the private transactional RPC."""
from uuid import UUID
import httpx
from ..core.config import Settings


class MaintenanceUnavailable(RuntimeError):
    pass


class MaintenanceRejected(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


class MaintenanceRepository:
    def __init__(self, settings: Settings, *, transport=None):
        self.url = settings.project_url + '/rest/v1/rpc/enclave_maintenance_workflow'
        self.headers = {'apikey': settings.api_key, 'Content-Profile': 'public'}
        if not settings.api_key.startswith('sb_secret_'):
            self.headers['Authorization'] = 'Bearer ' + settings.api_key
        self.client = httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False, transport=transport)

    async def close(self):
        await self.client.aclose()

    async def call(self, action: str, actor_id: UUID, **values):
        try:
            result = await self.client.post(self.url, headers=self.headers,
                json={'p_action': action, 'p_args': {**values, 'actor_id': str(actor_id)}})
            if result.status_code != 200:
                raise MaintenanceUnavailable()
            data = result.json()
            if not isinstance(data, dict):
                raise MaintenanceUnavailable()
            failures = {
                'forbidden': (403, 'An active authorized staff account is required'),
                'not_found': (404, 'Maintenance record not found or not assigned to you'),
                'conflict': (409, 'The record changed or this action is not allowed in its current state; refresh and retry'),
                'invalid': (422, 'Invalid maintenance request'),
            }
            if data.get('state') in failures:
                raise MaintenanceRejected(*failures[data['state']])
            if data.get('state') != 'ok':
                raise MaintenanceUnavailable()
            return data
        except (httpx.HTTPError, ValueError, TypeError):
            raise MaintenanceUnavailable() from None
