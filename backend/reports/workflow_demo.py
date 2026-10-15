"""Synthetic report review sandbox. No .env, Supabase, S3, AI, or email calls."""

from copy import deepcopy
from datetime import datetime, timezone
import json
import re
from threading import RLock
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import httpx

from ..app import AuthenticatedUser, bearer, create_app, current_user
from ..core.config import Settings
from .moderation import StatusUpdate


RESIDENT = UUID('00000000-0000-4000-8000-000000000001')
MANAGER = UUID('00000000-0000-4000-8000-000000000002')
OTHER = UUID('00000000-0000-4000-8000-000000000003')
TOKENS = {'demo-resident-token': RESIDENT, 'demo-management-token': MANAGER, 'demo-other-token': OTHER}


class DemoMedia:
    def upload(self, key, content, content_type):
        return 'https://example.invalid/demo/' + key

    def analyze(self, content, description):
        return {'category': 'Damaged Facility', 'priority': 'medium', 'summary': description}


def create_workflow_demo_app():
    records = [{'id': 1, 'ticket_id': 'DEMO-REVIEW-001', 'user_id': str(RESIDENT),
                'description': 'Synthetic streetlight report', 'status': 'pending', 'is_approved': False,
                'latitude': 3.139, 'longitude': 101.687, 'category': 'Streetlight', 'priority': 'medium',
                'image_url': None, 'created_at': '2026-10-15T01:00:00Z'}]
    events = []
    lock = RLock()

    def result(**values):
        return httpx.Response(200, json=deepcopy(values))

    def workflow(request):
        data = json.loads(request.content)
        action, args = data['p_action'], data['p_args']
        actor = args['actor_id']
        manager = actor == str(MANAGER)
        with lock:
            if action in ('list','update') and not manager:
                return result(state='forbidden')
            if action == 'list':
                selected = [r for r in records if not args['status'] or r['status'] == args['status']]
                selected.sort(key=lambda r: (r['created_at'],r['id']), reverse=True)
                selected = selected[args['offset']:args['offset'] + args['limit'] + 1]
                return result(state='ok',items=selected[:args['limit']],has_more=len(selected)>args['limit'])
            row = next((r for r in records if r['ticket_id'] == args['ticket_id']
                        and (manager or r['user_id'] == actor)), None)
            if row is None:
                return result(state='not_found')
            if action == 'history':
                selected = [deepcopy(e) for e in events if e['report_id'] == row['id']]
                if not manager:
                    for event in selected:
                        event['changed_by'] = None
                selected = selected[args['offset']:args['offset'] + args['limit'] + 1]
                return result(state='ok', items=selected[:args['limit']], has_more=len(selected)>args['limit'],
                              is_management=manager)
            if action != 'update':
                return result(state='invalid')
            update = StatusUpdate.model_validate({k: args[k] for k in ('status','expected_status','note','repair_verified')})
            if row['status'] != update.expected_status:
                return result(state='conflict')
            row['status'] = update.status
            row['is_approved'] = update.status in ('approved','in_progress','resolved')
            event = {'id':len(events)+1,'report_id':row['id'], 'from_status':update.expected_status,
                     'to_status':update.status, 'note':update.note, 'repair_verified':update.repair_verified,
                     'changed_by':str(MANAGER),'actor_role':'management',
                     'created_at':datetime.now(timezone.utc).isoformat()}
            events.append(event)
            return result(state='ok',report=row,event=event)

    def maps(request):
        with lock:
            allowed = request.url.params['status'][4:-1].split(',')
            selected = [r for r in records if r['is_approved'] and r['status'] in allowed]
            for column, operator, value in re.findall(r'(longitude|latitude)\.(gte|lte)\.([^,)]+)',
                                                      request.url.params['and']):
                selected = [r for r in selected if (r[column] >= float(value) if operator == 'gte' else r[column] <= float(value))]
            selected.sort(key=lambda r: (r['created_at'],r['id']), reverse=True)
            offset, limit = int(request.url.params['offset']), int(request.url.params['limit'])
            return httpx.Response(200,json=deepcopy(selected[offset:offset+limit]))

    def reports(request):
        actor = TOKENS.get(request.headers.get('authorization','').removeprefix('Bearer '))
        with lock:
            if request.method == 'POST':
                row = json.loads(request.content)
                row.update(id=len(records)+1,created_at=datetime.now(timezone.utc).isoformat())
                records.append(row)
                return httpx.Response(201,json=[deepcopy(row)])
            selected = [r for r in records if r['user_id'] == str(actor)]
            ticket = request.url.params.get('ticket_id')
            if ticket:
                selected = [r for r in selected if r['ticket_id'] == ticket.removeprefix('eq.')]
            selected.sort(key=lambda r:(r['created_at'],r['id']),reverse=True)
            offset,limit = int(request.url.params.get('offset','0')),int(request.url.params.get('limit','100'))
            return httpx.Response(200,json=deepcopy(selected[offset:offset+limit]))

    def residency(request):
        actor = TOKENS.get(request.headers.get('authorization','').removeprefix('Bearer '))
        rows = [] if actor not in (RESIDENT,OTHER) else [{'profile_id':str(actor),'status':'active',
                                                       'verified_at':'2026-10-15T00:00:00Z'}]
        return httpx.Response(200,json=rows)

    def unavailable(request):
        return httpx.Response(503,json={})

    app = create_app(Settings('https://exampleproject.supabase.co','sb_secret_workflow_fixture_only'),
        auth_transport=httpx.MockTransport(unavailable),reports_transport=httpx.MockTransport(reports),
        residents_transport=httpx.MockTransport(residency),map_transport=httpx.MockTransport(maps),
        workflow_transport=httpx.MockTransport(workflow),media_services=DemoMedia())

    def demo_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        actor = TOKENS.get(credentials.credentials) if credentials else None
        if actor is None:
            raise HTTPException(401,'Use a local demo token',headers={'WWW-Authenticate':'Bearer'})
        return AuthenticatedUser(actor,'demo@example.com',credentials.credentials)

    app.dependency_overrides[current_user] = demo_user
    app.title = 'Enclave LOCAL report workflow sandbox'
    app.description = ('Synthetic data only. Switch between demo-management-token and demo-resident-token. '
                       'Starts with DEMO-REVIEW-001 pending. Data resets on restart. No real provider calls.')
    return app


if __name__ == '__main__':
    import uvicorn
    print('LOCAL WORKFLOW SANDBOX: http://127.0.0.1:8004/docs')
    uvicorn.run(create_workflow_demo_app(),host='127.0.0.1',port=8004)
