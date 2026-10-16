"""Provider-free directions contract sandbox. Geometry and instructions are synthetic."""

from fastapi import Depends,HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import httpx

from ..app import AuthenticatedUser,bearer,create_app,current_user
from ..core.config import Settings
from .config import NavigationSettings
from .service import distance_meters

RESIDENT='00000000-0000-4000-8000-000000000001'
DEMO_COORDINATES=[(101.7304,3.2254),(101.7304,3.2260),(101.7312,3.2260)]


def encode_polyline6(coordinates):
    result=[]
    previous=[0,0]
    for longitude,latitude in coordinates:
        current=[round(latitude*1_000_000),round(longitude*1_000_000)]
        for i,value in enumerate(current):
            delta=value-previous[i]
            encoded=~(delta<<1) if delta<0 else delta<<1
            while encoded>=32:
                result.append(chr((32|(encoded&31))+63))
                encoded>>=5
            result.append(chr(encoded+63))
        previous=current
    return ''.join(result)


def fixture_response():
    lengths=[distance_meters(a,b)/1000 for a,b in zip(DEMO_COORDINATES,DEMO_COORDINATES[1:])]
    steps=[]
    for index,(kind,instruction) in enumerate([(1,'Walk north on the synthetic demo path.'),
        (10,'Turn right onto the synthetic demo path.'),(4,'You have arrived at the demo destination.')]):
        length=lengths[index] if index<2 else 0
        steps.append({'type':kind,'instruction':instruction,'verbal_pre_transition_instruction':instruction,
            'length':length,'time':length*1000/1.4,'begin_shape_index':index,'end_shape_index':min(index+1,2)})
    return {'trip':{'status':0,'units':'kilometers','language':'en-US','legs':[{
        'shape':encode_polyline6(DEMO_COORDINATES),'summary':{'length':sum(lengths),'time':sum(lengths)*1000/1.4},
        'maneuvers':steps}]}}


def create_navigation_demo_app():
    from uuid import UUID
    def unavailable(request):
        return httpx.Response(503,json={})
    def residency(request):
        return httpx.Response(200,json=[{'profile_id':RESIDENT,'status':'active','verified_at':'2026-10-16T00:00:00Z'}])
    app=create_app(Settings('https://exampleproject.supabase.co','sb_secret_nav_demo_fixture'),
        auth_transport=httpx.MockTransport(unavailable),reports_transport=httpx.MockTransport(unavailable),
        residents_transport=httpx.MockTransport(residency),map_transport=httpx.MockTransport(unavailable),
        workflow_transport=httpx.MockTransport(unavailable),community_transport=httpx.MockTransport(unavailable),obstacles_transport=httpx.MockTransport(unavailable),navigation_settings=NavigationSettings(source='synthetic_demo'),
        navigation_transport=httpx.MockTransport(lambda request:httpx.Response(200,json=fixture_response())))
    def user(credentials: HTTPAuthorizationCredentials | None=Depends(bearer)):
        if credentials is None or credentials.credentials != 'demo-resident-token':
            raise HTTPException(401,'Use the local demo resident token',headers={'WWW-Authenticate':'Bearer'})
        return AuthenticatedUser(UUID(RESIDENT),'resident@example.com',credentials.credentials)
    app.dependency_overrides[current_user]=user
    app.title='Enclave LOCAL navigation contract sandbox'
    app.description=('Synthetic instructions and geometry only; not a real KL East route. Authorize with demo-resident-token. '
        'Origin: 3.2254,101.7304. Destination: 3.226,101.7312. No .env, engine, email, AWS, or database calls.')
    return app


if __name__=='__main__':
    import uvicorn
    uvicorn.run(create_navigation_demo_app(),host='127.0.0.1',port=8005)
