"""Walking access across open land and from building endpoints, in all areas."""
import unittest
import xml.etree.ElementTree as ET

from backend.navigation.areas import demo_area_dataset, find_area
from backend.navigation.demo_routes import DemoRouteRequest, calculate_demo_routes
from backend.navigation.provider import NavigationRejected
from backend.navigation.roadside import distance, walking_graph
from backend.tests.test_roadside import body, osm_graph, p


class OpenLandAccessTests(unittest.TestCase):
    def gap(self, obstacle=None, gate=None):
        nodes={'a':(-80,0),'b':(0,0),'c':(30,0),'d':(110,0)}
        ways=[(['a','b'],{'highway':'footway'}),(['c','d'],{'highway':'footway'})]
        node_tags={}
        if obstacle in {'building','water','restricted'}:
            nodes.update({'w':(10,-80),'x':(20,-80),'y':(20,80),'z':(10,80)})
            tag={'building':'yes'} if obstacle=='building' else {'natural':'water'} if obstacle=='water' else {'access':'no'}
            ways.append((['w','x','y','z','w'],tag))
        elif obstacle in {'fence','wall','stream','major_road'}:
            nodes.update({'w':(15,-80),'x':(15,80),'g':(15,0)})
            tag={'highway':'primary','foot':'no'} if obstacle=='major_road' else {'waterway':'stream'} if obstacle=='stream' else {'barrier':obstacle}
            ways.append((['w','g','x'],tag))
            if gate: node_tags['g']={'barrier':'gate','locked':gate}
        return osm_graph(nodes,ways,node_tags,resident_access=True)

    def test_disconnected_paths_join_across_open_land_and_show_the_link(self):
        graph=self.gap()
        route=graph.route(body(p(-60,0),p(90,0)))
        self.assertAlmostEqual(route.distance_meters,150,places=2)
        self.assertTrue(any('open area' in step.instruction for step in route.maneuvers))
        self.assertTrue(any('inferred outdoor' in warning for warning in route.warnings))
        self.assertFalse(route.field_verified)
        self.assertEqual(route.mapped_crossing_count,0)
        # Reversing the request must not impose a vehicle direction on the link.
        self.assertAlmostEqual(graph.route(body(p(90,0),p(-60,0))).distance_meters,150,places=2)

    def test_open_land_cannot_cut_buildings_water_fences_or_main_roads(self):
        for obstacle in ('building','water','restricted','fence','wall','stream','major_road'):
            with self.subTest(obstacle=obstacle),self.assertRaises(NavigationRejected):
                self.gap(obstacle).route(body(p(-60,0),p(90,0)))

    def test_unlocked_mapped_gate_permits_access_but_locked_gate_does_not(self):
        self.assertAlmostEqual(self.gap('fence','no').route(body(p(-60,0),p(90,0))).distance_meters,150,places=2)
        with self.assertRaises(NavigationRejected):
            self.gap('fence','yes').route(body(p(-60,0),p(90,0)))

    def test_projected_link_can_join_the_middle_of_a_long_path(self):
        graph=osm_graph({'a':(-80,0),'b':(0,0),'c':(30,-150),'d':(30,150)},
                        [(['a','b'],{'highway':'footway'}),(['c','d'],{'highway':'footway'})])
        route=graph.route(body(p(-60,0),p(30,100)))
        self.assertAlmostEqual(route.distance_meters,190,places=2)

    def test_open_approach_is_drawn_and_counted_and_cannot_skip_damage(self):
        graph=osm_graph({'a':(-150,0),'b':(150,0)},[(['a','b'],{'highway':'footway'})])
        route=graph.route(body(p(-80,35),p(80,35)))
        self.assertLess(distance(route.geometry.coordinates[0],p(-80,35)),.01)
        self.assertLess(distance(route.geometry.coordinates[-1],p(80,35)),.01)
        self.assertAlmostEqual(route.distance_meters,230,places=2)
        self.assertEqual(route.origin_snap_distance_meters,0)
        west,south=p(-85,10);east,north=p(-75,25)
        with self.assertRaises(NavigationRejected):
            graph.route(body(p(-80,35),p(80,35),'avoid_damage'),boxes=[(west,south,east,north)])

    def test_damage_blocks_an_inferred_gap_without_moving_access_points(self):
        graph=self.gap();west,south=p(10,-5);east,north=p(20,5)
        with self.assertRaises(NavigationRejected):
            graph.route(body(p(-60,0),p(90,0),'avoid_damage'),boxes=[(west,south,east,north)])
        with self.assertRaises(NavigationRejected):
            graph.route(body(p(-60,0),p(90,0),'accessible'),demo_mode=True)

    def test_building_endpoints_associate_to_outdoor_access_in_both_directions(self):
        graph=osm_graph({'a':(150,-150),'b':(150,150),
                         'w':(-40,-40),'x':(40,-40),'y':(40,40),'z':(-40,40)},
                        [(['a','b'],{'highway':'footway'}),(['w','x','y','z','w'],{'building':'yes'})])
        for origin,end in ((p(0,0),p(150,100)),(p(150,100),p(0,0))):
            with self.subTest(origin=origin):
                route=graph.route(body(origin,end))
                self.assertAlmostEqual(route.distance_meters,100,places=2)
                self.assertAlmostEqual(max(route.origin_snap_distance_meters,route.destination_snap_distance_meters),150,places=2)
                self.assertTrue(any('Building endpoint access is assumed' in warning for warning in route.warnings))
        with self.assertRaises(NavigationRejected):
            graph.route(body(p(0,0),p(150,100),'accessible'),demo_mode=True)

    def test_building_exit_cannot_pass_through_a_different_building(self):
        graph=osm_graph({'a':(100,-50),'b':(100,50),
                         'w':(-10,-10),'x':(10,-10),'y':(10,10),'z':(-10,10),
                         'i':(40,-200),'j':(60,-200),'k':(60,200),'l':(40,200)},
                        [(['a','b'],{'highway':'footway'}),(['w','x','y','z','w'],{'building':'yes'}),
                         (['i','j','k','l','i'],{'building':'yes'})])
        with self.assertRaises(NavigationRejected): graph.route(body(p(0,0),p(100,40)))

    def test_outdoor_point_cannot_snap_onto_an_elevated_bridge(self):
        graph=osm_graph({'a':(-100,0),'b':(100,0)},
                        [(['a','b'],{'highway':'footway','bridge':'yes','layer':'1'})])
        with self.assertRaises(NavigationRejected): graph.route(body(p(-80,10),p(80,10)))

    def test_multipolygon_courtyard_remains_open_while_its_building_is_solid(self):
        from backend.navigation.land_access import LandAccess
        root=ET.Element('osm')
        points={str(i):p(*coord) for i,coord in enumerate(
            [(-80,-80),(80,-80),(80,80),(-80,80),(-40,-40),(40,-40),(40,40),(-40,40)])}
        ways=[('outer',['0','1','2','3','0'],{}),('inner',['4','5','6','7','4'],{})]
        relation=ET.SubElement(root,'relation',id='building')
        for ref,role in (('outer','outer'),('inner','inner')):
            ET.SubElement(relation,'member',type='way',ref=ref,role=role)
        ET.SubElement(relation,'tag',k='type',v='multipolygon')
        ET.SubElement(relation,'tag',k='building',v='yes')
        land=LandAccess(root,points,{key:{} for key in points},ways)
        self.assertEqual(land.buildings_at(p(0,0)),frozenset())
        self.assertTrue(land.clear(p(-20,0),p(20,0)))
        self.assertFalse(land.clear(p(-100,0),p(100,0)))


class RealMallAccessTests(unittest.TestCase):
    def test_live_and_demo_api_use_the_same_mall_access(self):
        from backend.navigation.config import NavigationSettings
        from backend.tests.test_navigation import NavigationTests
        fixture=NavigationTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        client=fixture.client(); client.app.state.navigation.provider.settings=NavigationSettings()
        dataset=demo_area_dataset('kl-east-pilot').dataset
        start=next(poi['coordinate'] for poi in dataset['landmarks'] if poi['id']=='osm-node-9555390382')
        end=next(item['coordinate'] for item in dataset['facilities'] if item['id']=='demo-crossing-1252137889-12')
        payload=body(start,end).model_dump()
        headers={'Authorization':'Bearer fixture-resident'}
        live=client.post('/api/v1/navigation/routes',json=payload,headers=headers)
        demo=client.post('/api/v1/navigation/areas/kl-east-pilot/demo-routes',
                         json={'origin':payload['origin'],'destination':payload['destination']},headers=headers)
        self.assertEqual(live.status_code,200,live.text)
        self.assertEqual(demo.status_code,200,demo.text)
        demo_route=demo.json()['options'][0]['route']
        self.assertIsNotNone(demo_route)
        self.assertEqual(live.json()['simulated_crossing_count'],0)
        self.assertFalse(any(identifier.startswith('simulated-') for identifier in live.json()['demo_facility_ids']))
        self.assertEqual(live.json()['geometry']['coordinates'][-1],demo_route['geometry']['coordinates'][-1])
        self.assertTrue(any('inferred outdoor' in warning for warning in live.json()['warnings']))
        self.assertEqual(fixture.requests,[])

    def test_actual_mall_points_reach_the_previously_mislabelled_footpath(self):
        dataset=demo_area_dataset('kl-east-pilot').dataset
        graph=walking_graph('kl-east-pilot')
        end=next(item['coordinate'] for item in dataset['facilities'] if item['id']=='demo-crossing-1252137889-12')
        mall=[item for item in dataset['landmarks'] if item['name']=='KL East Mall']
        self.assertEqual(len(mall),3)
        area=find_area('kl-east-pilot')
        for place in mall:
            with self.subTest(place=place['id']):
                request=DemoRouteRequest(origin={'longitude':place['coordinate'][0],'latitude':place['coordinate'][1]},
                                         destination={'longitude':end[0],'latitude':end[1]})
                response=calculate_demo_routes(area.id,area.bbox,request,dataset,graph)
                route=response.options[0].route
                self.assertIsNotNone(route)
                self.assertLess(route.distance_meters,500)
                self.assertLess(distance(route.geometry.coordinates[-1],end),.1)
                self.assertFalse(route.field_verified)
                for a,b in zip(route.geometry.coordinates,route.geometry.coordinates[1:]):
                    if any('open area' in step.instruction and step.coordinate==a for step in route.maneuvers):
                        self.assertTrue(graph.access_clear(a,b))
