"""Shared modelled facilities, endpoint candidates and unchanged fallback policy."""
from copy import deepcopy
import unittest
from unittest.mock import patch
from backend.navigation.demo_accessibility import accessible_graph,generate_accessibility,shared_demo_walking_graph,demo_step_free_graph
from backend.navigation.demo_routes import _options
from backend.navigation.provider import NavigationRejected
from backend.navigation.areas import demo_area_dataset
from backend.navigation.roadside import distance
from backend.tests.test_roadside import osm_graph,p,body

def prepared(base):
    data={'edges':[],'demoAccessibility':{'areaId':'fixture','version':'demo-step-free-v1','source':'simulation',
        'fieldVerified':False,'outdoorApproachMeters':20,'buildingApproach':'simulated_registered_entrances'}}
    facilities=generate_accessibility('fixture',base,data);data['accessibilityFacilities']=facilities
    return accessible_graph(base,facilities,data,include_ordinary=True),data

class SharedDemoRouteTests(unittest.TestCase):
    def test_every_accessible_facility_is_available_to_ordinary_walking_without_mutating_the_base(self):
        from backend.navigation.areas import service_areas
        for entry in service_areas().items:
            if not entry.resident_demo_supported:continue
            area=entry.id
            shared=shared_demo_walking_graph(area);accessible=demo_step_free_graph(area)
            ids={f['id'] for f in demo_area_dataset(area).dataset['accessibilityFacilities']}
            self.assertTrue(ids <= {edge.way_id for edge in shared.edges})
            ordinary_segments={(e.way_id,e.points) for e in shared.edges}
            self.assertTrue(all((e.way_id,e.points) in ordinary_segments for e in accessible.edges))
            from backend.navigation.demo_network import demo_walking_graph
            base=demo_walking_graph(area)
            self.assertTrue(ids.isdisjoint(e.way_id for e in base.edges))
            self.assertEqual(sum(e.kind=='steps' for e in shared.edges),sum(e.kind=='steps' for e in base.edges))

    def test_recorded_road_detour_still_beats_an_unmapped_short_gap(self):
        base=osm_graph({'a':(0,0),'b':(100,0),'c':(100,15),'d':(0,15)},[(['a','b','c','d'],{'highway':'footway'})])
        original_edges=list(base.edges);graph,data=prepared(base)
        route=graph.route(body(p(0,0),p(0,15)),demo_mode=True)
        self.assertAlmostEqual(route.distance_meters,215,places=2)
        self.assertEqual(base.edges,original_edges)
        self.assertTrue(all(distance(*e.points)<=20+1e-6 for e in graph.edges if e.kind=='open_access'))
        self.assertFalse(any(f['kind']=='step_free_path' for f in data['accessibilityFacilities']))

    def test_building_without_a_registered_step_free_entrance_keeps_ordinary_walking_access(self):
        nodes={'a':(-150,0),'b':(150,0),'w':(-20,30),'x':(20,30),'y':(20,70),'z':(-20,70)}
        base=osm_graph(nodes,[(['a','b'],{'highway':'footway'}),(['w','x','y','z','w'],{'building':'yes'})])
        graph,data=prepared(base)
        self.assertFalse(any(f['kind']=='accessible_entrance' for f in data['accessibilityFacilities']))
        self.assertTrue(graph.snap_candidates(p(0,50)))
        accessible=accessible_graph(base,data['accessibilityFacilities'],data)
        with self.assertRaises(NavigationRejected):accessible.snap_candidates(p(0,50))

    def test_unreachable_registered_ramp_does_not_disable_other_ordinary_building_access(self):
        nodes={'a':(-150,20),'b':(150,20),'c':(150,100),'d':(80,100),'e':(80,30),
            'w':(-20,30),'x':(20,30),'y':(20,70),'z':(-20,70),'m':(-30,50),'n':(30,50)}
        base=osm_graph(nodes,[(['a','b','c','d','e'],{'highway':'footway'}),
            (['w','x','y','z','w'],{'building':'yes'}),(['m','n'],{'barrier':'wall'})])
        graph,data=prepared(base)
        self.assertTrue(any(f['kind']=='accessible_entrance' for f in data['accessibilityFacilities']))
        origin,destination=p(0,60),p(80,80)
        self.assertTrue(base.snap_candidates(origin))
        route=graph.route(body(origin,destination),demo_mode=True)
        self.assertGreater(route.distance_meters,0)
        self.assertEqual(graph.snap_candidates(origin)[0][3],base.snap_candidates(origin)[0][3])
        accessible=accessible_graph(base,data['accessibilityFacilities'],data)
        with self.assertRaises(NavigationRejected):accessible.snap_candidates(origin)
        # Loading ordinary access does not mutate the shared graph's manifest.
        self.assertTrue(graph.demo_building_entrances)
        self.assertTrue(accessible.demo_building_entrances)

    def test_actual_catalog_buildings_keep_their_ordinary_access_when_registered_ramp_is_unreachable(self):
        import json
        from pathlib import Path
        data=json.loads((Path(__file__).resolve().parents[1]/'data/map_places.json').read_text(encoding='utf-8'))
        graph=shared_demo_walking_graph('kl-east-pilot')
        for name in ('Decathlon','Residensi Rabung KL Timur Tower B'):
            place=next(p for p in data if p['area_id']=='kl-east-pilot' and p['name']==name)
            point=(place['longitude'],place['latitude'])
            with self.subTest(place=name):
                self.assertTrue(graph.snap_candidates(point))
                with self.assertRaises(NavigationRejected):demo_step_free_graph('kl-east-pilot').snap_candidates(point)

    def fixture_routes(self):
        short=osm_graph({'a':(0,0),'b':(100,0)},[(['a','b'],{'highway':'footway'})]).route(body(p(0,0),p(100,0)),demo_mode=True)
        long=osm_graph({'a':(0,0),'b':(0,100),'c':(100,100),'d':(100,0)},[(['a','b','c','d'],{'highway':'footway'})]).route(body(p(0,0),p(100,0)),demo_mode=True)
        accessible=short.model_copy(update={'route_mode':'accessible','accessibility_status':'synthetic_network'})
        return long,accessible

    def test_a_valid_shorter_accessible_candidate_is_reused_as_complete_walking_geometry_not_a_clamped_number(self):
        long,accessible=self.fixture_routes()
        class Fixed:
            def __init__(self,route):self.result=route
            def route(self,*a,**kw):return deepcopy(self.result)
        with patch('backend.navigation.demo_accessibility.demo_step_free_graph',return_value=Fixed(accessible)):
            result=_options('fixture',{'accessibilityFacilities':[{'id':'registered'}]},Fixed(long),p(0,0),p(100,0),'walking')
        for item in result[:2]:
            self.assertEqual(item.route.geometry,accessible.geometry)
            self.assertEqual(item.route.maneuvers,accessible.maneuvers)
            self.assertAlmostEqual(item.route.distance_meters,100,places=2)
            self.assertEqual(item.route.accessibility_status,'not_requested')
            self.assertEqual(item.route.route_mode,item.mode)
            self.assertNotEqual(item.route.route_id,accessible.route_id)

    def test_candidate_reuse_revalidates_the_target_modes_damage_restrictions(self):
        long,accessible=self.fixture_routes()
        class Fixed:
            def __init__(self,route):self.result=route
            def route(self,*a,**kw):return deepcopy(self.result)
        data={'accessibilityFacilities':[{'id':'registered'}],
              'facilities':[{'id':'damage','coordinate':list(p(50,0)),'damaged':True,'reporters':2,'restrictionRadiusMeters':3}]}
        with patch('backend.navigation.demo_accessibility.demo_step_free_graph',return_value=Fixed(accessible)):
            result=_options('fixture',data,Fixed(long),p(0,0),p(100,0),'walking')
        self.assertAlmostEqual(result[0].route.distance_meters,100,places=2)
        self.assertAlmostEqual(result[1].route.distance_meters,300,places=2)

    def test_an_explicit_alternate_start_compares_all_modes_together(self):
        from backend.navigation.demo_routes import DemoRouteRequest,calculate_demo_routes
        long,accessible=self.fixture_routes()
        class Fixed:
            def __init__(self,route):self.result=route
            def route(self,request,**kwargs):
                if request.origin.longitude<p(0,0)[0]-1e-8:raise NavigationRejected(422,'No access at original start')
                return deepcopy(self.result)
        origin=dict(zip(('longitude','latitude'),p(-10,0)))
        chosen=dict(zip(('longitude','latitude'),p(0,0)))
        destination=dict(zip(('longitude','latitude'),p(100,0)))
        request=DemoRouteRequest(origin=origin,destination=destination,start_candidates=[chosen])
        with patch('backend.navigation.demo_accessibility.demo_step_free_graph',return_value=Fixed(accessible)),patch('backend.navigation.demo_accessibility.shared_demo_walking_graph',return_value=Fixed(long)):
            result=calculate_demo_routes('fixture',(101,2,102,4),request,{'accessibilityFacilities':[{'id':'registered'}]},Fixed(long))
        self.assertTrue(result.adjusted_start)
        self.assertEqual(result.selected_origin.model_dump(),chosen)
        self.assertEqual(len(result.options),3)
        for item in result.options:self.assertAlmostEqual(item.route.distance_meters,100,places=2)

    def test_shared_audit_rejects_missing_categories_and_one_distance_inversion(self):
        from backend.tools.audit_shared_demo_routes import acceptance
        from backend.tools.audit_demo_accessibility import FROZEN,CATEGORIES
        from backend.navigation.areas import service_areas
        reports={batch:{'summary':[dict(area=area.id,category=category,total=30,shortest=30,avoid_damage=30,accessible=30,ordering_failures=0)
            for area in service_areas().items if area.resident_demo_supported for category in CATEGORIES]} for batch in FROZEN}
        self.assertTrue(acceptance(reports)['passed'])
        reports['walking-primary']['summary'][0]['ordering_failures']=1
        self.assertFalse(acceptance(reports)['passed'])
        reports['walking-primary']['summary'][0]['ordering_failures']=0
        reports['walking-primary']['summary'].pop()
        self.assertFalse(acceptance(reports)['passed'])
