'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { addFixedFacilityLayer } from '@/lib/fixedFacilityLayer';
import { addServiceAreaBoundary, PILOT_SERVICE_BOUNDS } from '@/lib/serviceAreaBoundary';
import { restrictionZoneFeatures } from '@/lib/restrictionZones';
import type { WhatIfResult, RoutingRestriction, FacilityIssue } from '@/lib/api';
import {
  repairPathViews, routeFailureReason, routeChange, repairMapPaths, routeDistance, formatRouteSeconds, routeTimeChange, repairMapFacilities, repairMapBoundsPoints,
  type RepairPlanResult,
} from '@/lib/repairRouteView';

const BEFORE = '#b65c16';
const AFTER = '#137b79';
const EMPTY_RESTRICTIONS: RoutingRestriction[] = [];
const EMPTY_CANDIDATES: FacilityIssue[] = [];

export default function RepairPlanRoutes({ baseline, plan, restrictions = EMPTY_RESTRICTIONS, candidates = EMPTY_CANDIDATES, selectedKey, onSelectionChange }: {
  baseline: WhatIfResult['baseline']; plan: RepairPlanResult; restrictions?: RoutingRestriction[]; candidates?: FacilityIssue[];
  selectedKey?: string; onSelectionChange?: (key: string) => void;
}) {
  const repaired = useMemo(() => new Set(plan.facility_impacts?.map(item => item.facility_id) ?? []), [plan.facility_impacts]);
  const facilities = useMemo(()=>repairMapFacilities(plan,candidates,restrictions),[plan,candidates,restrictions]);
  const facilityLayer = useRef<ReturnType<typeof addFixedFacilityLayer> | null>(null);
  const views = useMemo(() => repairPathViews(baseline, plan.paths), [baseline, plan.paths]);
  const [selected, setSelected] = useState('');
  const requested = selectedKey ?? selected;
  const selection = requested === 'all:avoid_damage' || requested === 'all:accessible'
    ? requested : views.find(view => view.key === requested)?.key ?? views[0]?.key ?? '';
  const mapPaths = useMemo(() => repairMapPaths(views, selection), [views, selection]);
  const endpointPoints = useMemo(() => mapPaths.flatMap(path => [path.origin,path.destination].filter((p): p is [number,number] => p !== null)), [mapPaths]);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const api = useRef<typeof MapLibre | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const beforePoints = useMemo(() => mapPaths.flatMap(path => path.beforePoints), [mapPaths]);
  const afterPoints = useMemo(() => mapPaths.flatMap(path => path.afterPoints), [mapPaths]);


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
      instance.on('load', () => { if (!disposed && instance) { addServiceAreaBoundary(instance); setLoaded(value => value + 1); } });
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
    function draw(id: string, points: [number, number][], color: string, before: boolean) {
      if (points.length < 2 || !instance || !M) return;
      instance.addSource(id, { type: 'geojson', data: {
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points },
      } });
      sources.push(id);
      instance.addLayer({ id, source: id, type: 'line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: before
          ? { 'line-color': color, 'line-width': 9, 'line-dasharray': [1.6, 1.2], 'line-opacity': 0.85 }
          : { 'line-color': color, 'line-width': 4.5 },
      });
      layers.push(id);
    }
    if (restrictions.length) {
      const features = restrictionZoneFeatures(restrictions, repaired);
      instance.addSource('facility-zones', {type: 'geojson', data: {type: 'FeatureCollection', features}});
      sources.push('facility-zones');
      instance.addLayer({id: 'facility-zone-fill',source:'facility-zones',type:'fill',paint:{
        'fill-color':['case',['get','repaired'],'#199366','#d42b35'],'fill-opacity':0.25}});
      layers.push('facility-zone-fill');
      const segmentFeatures = restrictions.filter(item=>item.affected_segment).map(item=>({
        type:'Feature' as const,properties:{},geometry:item.affected_segment!,
      }));
      if (segmentFeatures.length) {
        instance.addSource('facility-segments',{type:'geojson',data:{type:'FeatureCollection',features:segmentFeatures}});
        sources.push('facility-segments');
        instance.addLayer({id:'facility-segment-line',source:'facility-segments',type:'line',paint:{'line-color':'#913ad1','line-width':7,'line-opacity':0.8}});
        layers.push('facility-segment-line');
      }
    }
    const fixedFacilities = addFixedFacilityLayer(instance, M, 'repair-facilities', facilities.flatMap(item => item.coordinate ? [{
      id: item.id, coordinate: item.coordinate, label: item.label, color: item.selected ? '#199366' : '#d42b35',
      description: `${item.label} - ${item.name}: ${item.selected ? 'selected for this simulated repair plan' : 'not selected for repair'}${item.hasRestrictionGeometry ? '' : '; facility location only, affected road area unavailable'}`,
    }] : []));
    facilityLayer.current = fixedFacilities;
    // Only the selected journey is drawn; cleanup removes its previous layers and markers.
    for (const phase of ['before', 'after'] as const) for (const path of mapPaths) {
      const before = phase === 'before';
      draw(`repair-${path.number}-${phase}`, before ? path.beforePoints : path.afterPoints,
        before ? BEFORE : AFTER, before);
    }
    const points = repairMapBoundsPoints(beforePoints,afterPoints,facilities,endpointPoints);
    if (points.length) {
      const bounds = new M.LngLatBounds();
      points.forEach(point => bounds.extend(point));
      instance.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 0 });
    }
    for (const path of mapPaths) {
      for (const [label, point] of [['A', path.origin], ['B', path.destination]] as const) {
        if (!point) continue;
        const el = document.createElement('div');
        el.textContent = `${path.number}${label}`;
        el.title = `P${path.number} · ${path.view.name} · ${label === 'A' ? 'Start' : 'Destination'}`;
        Object.assign(el.style, { color: '#fff', background: '#202c46', border: '2px solid #fff',
          borderRadius: '50%', minWidth: '30px', height: '30px', display: 'grid', placeItems: 'center', fontWeight: '700' });
        markers.push(new M.Marker({ element: el }).setLngLat(point).addTo(instance));
      }
    }
    return () => {
      markers.forEach(marker => marker.remove());
      if (facilityLayer.current === fixedFacilities) facilityLayer.current = null;
      if (map.current !== instance) return;
      fixedFacilities.remove();
      for (const id of layers.reverse()) if (instance.getLayer(id)) instance.removeLayer(id);
      for (const id of sources) if (instance.getSource(id)) instance.removeSource(id);
    };
  }, [beforePoints, afterPoints, mapPaths, loaded, restrictions, repaired, facilities, endpointPoints]);

  return <section className="flex flex-col gap-3" aria-label={`${plan.name} route comparison`}>
    <h4 className="font-semibold text-primary">Before and after routes</h4>
    <label className="flex flex-col gap-2 text-xs font-semibold text-primary">
      Path and route mode
      <select aria-label={`${plan.name}: path and route mode`} value={selection} onChange={event => { setSelected(event.target.value); onSelectionChange?.(event.target.value); }} className="min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm font-normal">
        {views.some(view => view.mode === 'avoid_damage') && <option value="all:avoid_damage">Compare all routes · Avoid damage</option>}
        {views.some(view => view.mode === 'accessible') && <option value="all:accessible">Compare all routes · Accessible</option>}
        {!views.length && <option value="">No comparable paths</option>}
        {views.map(view => <option key={view.key} value={view.key}>{view.name} · {view.mode === 'accessible' ? 'Accessible' : 'Avoid damage'}</option>)}
      </select>
    </label>
    <p className="text-xs text-muted-foreground">{selection.startsWith('all:') ? `Comparing all ${mapPaths.length} routes. Each route is listed below with its Before / After distance and time.` : 'Select a path to compare its Before and After routes across all repair plans.'}</p>
    <div className="flex flex-col gap-2 text-sm font-semibold">
      {mapPaths.map(path => <div key={path.view.key} className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-primary">P{path.number} · {path.view.name}</span>
        <span style={{ color: BEFORE }}>Dashed orange · {path.beforeLabel}</span>
        <span style={{ color: AFTER }}>Solid teal · {path.afterLabel}</span>
        {!path.beforePoints.length && !path.afterPoints.length && <span className="text-muted-foreground">No mapped geometry for this path.</span>}
      </div>)}
    </div>
    {mapPaths.some(path => path.view.before.reference || path.view.after.reference) && <p role="note" className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      No verified accessible route is available for one or both cases. The map shows an Avoid damage walking reference instead. It may include stairs and is not verified for wheelchair use. Accessible availability counts are unchanged.
    </p>}
    {restrictions.length>0 && <div className="text-xs text-muted-foreground">
      <p>Dashed outline: service area. Red areas: restrictions remaining after repairs. Green areas: cleared in this simulation. Shading shows the affected area as one continuous zone. Purple: mapped facility road segment. R: simulated repair; !: reported issue.</p>
      {restrictions.some(item=>item.binding_source==='point_only') && <p className="mt-1 text-amber-800">Some facilities have only point locations, without a confirmed affected road segment. Their zones are approximations; nearby roads are not automatically blocked.</p>}
    </div>}
    {baseline.some(row=>row.comparison_origin) && <p className="text-xs text-muted-foreground">Before and after use the same matched start and destination. An endpoint change beyond 1 m is treated as not assessable, not as an improvement.</p>}
    <div className="rounded-xl border border-border p-3 text-sm" aria-label="Selected repairs on this map">
      <p className="font-semibold text-primary">Selected repairs · {facilities.filter(item=>item.selected).length}</p>
      <p className="mt-1 text-xs text-muted-foreground">Green R1, R2… markers identify this plan&apos;s repairs. Red ! markers identify other reported facilities. Only shaded restriction zones block routes. All repairs here are hypothetical.</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {facilities.filter(item=>item.selected).map(item=><li key={item.id}>
          <button type="button" disabled={!item.coordinate} className="min-h-10 rounded-lg border border-emerald-700 px-3 text-emerald-800 disabled:opacity-60"
            onClick={()=>{if(item.coordinate){map.current?.flyTo({center:item.coordinate,zoom:18});facilityLayer.current?.showPopup(item.id);}}}>
            {item.label} · {item.name}{!item.coordinate?' · Location unavailable':''}
          </button>
        </li>)}
      </ul>
      <button type="button" className="mt-2 min-h-9 underline text-primary" onClick={()=>{
        const M=api.current;const instance=map.current;const points=repairMapBoundsPoints(beforePoints,afterPoints,facilities,endpointPoints);
        if(M && instance && points.length){const bounds=new M.LngLatBounds();points.forEach(point=>bounds.extend(point));instance.fitBounds(bounds,{padding:80,maxZoom:18,duration:0});}
      }}>Show route and selected repairs</button>
      <button type="button" className="mt-2 min-h-9 px-3 underline text-primary" onClick={()=>{
        const [w,s,e,n]=PILOT_SERVICE_BOUNDS;
        map.current?.fitBounds([[w,s],[e,n]],{padding:24,duration:400});
      }}>Show service area</button>
      {facilities.some(item=>item.selected && !item.hasRestrictionGeometry) && <p className="mt-1 text-xs text-amber-800">Affected road areas are unavailable for some selected facilities in this comparison. Those markers show facility locations only.</p>}
    </div>
    <div ref={host} className="h-[420px] min-h-[300px] w-full overflow-hidden rounded-2xl border border-border" aria-label="Map showing before and after repair routes" />
    {error && <p role="status" className="text-sm text-status-red">{error}</p>}
    {!beforePoints.length && !afterPoints.length && <p className="text-sm text-muted-foreground">No route geometry is available. A and B show the selected start and destination.</p>}
    <p className="text-xs text-muted-foreground">A: selected path start · B: selected path destination, shown even when routing fails. P identifies the selected path. Orange and teal overlap when the route is unchanged. Simulation only.</p>
    <ul className="flex flex-col gap-3">
      {mapPaths.map(({ view }) => <li key={view.key} className="rounded-xl border border-border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 font-semibold text-primary">
          <span>{view.name} · {view.mode === 'accessible' ? 'Accessible' : 'Avoid damage'}</span>
          <span>{routeChange(view)}</span>
        </div>
        <p className="mt-1 font-semibold text-primary">{routeTimeChange(view)}</p>
        {view.explanation && <p className="mt-1 text-xs text-muted-foreground">{view.explanation}</p>}
        <p className="mt-1" style={{ color: BEFORE }}>Before repairs: {routeDistance(view.before.route)} · {formatRouteSeconds(view.before.route?.duration_seconds)}{view.before.reference ? ' · Avoid damage reference, accessibility unverified' : ''}</p>
        {routeFailureReason(view.before) && <p className="mt-1 text-xs text-amber-900">Before: {routeFailureReason(view.before)}</p>}
        <p className="mt-1" style={{ color: AFTER }}>After repairs: {routeDistance(view.after.route)} · {formatRouteSeconds(view.after.route?.duration_seconds)}{view.after.reference ? ' · Avoid damage reference, accessibility unverified' : ''}</p>
        {routeFailureReason(view.after) && <p className="mt-1 text-xs text-amber-900">After: {routeFailureReason(view.after)}</p>}
      </li>)}
    </ul>
  </section>;
}
