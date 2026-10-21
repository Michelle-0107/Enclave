"""General OSM identity/section coverage and actual-engine repair regressions."""
from dataclasses import replace
from types import SimpleNamespace
from uuid import UUID, uuid4
import unittest
from backend.navigation.road_bindings import road_reference_bindings, bound_road_section, distance_to_geometry
from backend.navigation.facility_segments import restriction_for
from backend.navigation.zones import route_intersects_zone
from backend.reports.road_sections import catalog
from backend.tests import test_what_if as fixtures
issue, body = fixtures.issue, fixtures.body

class RoadBindingTests(unittest.TestCase):
    def test_every_canonical_section_has_complete_geometry_coverage(self):
        points=catalog();self.assertGreater(len(points),2000)
        for point in points.values():
            with self.subTest(section=str(point.id)):
                item=SimpleNamespace(id=uuid4(),facility_id=point.id,facility_name=point.name,facility_type='path_surface',latitude=point.latitude,longitude=point.longitude)
                restriction=restriction_for(item)
                self.assertEqual(restriction['binding_source'],'mapped_road_section')
                self.assertEqual(restriction['affected_segment'].coordinates,point.road_section.geometry)
                boxes=[(ring[0][0],ring[0][1],ring[2][0],ring[2][1]) for ring in restriction['exclusion_rings']]
                for a,b in zip(point.road_section.geometry,point.road_section.geometry[1:]):
                    midpoint=((a[0]+b[0])/2,(a[1]+b[1])/2)
                    self.assertTrue(any(route_intersects_zone([midpoint,midpoint],box) for box in boxes))

    def test_all_road_references_use_same_way_geometry_and_reject_relocated_ids(self):
        bindings=road_reference_bindings();self.assertGreater(len(bindings),100)
        for ident,binding in bindings.items():
            section,source=bound_road_section(ident,binding['latitude'],binding['longitude'])
            self.assertEqual(source,'mapped_road_reference')
            expected=catalog()[UUID(binding['section_id'])].road_section
            self.assertEqual(section,expected)
            self.assertEqual(bound_road_section(ident,binding['latitude']+.001,binding['longitude']),(None,None))
        self.assertEqual(bound_road_section(uuid4(),3.225,101.73),(None,None))

    def test_curved_road_reference_centroids_are_classified_without_adding_access_edges(self):
        off_polyline=[(ident,row) for ident,row in road_reference_bindings().items()
            if distance_to_geometry((row['longitude'],row['latitude']),row['road_section']['geometry'])>20]
        self.assertTrue(off_polyline)
        for ident,row in off_polyline:
            section,source=bound_road_section(ident,row['latitude'],row['longitude'])
            self.assertEqual(source,'mapped_road_reference')
            self.assertEqual(section.geometry,catalog()[UUID(row['section_id'])].road_section.geometry)

    def test_stale_other_classification_fails_closed_instead_of_showing_fake_comparison(self):
        case=fixtures.WhatIfTests();case.setUp();self.addCleanup(case.doCleanups)
        ident,binding=next((ident,row) for ident,row in road_reference_bindings().items() if 3.2171<=row['latitude']<=3.2349 and 101.7211<=row['longitude']<=101.7409)
        case.issues=[issue(facility_id=str(ident),facility_type='other',affects_routes=False,latitude=binding['latitude'],longitude=binding['longitude'])]
        payload=body();payload['plans'][0]['repairs'][0]['facility_id']=str(ident)
        response=case.compare(case.client(),payload)
        self.assertEqual(response.status_code,409);self.assertIn('Road catalog update',response.text)
        self.assertFalse(case.engine_requests)

    def test_actual_road_engine_respects_damage_before_repair_across_different_roads(self):
        case=fixtures.WhatIfTests();case.setUp();self.addCleanup(case.doCleanups)
        client=case.client()
        client.app.state.navigation.provider.settings=replace(client.app.state.navigation.provider.settings,crossing_policy='mapped_facilities_only')
        checked=0
        # Deterministic selection across independent long residential ways; no road-name matching.
        for ident,binding in sorted(road_reference_bindings().items(),key=lambda item:str(item[0])):
            section=catalog()[UUID(binding['section_id'])]
            if section.road_section.highway!='residential':continue
            sections=sorted([p for p in catalog().values() if p.road_section.osm_way_id==section.road_section.osm_way_id],key=lambda p:p.road_section.section_index)
            if len(sections)<4 or section in (sections[0],sections[-1]):continue
            a,b=sections[0].road_section.geometry[0],sections[-1].road_section.geometry[-1]
            case.issues=[issue(facility_id=str(ident),latitude=binding['latitude'],longitude=binding['longitude'])]
            payload=body();payload['include_geometry']=True;payload['paths'][0].update(origin={'longitude':a[0],'latitude':a[1]},destination={'longitude':b[0],'latitude':b[1]})
            payload['plans'][0]['repairs'][0]['facility_id']=str(ident)
            response=case.compare(client,payload);self.assertEqual(response.status_code,200,response.text)
            data=response.json();before=data['baseline'][0]['current'];after=data['plans'][0]['paths'][0]['after']
            self.assertEqual(data['routing_restrictions'][0]['binding_source'],'mapped_road_reference')
            if before['state']=='available':
                coordinates=before['geometry']['coordinates']
                for ring in data['routing_restrictions'][0]['exclusion_rings']:
                    self.assertFalse(route_intersects_zone(coordinates,(ring[0][0],ring[0][1],ring[2][0],ring[2][1])))
                if after['state']=='available':self.assertLessEqual(after['distance_meters'],before['distance_meters']+1)
            checked+=1
            if checked==6:break
        self.assertEqual(checked,6)
        self.assertFalse(case.engine_requests,'The strict comparison must use the actual local road graph')

    def test_repair_cannot_invent_outdoor_access_but_nearby_building_access_can_route(self):
        case=fixtures.WhatIfTests();case.setUp();self.addCleanup(case.doCleanups)
        import json
        from pathlib import Path
        places={p['id']:p for p in json.loads((Path(__file__).resolve().parents[1]/'data/map_places.json').read_text(encoding='utf-8'))}
        ids=['ed7b553f-63c5-5b4f-98d9-292013005bf0','a061972e-2398-5cdc-91ed-7769edbb5dd2']
        case.issues=[issue(id=fixtures.I2 if i else fixtures.I1,facility_id=ident,facility_name=places[ident]['name'],latitude=places[ident]['latitude'],longitude=places[ident]['longitude']) for i,ident in enumerate(ids)]
        payload=body();payload['include_geometry']=True;payload['plans'][0]['repairs']=[{'facility_id':ids[0]}]
        payload['paths']=[dict(id='ground',name='Open ground without nearby walking access',origin={'longitude':101.723445,'latitude':3.2197639},destination={'longitude':101.7268212875,'latitude':3.2243746375}),
          dict(id='building',name='Nearby building access',origin={'longitude':101.723445,'latitude':3.2197639},destination={'longitude':101.72675135,'latitude':3.22405179})]
        client=case.client();client.app.state.navigation.provider.settings=replace(client.app.state.navigation.provider.settings,crossing_policy='mapped_facilities_only')
        response=case.compare(client,payload);self.assertEqual(response.status_code,200,response.text)
        data=response.json();failed=data['baseline'][0];after=data['plans'][0]['paths'][0]['after']
        self.assertEqual(failed['requested_destination'],payload['paths'][0]['destination'])
        self.assertEqual(failed['current']['reason'],'no_fixed_reference_endpoints');self.assertEqual(after['reason'],'no_fixed_reference_endpoints')
        self.assertIn('20 m',after['details']);self.assertIsNone(after['geometry'])
        self.assertEqual(data['baseline'][1]['current']['state'],'available')
        self.assertEqual(data['plans'][0]['paths'][1]['after']['state'],'available')
