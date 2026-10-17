'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { WhatIfResult, RoutingRestriction, FacilityIssue } from '@/lib/api';
import {
  lineMidpoint, repairPathViews, routeChange, routeCoordinates, routeDistance, repairMapFacilities, repairMapBoundsPoints,
  type RepairPlanResult,
} from '@/lib/repairRouteView';

const BEFORE = '#b65c16';
const AFTER = '#137b79';
const EMPTY_RESTRICTIONS: RoutingRestriction[] = [];
const EMPTY_CANDIDATES: FacilityIssue[] = [];

export default function RepairPlanRoutes({ baseline, plan, restrictions = EMPTY_RESTRICTIONS, candidates = EMPTY_CANDIDATES }: {
  baseline: WhatIfResult['baseline']; plan: RepairPlanResult; restrictions?: RoutingRestriction[]; candidates?: FacilityIssue[];
}) {
  const repaired = useMemo(() => new Set(plan.facility_impacts?.map(item => item.facility_id) ?? []), [plan.facility_impacts]);
  const facilities = useMemo(()=>repairMapFacilities(plan,candidates,restrictions),[plan,candidates,restrictions]);
  const facilityMarkers = useRef(new Map<string,MapLibre.Marker>());
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
    const markerIndex = facilityMarkers.current;
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
    if (restrictions.length) {
      const features = restrictions.flatMap(item => item.exclusion_rings.map(ring => ({
        type: 'Feature' as const, properties: { repaired: repaired.has(item.facility_id) },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      })));
      instance.addSource('facility-zones', {type: 'geojson', data: {type: 'FeatureCollection', features}});
      sources.push('facility-zones');
      instance.addLayer({id: 'facility-zone-fill',source:'facility-zones',type:'fill',paint:{
        'fill-color':['case',['get','repaired'],'#199366','#d42b35'],'fill-opacity':0.25}});
      instance.addLayer({id:'facility-zone-outline',source:'facility-zones',type:'line',paint:{
        'line-color':['case',['get','repaired'],'#199366','#d42b35'],'line-width':2}});
      layers.push('facility-zone-fill','facility-zone-outline');
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
    for (const item of facilities) {
      if (!item.coordinate) continue;
      const el=document.createElement('button');
      el.type='button'; el.textContent=item.label;
      const label=`${item.label} · ${item.name}: ${item.selected?'selected for this simulated repair plan':'not selected for repair'}${item.hasRestrictionGeometry?'':'; facility location only, affected road area unavailable'}`;
      el.title=label; el.setAttribute('aria-label',label);
      Object.assign(el.style,{background:item.selected?'#199366':'#d42b35',color:'#fff',border:'3px solid white',borderRadius:'50%',width:'32px',height:'32px',fontWeight:'700',fontSize:'12px',boxShadow:'0 1px 5px #0005'});
      const marker=new M.Marker({element:el}).setLngLat(item.coordinate)
        .setPopup(new M.Popup({offset:18}).setText(label)).addTo(instance);
      markerIndex.set(item.id,marker); markers.push(marker);
    }
    draw('repair-before', beforePoints, BEFORE, beforeLabel, [-35, -24]);
    draw('repair-after', afterPoints, AFTER, afterLabel, [35, 24]);
    const points = repairMapBoundsPoints(beforePoints,afterPoints,facilities);
    if (points.length) {
      const bounds = new M.LngLatBounds();
      points.forEach(point => bounds.extend(point));
      instance.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 0 });
      const route = afterPoints.length ? afterPoints : beforePoints;
      if (route.length) for (const [label, point] of [['A', route[0]], ['B', route[route.length - 1]]] as const) {
        const el = document.createElement('div');
        el.textContent = label;
        Object.assign(el.style, { color: '#fff', background: '#202c46', border: '2px solid #fff',
          borderRadius: '50%', width: '28px', height: '28px', display: 'grid', placeItems: 'center', fontWeight: '700' });
        markers.push(new M.Marker({ element: el }).setLngLat(point).addTo(instance));
      }
    }
    return () => {
      markers.forEach(marker => marker.remove());
      markerIndex.clear();
      if (map.current !== instance) return;
      for (const id of layers.reverse()) if (instance.getLayer(id)) instance.removeLayer(id);
      for (const id of sources) if (instance.getSource(id)) instance.removeSource(id);
    };
  }, [beforePoints, afterPoints, beforeLabel, afterLabel, loaded, restrictions, repaired, facilities]);

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
    {restrictions.length>0 && <div className="text-xs text-muted-foreground">
      <p>Red areas: restrictions remaining after repairs. Green areas: cleared in this simulation. Purple: authored facility road segment. R: simulated repair; !: remaining restriction.</p>
      {restrictions.some(item=>item.binding_source==='point_only') && <p className="mt-1 text-amber-800">Some facilities have only point locations, without a confirmed affected road segment. Their zones are approximations; nearby roads are not automatically blocked.</p>}
    </div>}
    {baseline.some(row=>row.comparison_origin) && <p className="text-xs text-muted-foreground">Before and after use the same matched start and destination. An endpoint change beyond 1 m is treated as not assessable, not as an improvement.</p>}
    <div className="rounded-xl border border-border p-3 text-sm" aria-label="Selected repairs on this map">
      <p className="font-semibold text-primary">Selected repairs · {facilities.filter(item=>item.selected).length}</p>
      <p className="mt-1 text-xs text-muted-foreground">Green R1, R2… markers identify this plan&apos;s repairs. Red ! markers identify other candidate facilities. All repairs here are hypothetical.</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {facilities.filter(item=>item.selected).map(item=><li key={item.id}>
          <button type="button" disabled={!item.coordinate} className="min-h-10 rounded-lg border border-emerald-700 px-3 text-emerald-800 disabled:opacity-60"
            onClick={()=>{if(item.coordinate){map.current?.flyTo({center:item.coordinate,zoom:18});const marker=facilityMarkers.current.get(item.id);if(marker && !marker.getPopup()?.isOpen())marker.togglePopup();}}}>
            {item.label} · {item.name}{!item.coordinate?' · Location unavailable':''}
          </button>
        </li>)}
      </ul>
      <button type="button" className="mt-2 min-h-9 underline text-primary" onClick={()=>{
        const M=api.current;const instance=map.current;const points=repairMapBoundsPoints(beforePoints,afterPoints,facilities);
        if(M && instance && points.length){const bounds=new M.LngLatBounds();points.forEach(point=>bounds.extend(point));instance.fitBounds(bounds,{padding:80,maxZoom:18,duration:0});}
      }}>Show route and selected repairs</button>
      {facilities.some(item=>item.selected && !item.hasRestrictionGeometry) && <p className="mt-1 text-xs text-amber-800">Affected road areas are unavailable for some selected facilities in this comparison. Those markers show facility locations only.</p>}
    </div>
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
        {view.explanation && <p className="mt-1 text-xs text-muted-foreground">{view.explanation}</p>}
        <p className="mt-1" style={{ color: BEFORE }}>Before repairs: {routeDistance(view.before.route)}{view.before.reference ? ' · Avoid damage reference, accessibility unverified' : ''}</p>
        <p className="mt-1" style={{ color: AFTER }}>After repairs: {routeDistance(view.after.route)}{view.after.reference ? ' · Avoid damage reference, accessibility unverified' : ''}</p>
      </li>)}
    </ul>
  </section>;
}
