import asyncio
import json
import unittest
from uuid import UUID
import httpx
from backend.core.config import Settings
from backend.navigation.areas import find_area
from backend.navigation.locations import LocationsRepository,LocationsUnavailable
from backend.reports.models import ReportResponse

class SharedLocationRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_private_batch_names_keep_original_coordinates_and_one_call(self):
        calls=[]
        def handler(request):
            calls.append(json.loads(request.content))
            return httpx.Response(200,json={'state':'ok','items':[{'location_id':'10000000-0000-4000-8000-000000000001','location_name':'Near Jalan Melati (8 m)','location_address':''}]})
        repo=LocationsRepository(Settings('https://fixture.supabase.co','sb_secret_fixture'),transport=httpx.MockTransport(handler))
        record=ReportResponse(ticket_id='PRIVATE',user_id=UUID(int=1),description='fixture',latitude=3.226,longitude=101.73,status='pending')
        try:
            result=(await repo.labels([record]))[0]
            self.assertEqual(result.latitude,record.latitude);self.assertEqual(result.longitude,record.longitude)
            self.assertEqual(result.location_name,'Near Jalan Melati (8 m)');self.assertEqual(result.location_storage,'database')
            self.assertEqual(len(calls),1);self.assertEqual(calls[0]['p_action'],'labels')
        finally:await repo.close()

    async def test_missing_registry_does_not_hide_existing_report_or_claim_database(self):
        repo=LocationsRepository(Settings('https://fixture.supabase.co','sb_secret_fixture'),transport=httpx.MockTransport(lambda request:httpx.Response(404,json={'code':'PGRST202'})))
        record=ReportResponse(ticket_id='PRIVATE',user_id=UUID(int=1),description='fixture',latitude=3.226,longitude=101.73,status='pending')
        try:
            self.assertEqual((await repo.labels([record]))[0].location_storage,'unavailable')
            with self.assertRaises(LocationsUnavailable):await repo.listing('search',UUID(int=1),find_area('kl-east-pilot'),query='Mall')
        finally:await repo.close()

    async def test_never_accept_wrong_area_or_nonfinite_database_coordinates(self):
        for lat,area in [(0,'wrong-area'),(float('nan'),'kl-east-pilot')]:
            row=dict(id=str(UUID(int=1)),area_id=area,name='Fixture',latitude=lat,longitude=101.73,kind='place',source='openstreetmap',position_basis='fixture')
            repo=LocationsRepository(Settings('https://fixture.supabase.co','sb_secret_fixture'),transport=httpx.MockTransport(lambda request:httpx.Response(200,content=json.dumps({'state':'ok','items':[row]}))))
            try:
                with self.assertRaises(LocationsUnavailable):await repo.listing('search',UUID(int=1),find_area('kl-east-pilot'),query='Mall')
            finally:await repo.close()
