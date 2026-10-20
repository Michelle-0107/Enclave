"""Local synthetic identities/issues with optional real road routing, never deploy."""
from copy import deepcopy
from datetime import datetime,timezone
import json
from threading import RLock
from uuid import UUID,uuid4
from fastapi import Depends,HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import httpx
from ..app import AuthenticatedUser,bearer,create_app,current_user
from ..core.config import Settings
from .workflow_demo import DemoMedia

A='00000000-0000-4000-8000-000000000001'
B='00000000-0000-4000-8000-000000000002'
MANAGER='00000000-0000-4000-8000-000000000003'
FACILITY='10000000-0000-4000-8000-000000000001'
ISSUE='20000000-0000-4000-8000-000000000001'
TOKENS={'demo-resident-token':A,'demo-resident-2-token':B,'demo-management-token':MANAGER}

class CommunityDemoState:
    def __init__(self):
        self.lock=RLock(); self.calls=[]; now=datetime.now(timezone.utc).isoformat()
        self.facilities={FACILITY:{'id':FACILITY,'name':'SYNTHETIC walkway issue point','facility_type':'path_surface',
            'latitude':3.22649,'longitude':101.730755,'created_at':now}}
        self.issues={ISSUE:{'id':ISSUE,'facility_id':FACILITY,'fault_kind':'damage','status':'open','created_at':now,'resolved_at':None}}
        self.votes={ISSUE:{A}}; self.linked={'DEMO-A-001':ISSUE}
        self.reports={ticket:{'id':index,'ticket_id':ticket,'user_id':owner,'description':'SYNTHETIC private evidence',
            'status':'pending','is_approved':False,'latitude':3.22649,'longitude':101.730755,
            'category':'Blocked Path','priority':'high','image_url':None,'created_at':now}
            for index,(ticket,owner) in enumerate([('DEMO-A-001',A),('DEMO-A-002',A),('DEMO-B-001',B)],1)}

    def projection(self,issue):
        f=self.facilities[issue['facility_id']]
        return {**deepcopy(issue),'facility_name':f['name'],'facility_type':f['facility_type'],
            'latitude':f['latitude'],'longitude':f['longitude'],'reporter_count':len(self.votes[issue['id']]),
            'affects_routes':f['facility_type'] not in ('bench','other')}

    def rpc(self,request):
        data=json.loads(request.content); action,args=data['p_action'],data['p_args']; self.calls.append(data)
        def result(**values): return httpx.Response(200,json=deepcopy(values))
        with self.lock:
            if args['actor_id'] not in (A,B): return result(state='forbidden')
            if action=='create_facility':
                item={k:args[k] for k in ('name','facility_type','latitude','longitude')}
                item.update(id=str(uuid4()),created_at=datetime.now(timezone.utc).isoformat())
                self.facilities[item['id']]=item; return result(state='ok',item=item)
            if action in ('facilities','issues','map','obstacles'):
                rows=list(self.facilities.values()) if action=='facilities' else [self.projection(i) for i in self.issues.values()]
                if action!='facilities':
                    rows=[i for i in rows if i['status']=='open' or args.get('include_resolved')]
                    if action in ('map','obstacles'): rows=[i for i in rows if i['reporter_count']>=2]
                    if action=='obstacles': rows=[i for i in rows if i['affects_routes']]
                if action=='obstacles': return result(state='ok',items=rows,checked_at=datetime.now(timezone.utc).isoformat())
                rows=[i for i in rows if args['west']<=i['longitude']<=args['east'] and args['south']<=i['latitude']<=args['north']]
                rows.sort(key=lambda i:(i['created_at'],i['id'])); offset,limit=args['offset'],args['limit']
                return result(state='ok',items=rows[offset:offset+limit],has_more=len(rows)>offset+limit)
            report=self.reports.get(args['report_ticket_id'])
            if not report or report['user_id']!=args['actor_id']: return result(state='not_found')
            if action=='open_issue':
                if args['facility_id'] not in self.facilities: return result(state='not_found')
                issue=next((i for i in self.issues.values() if i['facility_id']==args['facility_id'] and i['fault_kind']==args['fault_kind'] and i['status']=='open'),None)
                if issue is None:
                    if args['report_ticket_id'] in self.linked: return result(state='conflict')
                    issue={'id':str(uuid4()),'facility_id':args['facility_id'],'fault_kind':args['fault_kind'],
                        'status':'open','created_at':datetime.now(timezone.utc).isoformat(),'resolved_at':None}
                    self.issues[issue['id']]=issue; self.votes[issue['id']]=set()
            else: issue=self.issues.get(args['issue_id'])
            if issue is None: return result(state='not_found')
            if issue['status']!='open': return result(state='closed')
            duplicate=args['actor_id'] in self.votes[issue['id']]
            if not duplicate:
                if args['report_ticket_id'] in self.linked: return result(state='conflict')
                self.votes[issue['id']].add(args['actor_id']); self.linked[args['report_ticket_id']]=issue['id']
            return result(state='ok',issue=self.projection(issue),deduplicated=duplicate)

    def evidence(self,request):
        actor=TOKENS.get(request.headers.get('authorization','').removeprefix('Bearer '))
        with self.lock:
            if request.method=='POST':
                row=json.loads(request.content); row.update(id=len(self.reports)+1,created_at=datetime.now(timezone.utc).isoformat())
                self.reports[row['ticket_id']]=row; return httpx.Response(201,json=[deepcopy(row)])
            rows=[r for r in self.reports.values() if r['user_id']==actor]
            if request.url.params.get('ticket_id'): rows=[r for r in rows if r['ticket_id']==request.url.params['ticket_id'].removeprefix('eq.')]
            return httpx.Response(200,json=deepcopy(rows))

def create_community_demo_app(*,state=None,navigation_transport=None,accessibility_network=None):
    state=state or CommunityDemoState()
    def unavailable(r): return httpx.Response(503,json={})
    def residency(r):
        actor=TOKENS.get(r.headers.get('authorization','').removeprefix('Bearer '))
        return httpx.Response(200,json=[{'profile_id':actor,'status':'active','verified_at':'2026-10-16T00:00:00Z'}] if actor in (A,B) else [])
    app=create_app(Settings('https://exampleproject.supabase.co','sb_secret_community_demo_fixture'),
        locations_transport=httpx.MockTransport(lambda request: httpx.Response(404,json={'code':'PGRST202'})),
        auth_transport=httpx.MockTransport(unavailable),reports_transport=httpx.MockTransport(state.evidence),
        residents_transport=httpx.MockTransport(residency),community_transport=httpx.MockTransport(state.rpc),
        workflow_transport=httpx.MockTransport(unavailable),media_services=DemoMedia(),
        navigation_transport=navigation_transport,accessibility_network=accessibility_network)
    def user(credentials: HTTPAuthorizationCredentials | None=Depends(bearer)):
        actor=TOKENS.get(credentials.credentials) if credentials else None
        if not actor: raise HTTPException(401,'Use a local demo token')
        return AuthenticatedUser(UUID(actor),'demo@example.com',credentials.credentials)
    @app.middleware('http')
    async def sandbox_header(request,call_next):
        response=await call_next(request); response.headers['X-Enclave-Sandbox']='synthetic-issues'; return response
    app.dependency_overrides[current_user]=user; app.state.demo=state
    app.title='Enclave LOCAL two-resident community issue sandbox'
    app.description=('Synthetic identities/evidence only; no .env/Supabase/email/AWS calls. Real local road engine on 8002. '
        'Initially one reporter. demo-resident-token owns DEMO-A-001/DEMO-A-002; '
        'demo-resident-2-token owns DEMO-B-001. Issue 20000000-0000-4000-8000-000000000001. '
        'No real accessible network has been surveyed. Never deploy this sandbox.')
    return app

if __name__=='__main__':
    import uvicorn
    uvicorn.run(create_community_demo_app(),host='127.0.0.1',port=8006)
