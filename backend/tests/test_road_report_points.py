"""Road-section geometry, stable grouping IDs and read-only authenticated catalog."""
import hashlib,json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.navigation.service import distance_meters
from backend.reports.road_sections import catalog,split_line,midpoint,generate,nearby,CATALOG
from backend.reports.community_demo import create_community_demo_app,CommunityDemoState
from fastapi.testclient import TestClient
import httpx

class RoadReportPointTests(unittest.TestCase):
    def test_full_catalog_is_bounded_stable_and_not_an_accessibility_claim(self):
        points=list(catalog().values());self.assertGreater(len(points),1000)
        self.assertEqual({p.road_section.area_id for p in points},{'kl-east-pilot'})
        self.assertEqual(len({p.id for p in points}),len(points))
        for point in points:
            section=point.road_section
            self.assertLessEqual(section.length_meters,100.01)
            self.assertFalse(section.field_verified)
            self.assertLess(distance_meters((point.longitude,point.latitude),midpoint(section.geometry)),.02)
        self.assertEqual(nearby(0,0),[])

    def test_slicing_measures_along_bent_geometry_and_keeps_the_final_short_section(self):
        points=[(101.73,3.225),(101.7309,3.225),(101.7309,3.2262)]
        sections=list(split_line(points));self.assertGreaterEqual(len(sections),3)
        self.assertAlmostEqual(sum(distance_meters(a,b) for a,b in zip(points,points[1:])),
            sum(sum(distance_meters(a,b) for a,b in zip(s,s[1:])) for s in sections),places=4)
        for left,right in zip(sections,sections[1:]):self.assertEqual(left[-1],right[0])
        for section in sections[:-1]:self.assertAlmostEqual(sum(distance_meters(a,b) for a,b in zip(section,section[1:])),100,places=3)

    def test_generator_splits_at_junctions_and_does_not_join_nearby_roads(self):
        source="""<osm><node id="1" lat="3.225" lon="101.73"/><node id="2" lat="3.225" lon="101.731"/>
          <node id="3" lat="3.225" lon="101.732"/><node id="4" lat="3.226" lon="101.731"/>
          <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Test road"/></way>
          <way id="20"><nd ref="2"/><nd ref="4"/><tag k="highway" v="residential"/><tag k="name" v="Test road"/></way></osm>"""
        with TemporaryDirectory() as folder:
            path=Path(folder)/'test.osm';path.write_text(source)
            area=SimpleNamespace(id='kl-east-pilot',bbox=(101.721,3.217,101.741,3.235))
            first=generate(area,path,'2026-10-15T00:00:00Z');second=generate(area,path,'2026-10-15T00:00:00Z')
            self.assertEqual([p.model_dump() for p in first],[p.model_dump() for p in second])
            self.assertEqual(len({p.id for p in first}),len(first))
            for point in first:
                if point.road_section.osm_way_id=='10':
                    coordinates=point.road_section.geometry
                    self.assertFalse(min(p[0] for p in coordinates)<101.731<max(p[0] for p in coordinates))
            self.assertEqual({p.road_section.osm_way_id for p in first},{'10','20'})

    def test_nearby_endpoint_is_authenticated_read_only_and_paginated(self):
        state=CommunityDemoState();point=next(iter(catalog().values()))
        with TestClient(create_community_demo_app(state=state)) as client:
            path=f'/api/v1/facilities/road-sections?latitude={point.latitude}&longitude={point.longitude}&limit=1'
            self.assertEqual(client.get(path).status_code,401)
            response=client.get(path,headers={'Authorization':'Bearer demo-resident-token'})
            self.assertEqual(response.status_code,200,response.text)
            data=response.json();self.assertEqual(len(data['items']),1)
            self.assertEqual(data['items'][0]['id'],str(point.id))
            self.assertIn('road_section',data['items'][0]);self.assertEqual(state.calls,[])
            self.assertEqual(response.headers['cache-control'],'private, no-store')
            self.assertNotIn('created_by',response.text)
            self.assertEqual(client.get('/api/v1/facilities/road-sections?latitude=NaN&longitude=101.73',headers={'Authorization':'Bearer demo-resident-token'}).status_code,422)

    def test_backend_supplies_catalog_point_and_rejects_client_metadata(self):
        from backend.reports.issues import CommunityIssues,OpenIssue
        from backend.core.config import Settings
        import asyncio
        point=next(iter(catalog().values()));calls=[]
        def rpc(request):
            data=json.loads(request.content);calls.append(data)
            return httpx.Response(200,json={'state':'ok','road_reporting_version':1,'deduplicated':False,'issue':{
                'id':'20000000-0000-4000-8000-000000000001','facility_id':str(point.id),
                'facility_name':point.name,'facility_type':'path_surface','latitude':point.latitude,'longitude':point.longitude,
                'fault_kind':'damage','status':'open','reporter_count':1,'affects_routes':True,'created_at':'2026-10-20T00:00:00Z','resolved_at':None}})
        async def run():
            service=CommunityIssues(Settings('https://exampleproject.supabase.co','sb_secret_fixture'),transport=httpx.MockTransport(rpc))
            try:return await service.link('00000000-0000-4000-8000-000000000001',OpenIssue(facility_id=point.id,report_ticket_id='OWNED-REPORT'))
            finally:await service.close()
        result=asyncio.run(run());self.assertFalse(result.community_visible)
        self.assertEqual(calls[0]['p_action'],'open_road_issue')
        self.assertEqual(calls[0]['p_args']['road_point']['id'],str(point.id))
        self.assertEqual(calls[0]['p_args']['road_point']['latitude'],point.latitude)
        with self.assertRaises(ValueError):OpenIssue.model_validate({'facility_id':str(point.id),'report_ticket_id':'X','road_point':{'latitude':0}})

    def test_catalog_regeneration_is_byte_for_byte_reproducible(self):
        from backend.tools.build_road_report_points import main
        before=CATALOG.read_bytes();main();self.assertEqual(CATALOG.read_bytes(),before)

    def test_residents_cannot_preempt_a_catalog_point_with_a_duplicate_custom_facility(self):
        state=CommunityDemoState();point=next(iter(catalog().values()))
        with TestClient(create_community_demo_app(state=state)) as client:
            response=client.post('/api/v1/facilities',headers={'Authorization':'Bearer demo-resident-token'},json={
                'name':point.name,'facility_type':point.facility_type,'latitude':point.latitude,'longitude':point.longitude})
            self.assertEqual(response.status_code,409,response.text)
            self.assertEqual(state.calls,[])

    def test_old_database_without_019_returns_setup_error_instead_of_false_location_error(self):
        from backend.reports.issues import CommunityIssues,OpenIssue,IssueRejected
        from backend.core.config import Settings
        import asyncio
        point=next(iter(catalog().values()))
        async def run():
            service=CommunityIssues(Settings('https://exampleproject.supabase.co','sb_secret_fixture'),
                transport=httpx.MockTransport(lambda request:httpx.Response(200,json={'state':'invalid'})))
            try:
                with self.assertRaises(IssueRejected) as failure:
                    await service.link('00000000-0000-4000-8000-000000000001',OpenIssue(facility_id=point.id,report_ticket_id='OWNED-REPORT'))
                self.assertEqual(failure.exception.status,503)
            finally:await service.close()
        asyncio.run(run())
