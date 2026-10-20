"""Demo step-free infrastructure provenance, isolation and frozen availability acceptance."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from backend.navigation.areas import demo_area_dataset,service_areas
from backend.navigation.demo_accessibility import demo_step_free_graph,generate_accessibility,accessible_graph
from backend.navigation.demo_network import demo_walking_graph
from backend.navigation.roadside import walking_graph,distance
from backend.navigation.provider import NavigationRejected
from backend.navigation.contracts import WalkingRouteRequest
from backend.tools.audit_demo_accessibility import FROZEN,evaluate,acceptance
from backend.tests.test_roadside import osm_graph,p,body

ROOT=Path(__file__).resolve().parents[1]

class DemoAccessibilityTests(unittest.TestCase):
    def test_frozen_app_level_samples_meet_eighty_percent_in_every_group(self):
        reports={}
        for name,digest in FROZEN.items():
            raw=(ROOT/f'tests/fixtures/demo-routing/{name}-samples.json').read_bytes()
            self.assertEqual(hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest(),digest)
            result=evaluate(json.loads(raw));reports[name]=result
            self.assertEqual(len(result['cases']),240)
            for row in result['summary']:
                with self.subTest(batch=name,area=row['area'],category=row['category']):
                    self.assertEqual(row['total'],30);self.assertGreaterEqual(row['success'],24)
        self.assertTrue(acceptance(reports)['passed'])

    def test_geographic_manifest_reproduces_and_never_changes_live_or_walking_facilities(self):
        for area in service_areas().items:
            if not area.resident_demo_supported:continue
            dataset=demo_area_dataset(area.id).dataset;base=demo_walking_graph(area.id)
            facilities=dataset['accessibilityFacilities'];graph=demo_step_free_graph(area.id)
            self.assertEqual(generate_accessibility(area.id,base,dataset),facilities)
            ids={f['id'] for f in facilities};self.assertGreater(len(ids),100)
            self.assertEqual(len(ids),len(facilities))
            self.assertTrue(ids.isdisjoint(e.way_id for e in walking_graph(area.id).edges))
            self.assertTrue(ids.isdisjoint(e.way_id for e in base.edges))
            self.assertFalse(any(e.kind in {'steps','open_access','unmarked_crossing'} for e in graph.edges))
            self.assertEqual({e.way_id for e in graph.edges if e.kind.startswith('demo_')},ids)
            for facility in facilities:
                self.assertEqual(facility['routingSource'],'simulation');self.assertFalse(facility['fieldVerified']);self.assertTrue(facility['stepFree'])
                own=frozenset({facility['buildingIndex']}) if facility['kind']=='accessible_entrance' else frozenset()
                self.assertTrue(base.land_access.clear(*facility['geometry'],own_buildings=own))
                if own:self.assertLessEqual(distance(*facility['geometry']),20+1e-6)
                if facility['kind']=='step_free_path':self.assertLessEqual(distance(*facility['geometry']),20+1e-6)

    def test_a_tampered_accessibility_assumption_or_facility_cannot_enable_a_route(self):
        area='kl-east-pilot';original=demo_area_dataset(area).dataset;base=demo_walking_graph(area)
        for change in ('verified','limit','facility'):
            data=deepcopy(original)
            if change=='verified':data['demoAccessibility']['fieldVerified']=True
            elif change=='limit':data['demoAccessibility']['outdoorApproachMeters']=100
            else:data['accessibilityFacilities'][0]['geometry'][0][0]+=0.001
            with self.assertRaises(ValueError):accessible_graph(base,data['accessibilityFacilities'],data)

    def test_simulated_accessible_graph_cannot_be_used_as_a_live_graph(self):
        graph=demo_step_free_graph('kl-east-pilot')
        data=demo_area_dataset('kl-east-pilot').dataset;f=data['accessibilityFacilities'][0]
        body=WalkingRouteRequest(route_mode='accessible',origin=dict(zip(('longitude','latitude'),f['geometry'][0])),destination=dict(zip(('longitude','latitude'),f['geometry'][-1])))
        with self.assertRaises(NavigationRejected):graph.route(body)

    def prepared(self,graph):
        data={'edges':[],'demoAccessibility':{'areaId':'fixture','version':'demo-step-free-v1','source':'simulation',
              'fieldVerified':False,'outdoorApproachMeters':20,'buildingApproach':'simulated_registered_entrances'}}
        facilities=generate_accessibility('fixture',graph,data)
        return accessible_graph(graph,facilities,data),facilities

    def entrance_fixture(self,obstacle=None,offset=10):
        nodes={'a':(-150,0),'b':(150,0),'w':(-20,offset),'x':(20,offset),'y':(20,offset+40),'z':(-20,offset+40)}
        ways=[(['a','b'],{'highway':'footway'}),(['w','x','y','z','w'],{'building':'yes'})]
        if obstacle=='wall':
            nodes.update({'c':(-150,5),'d':(150,5)});ways.append((['c','d'],{'barrier':'wall'}))
        elif obstacle in {'water','building'}:
            nodes.update({'c':(-150,3),'d':(150,3),'e':(150,7),'f':(-150,7)})
            ways.append((['c','d','e','f','c'],{'natural':'water'} if obstacle=='water' else {'building':'yes'}))
        return osm_graph(nodes,ways)

    def test_registered_building_ramp_has_fixed_entrance_and_cannot_skip_damage(self):
        base=self.entrance_fixture();graph,facilities=self.prepared(base)
        record=next(f for f in facilities if f['kind']=='accessible_entrance')
        route=graph.route(body(p(0,30),p(120,0),'accessible'),demo_mode=True)
        self.assertIn(record['id'],route.demo_facility_ids)
        self.assertEqual(route.geometry.coordinates[0],tuple(record['geometry'][0]))
        self.assertAlmostEqual(route.origin_snap_distance_meters,distance(p(0,30),record['coordinate']),places=3)
        self.assertTrue(any('Indoor access to this entrance is assumed' in m.instruction for m in route.maneuvers))
        self.assertFalse(route.field_verified);self.assertEqual(route.accessibility_status,'synthetic_network')
        with self.assertRaises(NavigationRejected):base.route(body(p(0,30),p(120,0),'accessible'),demo_mode=True)
        a,b=record['geometry'];mid=tuple((x+y)/2 for x,y in zip(a,b));delta=1/111000
        with self.assertRaises(NavigationRejected):
            graph.route(body(p(0,30),p(120,0),'accessible'),demo_mode=True,boxes=[(mid[0]-delta,mid[1]-delta,mid[0]+delta,mid[1]+delta)])
        # Changing the indoor pin does not invent a new outdoor entrance.
        other=graph.route(body(p(5,35),p(120,0),'accessible'),demo_mode=True)
        self.assertEqual(other.geometry.coordinates[0],route.geometry.coordinates[0])

    def test_simulated_entrances_cannot_cross_known_obstacles_or_extend_outdoor_limit(self):
        for obstacle,offset in (('wall',10),('water',10),('building',10),(None,21)):
            with self.subTest(obstacle=obstacle,offset=offset):
                base=self.entrance_fixture(obstacle,offset);graph,_=self.prepared(base)
                with self.assertRaises(NavigationRejected):graph.route(body(p(0,offset+20),p(120,0),'accessible'),demo_mode=True)

    def test_accessible_road_detour_remains_preferred_to_a_ramp_shortcut(self):
        base=osm_graph({'a':(0,0),'b':(100,0),'c':(100,15),'d':(0,15)},[(['a','b','c','d'],{'highway':'footway'})])
        graph,_=self.prepared(base)
        route=graph.route(body(p(0,0),p(0,15),'accessible'),demo_mode=True)
        self.assertAlmostEqual(route.distance_meters,215,places=2)

    def test_acceptance_rejects_missing_groups_and_does_not_hide_a_failed_category(self):
        reports={name:{'summary':[dict(area=area.id,category=category,success=30,total=30) for area in service_areas().items if area.resident_demo_supported for category in ('cross_road','same_side','local_streets','long_distance')]} for name in FROZEN}
        self.assertTrue(acceptance(reports)['passed'])
        reports['walking-primary']['summary'][0]['success']=23
        self.assertFalse(acceptance(reports)['passed'])
        reports['walking-primary']['summary'].pop()
        self.assertFalse(acceptance(reports)['passed'])
