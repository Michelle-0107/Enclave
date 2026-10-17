'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { WhatIfResult } from '@/lib/api';
import {
  lineMidpoint, repairPathViews, routeChange, routeCoordinates, routeDistance,
  type RepairPlanResult,
} from '@/lib/repairRouteView';

const BEFORE = '#b65c16';
const AFTER = '#137b79';

export default function RepairPlanRoutes({ baseline, plan }: {
  baseline: WhatIfResult['baseline']; plan: RepairPlanResult;
}) {
  const views = useMemo(() => repairPathViews(baseline, plan.paths), [baseline, plan.paths]);
  const [selected, setSelected] = useState(views[0]?.key ?? '');
  const active = views.find(view => view.key === selected) ?? views[0];
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const api = useRef<typeof MapLibre | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const beforePoints = useMemo(() => routeCoordinates(active?.before.route ?? null), [active]);
  const afterPoints = useMemo(() => routeCoordinates(active?.after.route ?? null), [active]);
  const beforeLabel = `Before: ${routeDistance(active?.before.route ?? null)}${active?.before.reference ? ' · walking reference' : ''}`;
  const afterLabel = `After: ${routeDistance(active?.after.route ?? null)}${active?.after.reference ? ' · walking reference' : ''}`;

  useEffect(() => {
    let disposed = false;
    let instance: MapLibre.Map | undefined;
    let observer: ResizeObserver | undefined;
    import('maplibre-gl').then(M => {
      if (disposed || !host.current) return;
      api.current = M;
      M.setWorkerUrl('/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs');
      instance = new M.Map({
        container: host.current, style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [101.731, 3.226], zoom: 15,
      });
      map.current = instance;
      instance.addControl(new M.NavigationControl({ showCompass: false }), 'top-right');
      instance.scrollZoom.disable();
      instance.on('load', () => { if (!disposed) setLoaded(value => value + 1); });
      instance.on('error', () => { if (!disposed) setError('Some map tiles could not load. The route distances remain available below.'); });
      observer = new ResizeObserver(() => instance?.resize());
      observer.observe(host.current);
    }).catch(() => {
      if (!disposed) setError('Unable to open the route map. Check WebGL support; distances are listed below.');
    });
    return () => { disposed = true; observer?.disconnect(); instance?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const M = api.current;
    const instance = map.current;
    if (!M || !instance || !loaded) return;
    const markers: MapLibre.Marker[] = [];
    const layers: string[] = [];
    const sources: string[] = [];
    function draw(id: string, points: [number, number][], color: string, label: string, offset: [number, number]) {
      if (!points.length || !instance || !M) return;
      instance.addSource(id, { type: 'geojson', data: {
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points },
      } });
      sources.push(id);
      instance.addLayer({ id, source: id, type: 'line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: id === 'repair-before'
          ? { 'line-color': color, 'line-width': 9, 'line-dasharray': [1.6, 1.2], 'line-opacity': 0.85 }
          : { 'line-color': color, 'line-width': 4.5 },
      });
      layers.push(id);
      const midpoint = lineMidpoint(points);
      if (midpoint) {
        const el = document.createElement('div');
        el.textContent = label;
        Object.assign(el.style, { color, background: '#fff', border: `2px solid ${color}`,
          borderRadius: '7px', padding: '4px 7px', fontSize: '12px', fontWeight: '700',
          whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 1px 5px #0003' });
        markers.push(new M.Marker({ element: el, offset }).setLngLat(midpoint).addTo(instance));
      }
    }
    draw('repair-before', beforePoints, BEFORE, beforeLabel, [-35, -24]);
    draw('repair-after', afterPoints, AFTER, afterLabel, [35, 24]);
    const points = [...beforePoints, ...afterPoints];
    if (points.length) {
      const bounds = new M.LngLatBounds();
      points.forEach(point => bounds.extend(point));
      instance.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 0 });
      const route = afterPoints.length ? afterPoints : beforePoints;
      for (const [label, point] of [['A', route[0]], ['B', route[route.length - 1]]] as const) {
        const el = document.createElement('div');
        el.textContent = label;
        Object.assign(el.style, { color: '#fff', background: '#202c46', border: '2px solid #fff',
          borderRadius: '50%', width: '28px', height: '28px', display: 'grid', placeItems: 'center', fontWeight: '700' });
        markers.push(new M.Marker({ element: el }).setLngLat(point).addTo(instance));
      }
    }
    return () => {
      markers.forEach(marker => marker.remove());
      if (map.current !== instance) return;
      for (const id of layers.reverse()) if (instance.getLayer(id)) instance.removeLayer(id);
      for (const id of sources) if (instance.getSource(id)) instance.removeSource(id);
    };
  }, [beforePoints, afterPoints, beforeLabel, afterLabel, loaded]);

  return <section className="flex flex-col gap-3" aria-label={`${plan.name} route comparison`}>
    <h4 className="font-semibold text-primary">Before and after routes</h4>
    <div className="flex flex-wrap gap-2" aria-label="Select path and mode">
      {views.map(view => <button type="button" key={view.key} aria-pressed={active?.key === view.key}
        onClick={() => setSelected(view.key)} className={`min-h-11 rounded-xl border px-3 text-sm ${active?.key === view.key ? 'border-primary bg-primary text-white' : 'border-border bg-white text-primary'}`}>
        {view.name} · {view.mode === 'accessible' ? 'Accessible' : 'Avoid damage'}
      </button>)}
    </div>
    <div className="flex flex-wrap gap-4 text-sm font-semibold">
      <span style={{ color: BEFORE }}>Dashed orange · {beforeLabel}</span>
      <span style={{ color: AFTER }}>Solid teal · {afterLabel}</span>
    </div>
    {(active?.before.reference || active?.after.reference) && <p role="note" className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      No verified accessible route is available for one or both cases. The map shows an Avoid damage walking reference instead. It may include stairs and is not verified for wheelchair use. Accessible availability counts are unchanged.
    </p>}
    <div ref={host} className="h-[420px] min-h-[300px] w-full overflow-hidden rounded-2xl border border-border" aria-label="Map showing before and after repair routes" />
    {error && <p role="status" className="text-sm text-status-red">{error}</p>}
    {!beforePoints.length && !afterPoints.length && <p className="text-sm text-muted-foreground">No mapped route geometry is available for this selection.</p>}
    <p className="text-xs text-muted-foreground">A: route start · B: destination. Orange and teal overlap when the route is unchanged. Simulation only.</p>
    <ul className="flex flex-col gap-3">
      {views.map(view => <li key={view.key} className="rounded-xl border border-border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 font-semibold text-primary">
          <span>{view.name} · {view.mode === 'accessible' ? 'Accessible' : 'Avoid damage'}</span>
          <span>{routeChange(view)}</span>
        </div>
        <p className="mt-1" style={{ color: BEFORE }}>Before repairs: {routeDistance(view.before.route)}{view.before.reference ? ' · Avoid damage reference, accessibility unverified' : ''}</p>
        <p className="mt-1" style={{ color: AFTER }}>After repairs: {routeDistance(view.after.route)}{view.after.reference ? ' · Avoid damage reference, accessibility unverified' : ''}</p>
      </li>)}
    </ul>
  </section>;
}
