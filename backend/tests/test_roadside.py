"""Behavioral walking tests: road sides, junctions, approaches and real snapshots."""
import asyncio
from collections import Counter
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

from backend.navigation.config import NavigationSettings
from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.areas import find_area, demo_area_dataset
from backend.navigation.demo_routes import DemoRouteRequest, calculate_demo_routes
from backend.navigation.provider import NavigationRejected
from backend.navigation.roadside import RoadsideGraph, walking_graph, coordinate, xy, distance
from backend.tests import test_navigation as fixtures

CENTER=(101.805,3.008)
def p(x,y):
    a,b=xy(CENTER)
    return coordinate((a+x,b+y))

def body(a,b,mode='shortest'):
    return WalkingRouteRequest(origin={'longitude':a[0],'latitude':a[1]},destination={'longitude':b[0],'latitude':b[1]},route_mode=mode)

def osm_graph(nodes,ways,node_tags=None,*,resident_access=False):
    root=ET.Element('osm',version='0.6')
    for key,point in nodes.items():
        lon,lat=p(*point)
        element=ET.SubElement(root,'node',id=key,lon=str(lon),lat=str(lat))
        for k,v in (node_tags or {}).get(key,{}).items(): ET.SubElement(element,'tag',k=k,v=v)
    for index,(refs,tags) in enumerate(ways):
        element=ET.SubElement(root,'way',id=str(index+1))
        for ref in refs: ET.SubElement(element,'nd',ref=ref)
        for k,v in tags.items(): ET.SubElement(element,'tag',k=k,v=v)
    with tempfile.TemporaryDirectory() as folder:
        source=Path(folder)/'fixture.osm'; ET.ElementTree(root).write(source)
        return RoadsideGraph(source,(101.795,2.999,101.815,3.018),resident_access=resident_access)

class RoadsideTests(unittest.TestCase):
    def straight(self,tags=None,marked=None):
        return osm_graph({'a':(-100,0),'m':(0,0),'b':(100,0)},[(['a','m','b'],{'highway':'residential',**(tags or {})})],{'m':marked or {}})

    def test_missing_sidewalk_uses_same_side_road_and_keeps_direct_interior_start(self):
        g=self.straight(); result=g.route(body(p(-80,6),p(-30,6)))
        self.assertAlmostEqual(result.distance_meters,50,places=3)
        self.assertTrue(result.road_fallback_used)
        self.assertEqual(result.crossing_policy,'mapped_facilities_only')
        self.assertFalse(result.field_verified)
        self.assertAlmostEqual(result.origin_snap_distance_meters,3,places=3)

    def test_ordinary_road_node_does_not_connect_opposite_sides(self):
        with self.assertRaises(NavigationRejected): self.straight().route(body(p(-80,6),p(80,-6)))

    def test_marked_crossing_allows_change_of_side_and_has_crossing_instruction(self):
        result=self.straight(marked={'highway':'crossing','crossing:markings':'zebra'}).route(body(p(-80,6),p(80,-6)))
        self.assertEqual(result.mapped_crossing_count,1)
        self.assertTrue(any('pedestrian crossing' in m.instruction for m in result.maneuvers))
        self.assertGreater(result.distance_meters,160)

    def test_crossing_marker_at_multi_road_junction_does_not_open_every_road(self):
        graph=osm_graph({'w':(-100,0),'e':(100,0),'s':(0,-100),'n':(0,100),'m':(0,0)},[
            (['w','m','e'],{'highway':'residential'}),(['s','m','n'],{'highway':'residential'})],
            {'m':{'highway':'crossing','crossing:markings':'zebra'}})
        with self.assertRaises(NavigationRejected): graph.route(body(p(0,-80),p(0,80)))

    def test_unmarked_vehicle_signal_and_bare_crossing_are_not_zebra_evidence(self):
        for tags in ({'highway':'crossing'},{'highway':'crossing','crossing':'unmarked'},{'highway':'traffic_signals'},{'crossing':'no','crossing:markings':'zebra'}):
            with self.subTest(tags=tags),self.assertRaises(NavigationRejected):
                self.straight(marked=tags).route(body(p(-80,6),p(80,-6)))

    def test_pedestrian_signals_qualify(self):
        result=self.straight(marked={'highway':'crossing','crossing:signals':'yes'}).route(body(p(-80,6),p(80,-6)))
        self.assertEqual(result.mapped_crossing_count,1)

    def test_vehicle_oneway_is_ignored_but_explicit_foot_direction_is_respected(self):
        result=self.straight({'oneway':'yes'}).route(body(p(80,6),p(-80,6)))
        self.assertAlmostEqual(result.distance_meters,160,places=2)
        with self.assertRaises(NavigationRejected): self.straight({'oneway:foot':'yes'}).route(body(p(80,6),p(-80,6)))

    def test_t_junction_cannot_be_used_to_cross_the_side_road(self):
        g=osm_graph({'a':(-100,0),'m':(0,0),'b':(100,0),'c':(0,100)},[(['a','m','b'],{'highway':'residential'}),(['m','c'],{'highway':'residential'})])
        with self.assertRaises(NavigationRejected): g.route(body(p(-80,6),p(80,6)))
        self.assertAlmostEqual(g.route(body(p(-80,-6),p(80,-6))).distance_meters,160,places=2)

    def test_separately_mapped_sidewalk_is_used_and_opposite_side_fallback_remains(self):
        g=osm_graph({'a':(-100,0),'b':(100,0),'c':(-100,8),'d':(100,8)},[(['a','b'],{'highway':'residential'}),(['c','d'],{'highway':'footway','footway':'sidewalk'})])
        self.assertFalse(g.route(body(p(-80,8),p(80,8))).road_fallback_used)
        self.assertTrue(g.route(body(p(-80,-5),p(80,-5))).road_fallback_used)

    def test_unmapped_same_grade_path_cannot_cut_a_road_even_without_shared_osm_node(self):
        g=osm_graph({'a':(-100,0),'b':(100,0),'c':(0,-100),'d':(0,100)},[(['a','b'],{'highway':'motorway'}),(['c','d'],{'highway':'footway'})])
        with self.assertRaises(NavigationRejected): g.route(body(p(0,-80),p(0,80)))

    def test_shared_unmarked_node_does_not_join_footpaths_across_nonwalkable_road(self):
        g=osm_graph({'a':(-100,0),'b':(100,0),'m':(0,0),'c':(0,-100),'d':(0,100)},[(['a','m','b'],{'highway':'primary','foot':'no'}),(['c','m','d'],{'highway':'footway'})])
        with self.assertRaises(NavigationRejected): g.route(body(p(0,-80),p(0,80)))

    def test_mapped_footbridge_and_its_ground_approaches_connect_across_road(self):
        g=osm_graph({'a':(-100,0),'b':(100,0),'c':(0,-100),'d':(0,100),'e':(0,-30),'f':(0,30)},[
            (['a','b'],{'highway':'primary'}),(['c','e'],{'highway':'footway'}),(['e','f'],{'highway':'footway','bridge':'yes','layer':'1'}),(['f','d'],{'highway':'footway'})])
        route=g.route(body(p(0,-80),p(0,80)))
        self.assertFalse(route.road_fallback_used)
        self.assertAlmostEqual(route.distance_meters,160,places=2)

    def test_no_snap_across_road_to_opposite_side_sidewalk(self):
        g=osm_graph({'a':(-100,0),'b':(100,0),'c':(-100,8),'d':(100,8)},[(['a','b'],{'highway':'primary','foot':'no'}),(['c','d'],{'highway':'footway'})])
        with self.assertRaises(NavigationRejected): g.route(body(p(-70,-5),p(70,8)))

    def test_private_motorroad_and_high_speed_roads_are_not_fallbacks(self):
        for tags in ({'foot':'no'},{'access':'private'},{'motorroad':'yes'},{'motorroad':'yes','maxspeed':'unknown'},{'maxspeed':'90'}):
            with self.subTest(tags=tags),self.assertRaises(NavigationRejected): self.straight(tags).route(body(p(-80,6),p(80,6)))

    def test_resident_access_opens_private_ways_and_identifies_unmarked_crossings(self):
        for tags in ({'access':'private'},{'foot':'private'},{'access':'private','foot':'private'}):
            with self.subTest(tags=tags):
                g=osm_graph({'a':(-100,0),'b':(100,0)},
                    [(['a','b'],{'highway':'residential',**tags})],resident_access=True)
                route=g.route(body(p(-80,6),p(80,6)))
                self.assertAlmostEqual(route.distance_meters,160,places=2)
                self.assertTrue(any('resident-access policy' in warning for warning in route.warnings))
                crossing_route=g.route(body(p(-80,6),p(80,-6)))
                self.assertEqual(crossing_route.crossing_policy,'resident_local_roads')
                self.assertEqual(crossing_route.mapped_crossing_count,0)
                self.assertEqual(crossing_route.unmarked_crossing_count,1)
                self.assertTrue(any('unmarked crossing' in step.instruction for step in crossing_route.maneuvers))
                self.assertFalse(crossing_route.field_verified)

    def test_private_local_crossings_do_not_apply_to_major_wide_fast_or_prohibited_roads(self):
        variants=({'highway':'secondary'},{'highway':'tertiary'},
                  {'maxspeed':'50'},{'maxspeed':'30 mph'},{'maxspeed':'walk'},
                  {'lanes':'4'},{'width':'10'},{'crossing':'no'},
                  {'bridge':'yes'},{'tunnel':'yes'})
        for tags in variants:
            with self.subTest(tags=tags):
                g=osm_graph({'a':(-100,0),'b':(100,0)},
                    [(['a','b'],{'highway':'residential','access':'private',**tags})],resident_access=True)
                self.assertFalse(any(e.kind=='unmarked_crossing' for e in g.edges))
                with self.assertRaises(NavigationRejected): g.route(body(p(-80,6),p(80,-6)))

    def test_explicit_no_crossing_at_node_still_blocks_private_crossing(self):
        g=osm_graph({'a':(-100,0),'b':(100,0)},
            [(['a','b'],{'highway':'residential','access':'private'})],
            {'a':{'crossing':'no'}},resident_access=True)
        with self.assertRaises(NavigationRejected): g.route(body(p(-80,6),p(80,-6)))

    def test_unmarked_local_crossing_obeys_damage_and_step_free_constraints(self):
        g=osm_graph({'a':(-100,0),'b':(100,0)},
            [(['a','b'],{'highway':'residential','access':'private'})],resident_access=True)
        for mode in ('shortest','avoid_damage'):
            self.assertEqual(g.route(body(p(-80,6),p(80,-6),mode)).unmarked_crossing_count,1)
        w,s=p(-110,-2);e,n=p(110,2)
        with self.assertRaises(NavigationRejected):
            g.route(body(p(-80,6),p(80,-6),'avoid_damage'),boxes=[(w,s,e,n)])
        with self.assertRaises(NavigationRejected):
            g.route(body(p(-80,6),p(80,-6),'accessible'),demo_mode=True)
        with self.assertRaises(NavigationRejected):
            g.validate_accessible_crossings([p(0,6),p(0,-6)])

    def test_straight_walking_can_cross_a_private_side_street_but_not_public_main_road(self):
        g=osm_graph({'w':(-100,0),'m':(0,0),'e':(100,0),'n':(0,100)},
            [(['w','m','e'],{'highway':'secondary'}),
             (['m','n'],{'highway':'residential','access':'private'})],resident_access=True)
        route=g.route(body(p(-80,6),p(80,6)))
        self.assertEqual(route.unmarked_crossing_count,1)
        self.assertLess(route.distance_meters,210)
        with self.assertRaises(NavigationRejected): g.route(body(p(-80,6),p(80,-6)))

    def test_both_sides_of_a_bend_remain_connected_without_crossing(self):
        g=osm_graph({'w':(-100,0),'m':(0,0),'n':(0,100)},
            [(['w','m','n'],{'highway':'residential'})])
        for a,b in ((p(-80,-6),p(6,80)),(p(-80,6),p(-6,80))):
            with self.subTest(origin=a):
                route=g.route(body(a,b))
                self.assertEqual(route.unmarked_crossing_count,0)
                self.assertEqual(route.mapped_crossing_count,0)
                self.assertLess(route.distance_meters,170)

    def test_inside_left_turn_has_no_right_turn_loop_at_offset_corner(self):
        g=osm_graph({'w':(-100,0),'m':(0,0),'n':(0,100),'s':(0,-100)},
            [(['s','m','n'],{'highway':'residential','access':'private'}),
             (['m','w'],{'highway':'residential','access':'private'})],resident_access=True)
        route=g.route(body(p(-6,-80),p(-80,-6)))
        self.assertAlmostEqual(route.distance_meters,154,places=2)
        turns=[step for step in route.maneuvers if step.type in (10,15)]
        self.assertEqual([step.type for step in turns],[15])
        points=list(map(xy,route.geometry.coordinates))
        self.assertTrue(all(b[0]<=a[0]+.01 and b[1]>=a[1]-.01 for a,b in zip(points,points[1:])))
        self.assertFalse(any('0 meters' in step.instruction or 'same-side road corner' in step.instruction for step in route.maneuvers))

    def test_outside_corner_has_one_turn_without_crossing_the_carriageway(self):
        g=osm_graph({'w':(-100,0),'m':(0,0),'n':(0,100)},
            [(['w','m','n'],{'highway':'residential'})])
        route=g.route(body(p(6,80),p(-80,-6)))
        self.assertAlmostEqual(route.distance_meters,166,places=2)
        self.assertEqual([step.type for step in route.maneuvers if step.type in (10,15)],[10])
        self.assertEqual(route.mapped_crossing_count,0)
        self.assertEqual(route.unmarked_crossing_count,0)

    def test_prima_saujana_same_side_and_opposite_side_real_routes(self):
        g=walking_graph('kajang-prima-saujana')
        same_side=g.route(body((101.804041,3.0026522),(101.803397,3.0048052)),area_id='kajang-prima-saujana')
        self.assertLess(same_side.distance_meters,260)
        self.assertEqual(same_side.unmarked_crossing_count,0)
        self.assertEqual(same_side.mapped_crossing_count,0)
        opposite=g.route(body((101.804041,3.0026522),(101.803487,3.0048052)),area_id='kajang-prima-saujana')
        self.assertGreater(opposite.unmarked_crossing_count,0)
        self.assertEqual(opposite.mapped_crossing_count,0)
        self.assertEqual(opposite.crossing_policy,'resident_local_roads')

    def test_resident_access_does_not_override_explicit_closures(self):
        for tags in ({'access':'private','foot':'no'},{'access':'no'},
                     {'foot':'private','access':'no'},{'access':'private','locked':'yes'},
                     {'access':'private','barrier':'fence'},{'access':'private','motorroad':'yes'},
                     {'access':'private','maxspeed':'90'}):
            with self.subTest(tags=tags):
                g=osm_graph({'a':(-100,0),'b':(100,0)},
                    [(['a','b'],{'highway':'residential',**tags})],resident_access=True)
                with self.assertRaises(NavigationRejected): g.route(body(p(-80,6),p(80,6)))

    def test_resident_gate_can_be_passed_but_locked_gate_cannot(self):
        for locked in ('no','yes'):
            g=osm_graph({'a':(-100,0),'m':(0,0),'b':(100,0)},
                [(['a','m','b'],{'highway':'residential','access':'private'})],
                {'m':{'barrier':'gate','access':'private','locked':locked}},resident_access=True)
            if locked=='yes':
                with self.assertRaises(NavigationRejected): g.route(body(p(-80,6),p(80,6)))
            else:
                self.assertAlmostEqual(g.route(body(p(-80,6),p(80,6))).distance_meters,160,places=2)

    def test_prima_saujana_private_streets_are_in_shared_resident_graph(self):
        g=walking_graph('kajang-prima-saujana')
        for way_id in ('494811513','494811517','494811519'):
            with self.subTest(way_id=way_id):
                edge=next(e for e in g.edges if e.way_id==way_id and distance(*e.points)>20)
                a,b=edge.points
                mix=lambda t:(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
                route=g.route(body(mix(.2),mix(.8)),area_id='kajang-prima-saujana')
                self.assertAlmostEqual(route.distance_meters,distance(a,b)*.6,places=2)
                self.assertTrue(any('resident-access policy' in warning for warning in route.warnings))

    def test_damage_blocks_the_crossing_instead_of_removing_crossing_rule(self):
        g=self.straight(marked={'crossing':'marked'})
        w,s=p(-2,-2); e,n=p(2,2)
        with self.assertRaises(NavigationRejected): g.route(body(p(-80,6),p(80,-6),'avoid_damage'),boxes=[(w,s,e,n)])

    def test_road_fallback_never_becomes_verified_accessible(self):
        with self.assertRaises(NavigationRejected): self.straight().route(body(p(-80,6),p(80,6),'accessible'))

    def test_surveyed_polyline_cannot_bypass_crossing_check_at_a_shared_vertex(self):
        with self.assertRaises(NavigationRejected): self.straight().validate_accessible_crossings([p(0,10),p(0,0),p(0,-10)])
        with self.assertRaises(NavigationRejected): self.straight().validate_accessible_crossings([p(-20,10),p(-20,0),p(20,0),p(20,-10)])

    def test_real_graphs_support_same_side_trips_with_same_policy(self):
        for area in ('kl-east-pilot','kajang-prima-saujana'):
            g=walking_graph(area)
            edge=next(e for e in g.edges if e.kind=='road_fallback' and distance(*e.points)>30 and e.direction==0)
            a,b=edge.points
            mix=lambda t:(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
            route=g.route(body(mix(.2),mix(.8)),area_id=area)
            self.assertEqual(route.area,area)
            self.assertEqual(route.crossing_policy,'mapped_facilities_only')
            self.assertLess(route.distance_meters,distance(a,b))
        self.assertGreater(Counter(e.kind for e in walking_graph('kl-east-pilot').edges)['crossing'],0)
        self.assertEqual(Counter(e.kind for e in walking_graph('kajang-prima-saujana').edges)['crossing'],0)


class DemoRouteCalculationTests(unittest.TestCase):
    def test_demo_profiles_are_calculated_on_the_server_osm_graph(self):
        area=find_area('kl-east-pilot'); graph=walking_graph(area.id); dataset=demo_area_dataset(area.id).dataset
        edge=next(e for e in graph.edges if e.kind=='road_fallback' and e.direction==0 and distance(*e.points)>30)
        a,b=edge.points; mix=lambda t:(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
        start,end=mix(.2),mix(.8)
        location=lambda point:{'longitude':point[0],'latitude':point[1]}
        request=DemoRouteRequest(origin=location(start),destination=location(end))
        result=calculate_demo_routes(area.id,area.bbox,request,dataset,graph)
        self.assertEqual([item.mode for item in result.options],['shortest','avoid_damage','accessible'])
        self.assertTrue(all(item.route is not None for item in result.options))
        route=result.options[-1].route
        self.assertEqual(route.routing_engine,'osm_roadside')
        self.assertEqual(route.accessibility_status,'synthetic_network')
        self.assertFalse(route.field_verified)
        wheelchair=calculate_demo_routes(area.id,area.bbox,
            DemoRouteRequest(origin=location(start),destination=location(end),profile='wheelchair'),dataset,graph)
        self.assertEqual([item.mode for item in wheelchair.options],['accessible'])
        self.assertTrue(any('Demo-only' in warning for warning in wheelchair.options[0].route.warnings))


class LiveAreaApiTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.NavigationTests(); self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.client=self.fixture.client(); self.client.app.state.navigation.provider.settings=NavigationSettings()
        self.headers={'Authorization':'Bearer fixture-resident'}

    def test_private_street_routes_still_require_active_verified_resident(self):
        g=walking_graph('kajang-prima-saujana')
        edge=next(e for e in g.edges if e.way_id=='494811519' and distance(*e.points)>20)
        a,b=edge.points
        mix=lambda t:(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
        payload=body(mix(.2),mix(.8)).model_dump()
        path='/api/v1/navigation/routes'
        self.assertEqual(self.client.post(path,json=payload).status_code,401)
        for rows in ([],[{'profile_id':fixtures.RESIDENT,'status':'inactive','verified_at':'2026-10-16T00:00:00Z'}],
                     [{'profile_id':fixtures.RESIDENT,'status':'active','verified_at':None}]):
            self.fixture.rows=rows
            self.assertEqual(self.client.post(path,json=payload,headers=self.headers).status_code,403)
        self.fixture.rows=[{'profile_id':fixtures.RESIDENT,'status':'active','verified_at':'2026-10-16T00:00:00Z'}]
        response=self.client.post(path,json=payload,headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['crossing_policy'],'mapped_facilities_only')
        demo_payload={'origin':payload['origin'],'destination':payload['destination']}
        demo_path='/api/v1/navigation/areas/kajang-prima-saujana/demo-routes'
        self.assertEqual(self.client.post(demo_path,json=demo_payload).status_code,401)
        self.fixture.rows=[]
        self.assertEqual(self.client.post(demo_path,json=demo_payload,headers=self.headers).status_code,403)
        self.fixture.rows=[{'profile_id':fixtures.RESIDENT,'status':'active','verified_at':'2026-10-16T00:00:00Z'}]
        demo=self.client.post(demo_path,json=demo_payload,headers=self.headers)
        self.assertEqual(demo.status_code,200,demo.text)
        self.assertIsNotNone(demo.json()['options'][0]['route'])

    def test_region_details_modes_and_crossing_policy(self):
        for area in ('kl-east-pilot','kajang-prima-saujana'):
            response=self.client.get('/api/v1/navigation/area',params={'area_id':area},headers=self.headers)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['id'],area)
            self.assertEqual(response.json()['crossing_policy'],'resident_local_roads')
        data=response.json()
        self.assertTrue(data['temporary_live']); self.assertFalse(data['community_issues_supported'])
        self.assertEqual(data['supported_route_modes'],['shortest'])
        self.assertEqual(self.client.get('/api/v1/navigation/area?area_id=unknown-area',headers=self.headers).status_code,404)
        self.assertEqual(self.client.get('/api/v1/navigation/area?area_id=kajang-prima-saujana').status_code,401)

    def test_live_and_demo_share_private_local_crossings_and_same_side_bend_fix(self):
        start=(101.804041,3.0026522)
        for end in ((101.803397,3.0048052),(101.803487,3.0048052)):
            payload=body(start,end).model_dump()
            live=self.client.post('/api/v1/navigation/routes',json=payload,headers=self.headers)
            self.assertEqual(live.status_code,200,live.text)
            data=live.json()
            demo=self.client.post('/api/v1/navigation/areas/kajang-prima-saujana/demo-routes',
                json={'origin':payload['origin'],'destination':payload['destination']},headers=self.headers)
            self.assertEqual(demo.status_code,200,demo.text)
            option=demo.json()['options'][0]['route']
            self.assertIsNotNone(option)
            self.assertEqual(data['geometry']['coordinates'][0],option['geometry']['coordinates'][0])
            self.assertEqual(data['geometry']['coordinates'][-1],option['geometry']['coordinates'][-1])
            self.assertEqual(data['simulated_crossing_count'],0)
            if not option['simulated_crossing_count']:
                self.assertEqual(data['unmarked_crossing_count'],option['unmarked_crossing_count'])
            self.assertEqual(data['mapped_crossing_count'],0)
            self.assertFalse(data['field_verified'])
            if end[0]<101.8034422:
                self.assertEqual(data['unmarked_crossing_count'],0)
                self.assertLess(data['distance_meters'],260)
            else:
                self.assertGreater(data['unmarked_crossing_count'],0)
                self.assertEqual(data['crossing_policy'],'resident_local_roads')

    def test_resident_route_uses_shared_policy_without_contacting_car_engine(self):
        for area in ('kl-east-pilot','kajang-prima-saujana'):
            g=walking_graph(area)
            edge=next(e for e in g.edges if e.kind=='road_fallback' and distance(*e.points)>30 and e.direction==0)
            a,b=edge.points
            mix=lambda t:(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
            response=self.fixture.request(self.client,body(mix(.2),mix(.8)).model_dump())
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['area'],area)
            self.assertEqual(response.json()['routing_engine'],'osm_roadside')
            self.assertEqual(response.json()['crossing_policy'],'mapped_facilities_only')
        self.assertEqual(self.fixture.requests,[])

    def test_resident_demo_routes_use_server_osm_graph_and_synthetic_access_profile(self):
        area='kl-east-pilot'; graph=walking_graph(area)
        edge=next(e for e in graph.edges if e.kind=='road_fallback' and e.direction==0 and distance(*e.points)>30)
        a,b=edge.points; mix=lambda t:(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
        start,end=mix(.2),mix(.8)
        location=lambda point:{'longitude':point[0],'latitude':point[1]}
        payload={'origin':location(start),'destination':location(end),'profile':'walking','start_candidates':[]}
        response=self.client.post(f'/api/v1/navigation/areas/{area}/demo-routes',json=payload,headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        result=response.json(); self.assertEqual(result['area_id'],area); self.assertFalse(result['adjusted_start'])
        self.assertEqual([item['mode'] for item in result['options']],['shortest','avoid_damage','accessible'])
        route=result['options'][0]['route']; self.assertEqual(route['routing_engine'],'osm_roadside')
        self.assertEqual(route['crossing_policy'],'mapped_facilities_only')
        self.assertFalse(route['field_verified']); self.assertEqual(route['data_source'],'openstreetmap_unverified')
        self.assertTrue(any('Demo-only' in warning for warning in route['warnings']))
        payload['profile']='wheelchair'
        wheelchair=self.client.post(f'/api/v1/navigation/areas/{area}/demo-routes',json=payload,headers=self.headers)
        self.assertEqual(wheelchair.status_code,200,wheelchair.text)
        option=wheelchair.json()['options'][0]; self.assertEqual(option['mode'],'accessible')
        if option['route'] is not None:
            self.assertEqual(option['route']['accessibility_status'],'synthetic_network')
            self.assertFalse(option['route']['field_verified'])
        self.assertEqual(self.client.post(f'/api/v1/navigation/areas/{area}/demo-routes',json=payload).status_code,401)

    def test_inter_region_route_and_unsupported_new_region_modes_are_rejected(self):
        response=self.fixture.request(self.client,body((101.730,3.225),(101.805,3.008)).model_dump())
        self.assertEqual(response.status_code,422)
        for mode in ('accessible','avoid_damage'):
            response=self.fixture.request(self.client,body((101.804,3.008),(101.805,3.009),mode).model_dump())
            self.assertEqual(response.status_code,422)
        self.assertEqual(self.fixture.requests,[])

    def test_real_source_what_if_repairs_reopen_same_fixed_endpoints_under_crossing_policy(self):
        from backend.tests import test_what_if as what_if
        fixture=what_if.WhatIfTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        g=walking_graph('kl-east-pilot')
        edge=next(e for e in g.edges if e.kind=='road_fallback' and e.direction==0 and distance(*e.points)>80)
        a,b=edge.points; mix=lambda t:(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
        middle=mix(.5)
        fixture.issues=[what_if.issue(longitude=middle[0],latitude=middle[1])]
        client=fixture.client(); client.app.state.navigation.provider.settings=NavigationSettings()
        request=what_if.body(); request['paths'][0]['origin']=body(mix(.1),mix(.9)).origin.model_dump()
        request['paths'][0]['destination']=body(mix(.1),mix(.9)).destination.model_dump()
        response=client.post('/api/v1/management/what-if/compare',json=request,headers={'Authorization':'Bearer manager-fixture'})
        self.assertEqual(response.status_code,200,response.text)
        result=response.json(); after=result['plans'][0]['paths'][0]
        self.assertIn(after['effect'],('shortened','restored'))
        self.assertTrue(after['reference_intersects_selected_repairs'])
        self.assertEqual(after['after']['state'],'available')
        self.assertEqual(fixture.engine_requests,[])
