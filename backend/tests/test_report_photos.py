"""Private evidence links are signed only after report authorization."""
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import httpx
from fastapi.testclient import TestClient

from backend.app import create_app, active_resident, current_user, AuthenticatedUser
from backend.core.config import Settings
from backend.reports.media import MediaServices, MediaUnavailable

VALUES = {'S3_BUCKET_NAME': 'synthetic-bucket', 'AWS_REGION': 'us-east-1',
          'AWS_ACCESS_KEY': 'synthetic-id', 'AWS_SECRET_ACCESS_KEY': 'synthetic-secret'}
SETTINGS = Settings('https://exampleproject.supabase.co', 'sb_secret_fixture', VALUES)
PHOTO = 'https://synthetic-bucket.s3.amazonaws.com/report_example.png'
OWNER = UUID('00000000-0000-4000-8000-000000000001')
ROW = dict(ticket_id='TEST-1', user_id=str(OWNER), description='Synthetic fixture',
           latitude=3.2, longitude=101.7, image_url=PHOTO, status='pending', is_approved=False)


class ReportPhotoTests(unittest.TestCase):
    def test_real_sigv4_signing_is_local_and_one_hour(self):
        url = MediaServices(SETTINGS).signed_image_url(PHOTO)
        parts = urlsplit(url)
        query = parse_qs(parts.query)
        self.assertEqual(parts.path, '/report_example.png')
        self.assertEqual(query['X-Amz-Expires'], ['3600'])
        self.assertEqual(query['X-Amz-Algorithm'], ['AWS4-HMAC-SHA256'])
        self.assertIn('X-Amz-Signature', query)
        self.assertNotIn(VALUES['AWS_SECRET_ACCESS_KEY'], url)

    def test_exact_bucket_only_and_no_arbitrary_signing(self):
        media = MediaServices(SETTINGS)
        with patch.object(media, '_client') as client:
            for url in (None, '', 'https://other-bucket.s3.amazonaws.com/private.png',
                        'https://synthetic-bucket.s3.amazonaws.com.evil.test/x',
                        'https://user@synthetic-bucket.s3.amazonaws.com/x',
                        'http://synthetic-bucket.s3.amazonaws.com/x',
                        PHOTO + '#fragment', 'https://synthetic-bucket.s3.amazonaws.com:444/x'):
                with self.subTest(url=url):
                    self.assertEqual(media.signed_image_url(url), url)
            client.assert_not_called()

    def test_regional_url_decodes_key_and_refreshes_old_signature(self):
        media = MediaServices(SETTINGS)
        client = MagicMock()
        client.generate_presigned_url.return_value = 'https://synthetic/fresh'
        with patch.object(media, '_client', return_value=client):
            result = media.signed_image_url('https://synthetic-bucket.s3.us-east-1.amazonaws.com/folder/photo%20one.png?X-Amz-Signature=old')
        self.assertEqual(result, 'https://synthetic/fresh')
        client.generate_presigned_url.assert_called_once_with('get_object',
            Params={'Bucket': 'synthetic-bucket', 'Key': 'folder/photo one.png'}, ExpiresIn=3600, HttpMethod='GET')
        client.put_object.assert_not_called()

    def test_signing_errors_are_redacted(self):
        media = MediaServices(SETTINGS)
        with patch.object(media, '_client', side_effect=RuntimeError('synthetic-secret')):
            with self.assertRaises(MediaUnavailable) as caught:
                media.signed_image_url(PHOTO)
        self.assertNotIn('synthetic-secret', str(caught.exception))

    def client(self, *, denied=False, foreign_owner=False):
        requests = []
        def report(request):
            requests.append('owner-query')
            row = dict(ROW)
            if foreign_owner:
                row['user_id'] = '00000000-0000-4000-8000-000000000002'
            return httpx.Response(403 if denied else 200, json=[] if denied else [row])
        def workflow(request):
            requests.append('management-query')
            return httpx.Response(200, json={'state': 'forbidden'} if denied else
                                  {'state': 'ok', 'items': [ROW], 'has_more': False})
        app = create_app(SETTINGS, locations_transport=httpx.MockTransport(lambda request: httpx.Response(404,json={'code':'PGRST202'})), reports_transport=httpx.MockTransport(report),
                         workflow_transport=httpx.MockTransport(workflow))
        actor = AuthenticatedUser(OWNER, 'fixture@example.test', 'fixture-token')
        app.dependency_overrides[current_user] = lambda: actor
        app.dependency_overrides[active_resident] = lambda: actor
        client = TestClient(app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client, requests

    def test_authorized_owner_detail_list_and_management_get_fresh_links(self):
        client, requests = self.client()
        def sign(url):
            self.assertTrue(requests)
            self.assertEqual(url, PHOTO)
            return PHOTO + '?synthetic-signature=fresh'
        with patch.object(client.app.state.report_photo_links, 'signed_image_url', side_effect=sign):
            for path in ('/api/v1/reports', '/api/v1/reports/TEST-1', '/api/v1/management/reports'):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, response.text)
                body = response.json()
                record = body['items'][0] if 'items' in body else body
                self.assertEqual(record['image_url'], PHOTO + '?synthetic-signature=fresh')
        self.assertEqual(ROW['image_url'], PHOTO)

    def test_denied_queries_never_generate_a_link(self):
        client, _ = self.client(denied=True)
        with patch.object(client.app.state.report_photo_links, 'signed_image_url') as signer:
            for path in ('/api/v1/reports', '/api/v1/reports/TEST-1', '/api/v1/management/reports'):
                self.assertEqual(client.get(path).status_code, 403)
            signer.assert_not_called()

    def test_wrong_owner_upstream_response_never_generates_a_link(self):
        client, _ = self.client(foreign_owner=True)
        with patch.object(client.app.state.report_photo_links, 'signed_image_url') as signer:
            self.assertEqual(client.get('/api/v1/reports/TEST-1').status_code, 503)
            signer.assert_not_called()


if __name__ == '__main__':
    unittest.main()
