"""Surveyed graph routing excludes stairs, unknown/unverified edges, and damage."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone
import unittest
from backend.navigation.accessibility import VerifiedNetwork
from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.provider import NavigationRejected,NavigationUnavailable
from backend.reports.issues import CommunityObstacleSnapshot
from backend.navigation.zones import zone_bounds

def document():
    now=datetime.now(timezone.utc)
    points={'a':(101.7304,3.2254),'b':(101.7304,3.2256),'c':(101.7308,3.2256),'d':(101.7308,3.2254)}
    def edge(key,start,end,steps=False):
        return {'id':key,'start':start,'end':end,'name':key,'geometry':[points[start],points[end]],
            'assessment':'accessible','has_steps':steps,'step_free_connection':True,'verified_at':(now-timedelta(hours=1)).isoformat(),
            'valid_until':(now+timedelta(days=1)).isoformat(),'evidence_reference':'SYNTHETIC test assessment'}
    return {'version':1,'source':'synthetic_demo','nodes':[{'id':key,'coordinate':value} for key,value in points.items()],
        'edges':[edge('stairs','a','d',True),edge('ramp1','a','b'),edge('path','b','c'),edge('ramp2','c','d')]}

class AccessibilityTests(unittest.TestCase):
    def body(self): return WalkingRouteRequest(route_mode='accessible',origin={'latitude':3.2254,'longitude':101.7304},destination={'latitude':3.2254,'longitude':101.7308})
    def snapshot(self): return CommunityObstacleSnapshot(checked_at=datetime.now(timezone.utc),items=[])
    def test_uses_longer_step_free_path_and_never_stair_shortcut(self):
        response=VerifiedNetwork(document=document()).route(self.body(),self.snapshot(),[])
        self.assertEqual(response.route_mode,'accessible'); self.assertEqual(response.routing_engine,'verified_network')
        self.assertEqual(len(response.geometry.coordinates),4)
        self.assertFalse(any('stairs' in step.instruction for step in response.maneuvers))
        self.assertEqual(response.accessibility_status,'synthetic_network'); self.assertFalse(response.field_verified)
    def test_unknown_expired_unverified_or_missing_ramp_connection_are_not_allowed(self):
        changes=[{'assessment':'unknown'},{'verified_at':None},{'step_free_connection':False},{'has_steps':None},
            {'valid_until':(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat()}]
        for change in changes:
            data=document(); data['edges'][1].update(change)
            with self.assertRaises(NavigationRejected): VerifiedNetwork(document=data).route(self.body(),self.snapshot(),[])
    def test_damage_on_only_step_free_path_does_not_fall_back_to_stairs(self):
        with self.assertRaises(NavigationRejected):
            VerifiedNetwork(document=document()).route(self.body(),self.snapshot(),[zone_bounds(3.2256,101.7306,5)])
    def test_unknown_approach_is_not_invented_from_nearest_road(self):
        body=self.body().model_copy(update={'origin':self.body().origin.model_copy(update={'latitude':3.22542})})
        with self.assertRaises(NavigationRejected): VerifiedNetwork(document=document()).route(body,self.snapshot(),[])
    def test_empty_real_network_returns_no_route(self):
        with self.assertRaises(NavigationRejected): VerifiedNetwork().route(self.body(),self.snapshot(),[])
        self.assertFalse(VerifiedNetwork().coverage()['accessible_network_available'])
    def test_real_survey_flag_only_for_explicit_survey_source(self):
        data=document(); data['source']='field_survey'
        response=VerifiedNetwork(document=data).route(self.body(),self.snapshot(),[])
        self.assertTrue(response.field_verified); self.assertEqual(response.data_source,'verified_accessibility_network')
    def test_invalid_graph_geometry_duplicate_ids_and_boolean_coercion_rejected(self):
        for change in ('duplicate','geometry','coercion'):
            data=document()
            if change=='duplicate': data['nodes'].append(data['nodes'][0])
            if change=='geometry': data['edges'][0]['geometry'][0]=(101.74,3.23)
            if change=='coercion': data['edges'][0]['has_steps']='false'
            with self.assertRaises(NavigationUnavailable): VerifiedNetwork(document=data).load()
    def test_bidirectional_path_and_maneuver_distance_consistency(self):
        body=self.body(); body=body.model_copy(update={'origin':body.destination,'destination':body.origin})
        route=VerifiedNetwork(document=document()).route(body,self.snapshot(),[])
        self.assertAlmostEqual(sum(s.distance_meters for s in route.maneuvers),route.distance_meters)
        self.assertEqual(route.maneuvers[0].begin_shape_index,0)
        self.assertEqual(route.maneuvers[-1].end_shape_index,len(route.geometry.coordinates)-1)
