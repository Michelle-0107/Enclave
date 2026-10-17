"""Validate, then explicitly register eight fictional facilities on mapped roads.

Run from the repository root:
  python -B -m backend.tools.seed_demo_facilities
  python -B -m backend.tools.seed_demo_facilities --apply --created-by <management UUID>

Only facilities are inserted. No reports, issue votes, obstacles, repairs, or
accessibility verification are generated. Existing facility rows are preserved.
"""
import argparse
import json
from pathlib import Path
from uuid import UUID

import httpx

from backend.core.config import load_settings
from backend.reports.issues import FacilityCreate


def load_dataset(path):
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('field_verified') is not False or len(data.get('facilities', [])) != 8:
        raise ValueError('Expected eight explicitly unverified DEMO facilities.')
    records = []
    for item in data['facilities']:
        if not item['name'].startswith('[DEMO] ') or not item.get('source_edge_id', '').startswith('osm-'):
            raise ValueError('Every fixture needs a DEMO label and mapped source edge.')
        record = FacilityCreate.model_validate({key: item[key] for key in
            ('name', 'facility_type', 'latitude', 'longitude')}).model_dump()
        records.append({'id': str(UUID(item['id'])), **record})
    if len({r['id'] for r in records}) != len(records) or len({r['name'] for r in records}) != len(records):
        raise ValueError('Duplicate fixture identity.')
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path,
        default=Path(__file__).resolve().parents[1] / 'data/kl_east_report_facilities.json')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--created-by', type=UUID)
    args = parser.parse_args()
    records = load_dataset(args.dataset)
    print('Validated 8 DEMO facilities within the KL East pilot.')
    for row in records:
        print(f"{row['name']} | {row['latitude']}, {row['longitude']}")
    if not args.apply:
        print('Dry run only. No settings read, no network requests, no database changes.')
        return
    if not args.created_by:
        parser.error('--apply requires --created-by with an existing management profile UUID.')
    settings = load_settings()
    headers = {'apikey': settings.api_key, 'Content-Profile': 'public'}
    if not settings.api_key.startswith('sb_secret_'):
        headers['Authorization'] = 'Bearer ' + settings.api_key
    with httpx.Client(headers=headers, timeout=20, follow_redirects=False, trust_env=False) as client:
        base = settings.project_url + '/rest/v1/'
        response = client.get(base + 'profiles', params={
            'select': 'id', 'id': f'eq.{args.created_by}', 'role': 'eq.management', 'limit': '1'})
        if response.status_code != 200 or not response.json():
            raise RuntimeError('Management profile could not be verified; no rows inserted.')
        payload = [{**row, 'created_by': str(args.created_by)} for row in records]
        response = client.post(base + 'community_facilities', params={
            'on_conflict': 'name,facility_type,latitude,longitude', 'select': 'id'},
            headers={'Prefer': 'resolution=ignore-duplicates,return=representation'}, json=payload)
        if response.status_code not in (200, 201):
            raise RuntimeError(f'Facility registration failed (HTTP {response.status_code}).')
        print(f'Registered {len(response.json())} new facilities; exact existing matches preserved.')


if __name__ == '__main__':
    main()
