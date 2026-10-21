"""Frozen What-if references and unfiltered catalog endpoint access; separate scopes."""
import asyncio
from collections import defaultdict
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from backend.navigation.config import NavigationSettings, in_bounds
from backend.navigation.contracts import WalkingRouteRequest
from backend.navigation.demo_accessibility import shared_demo_walking_graph
from backend.navigation.provider import NavigationRejected
from backend.navigation.service import distance_meters
from backend.reports.issues import CommunityObstacleSnapshot
from backend.tools.audit_demo_accessibility import FROZEN
from backend.what_if.routing import SimulationNavigation

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'backend/docs/api/what-if-endpoint-audit/current.json'

async def main():
    navigation = SimulationNavigation(SimpleNamespace(settings=NavigationSettings()), fixed_snap=True)
    snapshot = CommunityObstacleSnapshot(checked_at=datetime.now(timezone.utc), items=[])
    rows = []
    for batch, digest in FROZEN.items():
        raw = (ROOT / f'backend/tests/fixtures/demo-routing/{batch}-samples.json').read_bytes()
        assert hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest() == digest
        old = json.loads(gzip.decompress((ROOT / f'backend/docs/api/shared-demo-route-audit/{batch}.json.gz').read_bytes()))
        old_rows = {row['id']: row for row in old['cases']}
        for case in json.loads(raw)['cases']:
            if case['area'] != 'kl-east-pilot': continue
            row = {**case, 'batch': batch}
            original = old_rows[case['id']]
            row['resident_available'] = {item['mode']: item['route'] is not None for item in original['options']}
            request = WalkingRouteRequest(origin=dict(zip(('longitude', 'latitude'), case['origin'])),
                destination=dict(zip(('longitude', 'latitude'), case['destination'])), route_mode='avoid_damage')
            try:
                route = await navigation.route_with_snapshot(request, snapshot)
                a, b = route.geometry.coordinates[0], route.geometry.coordinates[-1]
                anchored = request.model_copy(update={'origin': request.origin.model_copy(update={'longitude': a[0], 'latitude': a[1]}),
                    'destination': request.destination.model_copy(update={'longitude': b[0], 'latitude': b[1]})})
                repeated = await navigation.route_with_snapshot(anchored, snapshot)
                drift = max(distance_meters(a, repeated.geometry.coordinates[0]), distance_meters(b, repeated.geometry.coordinates[-1]))
                row.update(whatif_available=drift <= 1, distance=route.distance_meters, anchor_drift=drift)
            except NavigationRejected as error:
                row.update(whatif_available=False, reason=error.message)
            rows.append(row)
            if len(rows) % 30 == 0: print('frozen cases checked', len(rows), flush=True)
    graph = shared_demo_walking_graph('kl-east-pilot')
    places = json.loads((ROOT / 'backend/data/map_places.json').read_text(encoding='utf-8'))
    endpoints = []
    for place in places:
        if place['area_id'] != 'kl-east-pilot' or not in_bounds(place['longitude'], place['latitude']): continue
        # Keep every catalog point in this window, including inaccessible ones.
        point = (place['longitude'], place['latitude'])
        row = {key: place[key] for key in ('id', 'name', 'source', 'longitude', 'latitude')}
        row['building'] = bool(graph.land_access.buildings_at(point))
        try:
            snaps = graph.snap_candidates(point)
            row.update(available=True, access_meters=snaps[0][0])
        except NavigationRejected as error:
            row.update(available=False, reason=error.message)
        endpoints.append(row)
    groups = defaultdict(list)
    for row in rows: groups[(row['batch'], row['category'])].append(row)
    summary = [dict(batch=batch, category=category, total=len(items),
        resident_shortest=sum(r['resident_available'].get('shortest', False) for r in items),
        resident_avoid_damage=sum(r['resident_available'].get('avoid_damage', False) for r in items),
        whatif_reference=sum(r['whatif_available'] for r in items)) for (batch, category), items in groups.items()]
    access_summary = {}
    for source in sorted({row['source'] for row in endpoints}):
        items = [r for r in endpoints if r['source'] == source]
        access_summary[source] = dict(total=len(items), accessible=sum(r['available'] for r in items),
            failed_building=sum(not r['available'] and r['building'] for r in items),
            failed_outdoor=sum(not r['available'] and not r['building'] for r in items))
    result = dict(scope='Frozen KL East cases only; damage-free What-if walking reference, then fixed endpoint repeat. Catalog access is independent endpoint coverage, not route connectivity.',
        summary=summary, catalog_access=access_summary, cases=rows, catalog_endpoints=endpoints)
    result['catalog_sha256'] = hashlib.sha256((ROOT / 'backend/data/map_places.json').read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    result['frozen_sample_sha256'] = FROZEN
    result['algorithm_sha256'] = hashlib.sha256(b''.join((ROOT / 'backend' / path).read_bytes().replace(b'\r\n', b'\n')
        for path in ('navigation/roadside.py', 'navigation/demo_accessibility.py', 'navigation/demo_routes.py', 'what_if/routing.py'))).hexdigest()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'summary': summary, 'catalog_access': access_summary,
        'failed_frozen': [r for r in rows if not r['whatif_available']],
        'mall_places': [r for r in endpoints if any(word in r['name'].lower() for word in ('mall', 'jaya grocer', 'decathlon'))]}, indent=2), flush=True)

asyncio.run(main())
