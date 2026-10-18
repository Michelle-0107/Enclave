"""Pilot scope, authentication, genuine maneuver projection, and provider failures."""

from copy import deepcopy
import json
import unittest
from uuid import UUID

from fastapi import Depends,HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
import httpx

from backend.app import AuthenticatedUser,bearer,create_app,current_user
from backend.core.config import Settings
from backend.navigation.config import NavigationSettings,PILOT_BBOX,MAP_CENTER,MAX_PROVIDER_BYTES
from backend.navigation.demo import DEMO_COORDINATES,RESIDENT,encode_polyline6,fixture_response
from backend.navigation.provider import decode_polyline6


class NavigationTests(unittest.TestCase):
    def setUp(self):
        self.requests=[]
        self.rows=[{'profile_id':RESIDENT,'status':'active','verified_at':'2026-10-16T00:00:00Z'}]
        self.body={'origin':{'latitude':3.2254,'longitude':101.7304},
                   'destination':{'latitude':3.2260,'longitude':101.7312},'profile':'walking','language':'en'}

    def client(self,handler=None):
        def no_call(request):
            raise AssertionError('Navigation must not contact report, map, registration, S3, or AI providers')
        def engine(request):
            self.requests.append(request)
            return handler(request) if handler else httpx.Response(200,json=fixture_response())
        app=create_app(Settings('https://exampleproject.supabase.co','sb_secret_nav_fixture'),
            auth_transport=httpx.MockTransport(no_call),reports_transport=httpx.MockTransport(no_call),
            map_transport=httpx.MockTransport(no_call),workflow_transport=httpx.MockTransport(no_call),
            community_transport=httpx.MockTransport(lambda r:httpx.Response(404,json={})),
            residents_transport=httpx.MockTransport(lambda request:httpx.Response(200,json=self.rows)),
            navigation_transport=httpx.MockTransport(engine),navigation_settings=NavigationSettings(crossing_policy='provider_default'))
        def user(credentials: HTTPAuthorizationCredentials | None=Depends(bearer)):
            if credentials is None or credentials.credentials != 'fixture-resident':
                raise HTTPException(401,'Invalid credentials')
            return AuthenticatedUser(UUID(RESIDENT),'resident@example.com',credentials.credentials)
        app.dependency_overrides[current_user]=user
        client=TestClient(app)
        client.__enter__()
        self.addCleanup(client.__exit__,None,None,None)
        return client

    def request(self,client,body=None):
        return client.post('/api/v1/navigation/routes',json=self.body if body is None else body,
                           headers={'Authorization':'Bearer fixture-resident'})

    def test_area_is_explicitly_a_pilot_not_an_official_boundary(self):
        response=self.client().get('/api/v1/navigation/area',headers={'Authorization':'Bearer fixture-resident'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['bbox'],list(PILOT_BBOX))
        self.assertEqual(response.json()['center'],list(MAP_CENTER))
        self.assertFalse(response.json()['official_boundary'])
        self.assertFalse(response.json()['field_verified'])
        self.assertEqual(self.requests,[])

    def test_valid_route_preserves_lon_lat_steps_and_meter_units(self):
        response=self.request(self.client())
        self.assertEqual(response.status_code,200,response.text)
        data=response.json()
        self.assertEqual(data['geometry']['coordinates'],[list(p) for p in DEMO_COORDINATES])
        self.assertAlmostEqual(data['distance_meters'],sum(x['length'] for x in fixture_response()['trip']['legs'][0]['maneuvers'])*1000)
        self.assertEqual(len(data['maneuvers']),3)
        self.assertIn('Turn right',data['maneuvers'][1]['spoken_instruction'])
        self.assertGreater(data['maneuvers'][1]['distance_from_start_meters'],0)
        self.assertEqual(data['community_issue_avoidance'],'not_applied')
        self.assertFalse(data['field_verified'])
        self.assertTrue(data['warnings'])
        self.assertEqual(response.headers['cache-control'],'private, no-store')

    def test_provider_receives_pedestrian_coordinates_and_no_auth_secrets(self):
        self.assertEqual(self.request(self.client()).status_code,200)
        request=self.requests[0]
        data=json.loads(request.content)
        self.assertEqual(request.url.path,'/route')
        self.assertEqual(data['costing'],'pedestrian')
        self.assertEqual(data['directions_options'],{'units':'kilometers','language':'en-US'})
        self.assertEqual(data['locations'][0]['lat'],3.2254)
        self.assertEqual(data['locations'][0]['lon'],101.7304)
        self.assertNotIn('authorization',request.headers)
        self.assertNotIn('apikey',request.headers)
        self.assertNotIn(RESIDENT,request.content.decode())

    def test_missing_or_invalid_token_does_not_call_engine(self):
        client=self.client()
        self.assertEqual(client.post('/api/v1/navigation/routes',json=self.body).status_code,401)
        self.assertEqual(client.get('/api/v1/navigation/area',headers={'Authorization':'Bearer wrong'}).status_code,401)
        self.assertEqual(self.requests,[])

    def test_active_verified_residency_is_required(self):
        client=self.client()
        for rows in ([],[{'profile_id':RESIDENT,'status':'inactive','verified_at':'2026-10-16T00:00:00Z'}],
                     [{'profile_id':RESIDENT,'status':'active','verified_at':None}]):
            self.rows=rows
            self.assertEqual(self.request(client).status_code,403)
        self.assertEqual(self.requests,[])

    def test_invalid_scope_profiles_and_caller_controlled_fields_are_rejected(self):
        client=self.client()
        cases=[{**self.body,'profile':'step_free'},{**self.body,'language':'zh'},
               {**self.body,'origin':{'latitude':3.139,'longitude':101.687}},
               {**self.body,'origin':self.body['destination']},
               {**self.body,'origin':{'latitude':True,'longitude':101.7304}},
               {**self.body,'origin':{'latitude':91.0,'longitude':101.7304}},
               {**self.body,'provider_url':'http://private.invalid'},
               {**self.body,'user_id':RESIDENT},{**self.body,'avoid_confirmed_obstacles':'false'}]
        for body in cases:
            with self.subTest(body=body):
                self.assertEqual(self.request(client,body).status_code,422)
        self.assertEqual(self.requests,[])

    def test_obstacle_avoidance_is_not_silently_promised(self):
        # Database migration/provider failure must not silently return an ordinary route.
        client=self.client()
        response=self.request(client,{**self.body,'avoid_confirmed_obstacles':True})
        self.assertEqual(response.status_code,503)
        self.assertEqual(self.requests,[])

    def test_route_does_not_echo_extra_provider_details(self):
        data=fixture_response()
        data.update(secret='upstream-private-fixture')
        response=self.request(self.client(lambda request:httpx.Response(200,json=data)))
        self.assertEqual(response.status_code,200)
        self.assertNotIn('upstream-private-fixture',response.text)

    def test_no_route_errors_are_distinct_from_provider_outages(self):
        for status,body,expected in [(400,{'error_code':171},422),(400,{'error_code':442},422),
                                     (429,{'error_code':171},503),(500,{'error':'provider-private'},503)]:
            with self.subTest(status=status):
                response=self.request(self.client(lambda request:httpx.Response(status,json=body)))
                self.assertEqual(response.status_code,expected)
                self.assertNotIn('provider-private',response.text)

    def test_timeout_and_non_json_response_are_generic(self):
        def timeout(request):
            raise httpx.ReadTimeout('provider-private')
        for handler in (timeout,lambda request:httpx.Response(200,text='provider-private')):
            response=self.request(self.client(handler))
            self.assertEqual(response.status_code,503)
            self.assertNotIn('provider-private',response.text)

    def test_oversized_and_nonfinite_provider_results_are_rejected(self):
        for content in (b'x'*(MAX_PROVIDER_BYTES+1),b'{"trip":NaN}'):
            self.assertEqual(self.request(self.client(lambda request:httpx.Response(200,content=content))).status_code,503)

    def test_bad_provider_shapes_units_and_step_order_fail_closed(self):
        variants=[]
        for field,value in [('status',False),('units','miles'),('language','fr-FR')]:
            body=fixture_response(); body['trip'][field]=value; variants.append(body)
        body=fixture_response();body['trip']['legs'][0]['shape']='?';variants.append(body)
        body=fixture_response();body['trip']['legs'][0]['shape']=encode_polyline6([(0.0,0.0),(0.1,0.1)]);variants.append(body)
        body=fixture_response();body['trip']['legs'][0]['maneuvers'][1]['begin_shape_index']=0;variants.append(body)
        body=fixture_response();body['trip']['legs'][0]['maneuvers'][0]['type']=10;variants.append(body)
        body=fixture_response();body['trip']['legs'][0]['summary']['length']=9999;variants.append(body)
        body=fixture_response();body['trip']['legs'][0]['maneuvers'][0]['time']=999;variants.append(body)
        for body in variants:
            with self.subTest(body=body):
                self.assertEqual(self.request(self.client(lambda request:httpx.Response(200,json=body))).status_code,503)

    def test_snap_too_far_from_requested_position_returns_422(self):
        body={**self.body,'origin':{'latitude':3.23,'longitude':101.73}}
        self.assertEqual(self.request(self.client(),body).status_code,422)

    def test_spoken_instruction_falls_back_to_written_instruction(self):
        body=fixture_response()
        for step in body['trip']['legs'][0]['maneuvers']:
            del step['verbal_pre_transition_instruction']
        response=self.request(self.client(lambda request:httpx.Response(200,json=body)))
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['maneuvers'][1]['instruction'],response.json()['maneuvers'][1]['spoken_instruction'])

    def test_polyline_roundtrip_and_malformed_shape(self):
        points=[(101.7304,3.2254),(101.7304,3.2260),(101.7312,3.2260)]
        self.assertEqual(decode_polyline6(encode_polyline6(points)),points)
        for value in ('','?','~'*100,'\x00\x00',[],None):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    decode_polyline6(value)

    def test_provider_origin_configuration_cannot_contain_credentials_or_paths(self):
        for url in ('file:///tmp','https://user:secret@example.com','https://example.com/path','https://example.com?key=x'):
            with self.assertRaises(ValueError):
                NavigationSettings(provider_url=url)
