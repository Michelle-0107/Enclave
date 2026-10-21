import type { RouteOutcome, RouteDetails, WhatIfResult, FacilityIssue, RoutingRestriction } from './api';

export type RepairPlanResult = WhatIfResult['plans'][number];
export type RouteDisplay = { route: RouteDetails | null; reference: boolean; state: string; reason?: string | null; details?: string | null };
export type RepairPathView = {
  key: string; pathId: string; name: string; mode: 'avoid_damage' | 'accessible';
  origin?: [number,number] | null; destination?: [number,number] | null;
  before: RouteDisplay; after: RouteDisplay; effect: string; explanation?: string | null;
};

function display(outcome: RouteOutcome | undefined, walking: RouteOutcome | undefined): RouteDisplay {
  if (outcome?.state === 'available') return { route: outcome, reference: false, state: outcome.state };
  if (outcome?.fallback) return { route: outcome.fallback, reference: true, state: outcome.state, reason: outcome.reason, details: outcome.details };
  // Also works while the previous backend is rolling out: its walking outcome
  // stays explicitly labelled as a reference instead of becoming accessible.
  if (walking?.state === 'available') return { route: walking, reference: true, state: outcome?.state ?? 'no_route', reason: outcome?.reason, details: outcome?.details };
  return { route: null, reference: false, state: outcome?.state ?? 'no_route', reason: outcome?.reason, details: outcome?.details };
}

function endpoint(point: { longitude: number; latitude: number } | null | undefined): [number,number] | null {
  return point && Number.isFinite(point.longitude) && Number.isFinite(point.latitude) && Math.abs(point.longitude)<=180 && Math.abs(point.latitude)<=90
    ? [point.longitude,point.latitude] : null;
}

export function routeFailureReason(display: RouteDisplay): string | null {
  if (display.state==='available') return null;
  const reasons: Record<string,string> = {
    blocked_endpoint:'The start or destination is inside an unrepaired restriction.',
    no_fixed_reference_endpoints:'No supported walking route was found, even with all damage restrictions removed. Check walking access near the start and destination.',
    no_verified_accessible_reference:'No verified step-free network connects these endpoints. Repairs alone do not verify accessibility.',
    comparison_endpoint_changed:'A route could not keep the same comparison endpoints; this result cannot be compared.',
    remaining_damage_intersection:'Unrepaired restrictions still block all validated routes or their endpoint approaches.',
    no_supported_route:'No route meeting the walking access and remaining restriction rules was found.',
  };
  const summary = reasons[display.reason ?? ''] ?? (display.state==='not_assessable' ? 'This journey could not be assessed.' : 'No supported route was found.');
  return display.details ? `${summary} ${display.details}` : summary;
}

export function repairPathViews(baseline: WhatIfResult['baseline'], paths: RepairPlanResult['paths']): RepairPathView[] {
  return paths.map(path => {
    const original = baseline.find(row => row.path_id === path.path_id && row.route_mode === path.route_mode);
    const walkingBefore = baseline.find(row => row.path_id === path.path_id && row.route_mode === 'avoid_damage');
    const walkingAfter = paths.find(row => row.path_id === path.path_id && row.route_mode === 'avoid_damage');
    return {
      key: `${path.path_id}:${path.route_mode}`, pathId: path.path_id, name: path.path_name, mode: path.route_mode,
      origin: endpoint(original?.requested_origin) ?? endpoint(original?.comparison_origin),
      destination: endpoint(original?.requested_destination) ?? endpoint(original?.comparison_destination),
      before: display(original?.current, path.route_mode === 'accessible' ? walkingBefore?.current : undefined),
      after: display(path.after, path.route_mode === 'accessible' ? walkingAfter?.after : undefined),
      effect: path.effect, explanation: path.explanation,
    };
  });
}

export function routeDistance(route: RouteDetails | null): string {
  return route?.distance_meters != null && Number.isFinite(route.distance_meters)
    ? `${Math.round(route.distance_meters)} m` : 'Unavailable';
}

export function routeChange(view: RepairPathView): string {
  if (view.before.reference !== view.after.reference) return 'Different route types; distances are not directly comparable';
  const before = view.before.route?.distance_meters;
  const after = view.after.route?.distance_meters;
  if (before == null || after == null) return view.effect.replaceAll('_', ' ');
  const saved = before - after;
  const prefix = view.before.reference ? 'Walking reference: ' : '';
  if (Math.abs(saved) < 1) return `${prefix}distance unchanged`;
  return `${prefix}${Math.round(Math.abs(saved))} m ${saved > 0 ? 'shorter' : 'longer'}`;
}

export function routeCoordinates(route: RouteDetails | null): [number, number][] {
  const points = route?.geometry?.coordinates;
  if (!points || points.length < 2 || points.some(p => p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) return [];
  return points;
}

export function lineMidpoint(points: [number, number][]): [number, number] | null {
  if (points.length < 2) return null;
  const lengths = points.slice(1).map((p, i) => Math.hypot(
    (p[0] - points[i][0]) * Math.cos((p[1] + points[i][1]) * Math.PI / 360), p[1] - points[i][1]));
  let remaining = lengths.reduce((sum, value) => sum + value, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] ? remaining / lengths[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    remaining -= lengths[i];
  }
  return points[points.length - 1];
}


export type RepairMapFacility = {
  id: string; name: string; coordinate: [number,number] | null;
  selected: boolean; label: string; hasRestrictionGeometry: boolean;
};

export function repairMapFacilities(plan: RepairPlanResult, candidates: FacilityIssue[], restrictions: RoutingRestriction[]): RepairMapFacility[] {
  const selected = new Map((plan.facility_impacts ?? []).map((item,index)=>[item.facility_id,{name:item.facility_name,label:`R${index+1}`} ]));
  const records = new Map<string,{name:string;longitude:number;latitude:number;hasRestrictionGeometry:boolean}>();
  for (const item of candidates) records.set(item.facility_id,{name:item.facility_name,longitude:item.longitude,latitude:item.latitude,hasRestrictionGeometry:false});
  for (const item of restrictions) records.set(item.facility_id,{name:item.facility_name,longitude:item.longitude,latitude:item.latitude,hasRestrictionGeometry:!!item.exclusion_rings.length});
  const ids = [...new Set([...selected.keys(),...records.keys()])];
  return ids.map(id=>{
    const item=records.get(id); const repair=selected.get(id);
    const valid=item && Number.isFinite(item.longitude) && Number.isFinite(item.latitude) && Math.abs(item.longitude)<=180 && Math.abs(item.latitude)<=90;
    return {id,name:repair?.name ?? item?.name ?? id,selected:!!repair,label:repair?.label ?? '!',
      coordinate:valid?[item.longitude,item.latitude]:null,hasRestrictionGeometry:!!item?.hasRestrictionGeometry};
  });
}

export function repairMapBoundsPoints(before:[number,number][],after:[number,number][],facilities:RepairMapFacility[],endpoints:[number,number][]=[]):[number,number][] {
  return [...before,...after,...endpoints,...facilities.filter(item=>item.selected && item.coordinate).map(item=>item.coordinate!)];
}

// Individual selection shows one journey; explicit all-route mode shows one mode per journey.
export function repairMapPaths(views: RepairPathView[], selection = '') {
  const ids = [...new Set(views.map(view => view.pathId))];
  const focused = views.find(view => view.key === selection) ?? views[0];
  const visible = selection === 'all:avoid_damage' || selection === 'all:accessible'
    ? views.filter(view => view.mode === selection.slice(4)) : focused ? [focused] : [];
  return visible.map(view => ({
    view, number: ids.indexOf(view.pathId) + 1,
    beforePoints: routeCoordinates(view.before.route), afterPoints: routeCoordinates(view.after.route),
    origin: view.origin ?? routeCoordinates(view.after.route)[0] ?? routeCoordinates(view.before.route)[0] ?? null,
    destination: view.destination ?? routeCoordinates(view.after.route).at(-1) ?? routeCoordinates(view.before.route).at(-1) ?? null,
    beforeLabel: `Before: ${routeDistance(view.before.route)}${view.before.reference ? ' · walking reference' : ''}`,
    afterLabel: `After: ${routeDistance(view.after.route)}${view.after.reference ? ' · walking reference' : ''}`,
  }));
}

export function formatRouteSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Unavailable';
  if (seconds > 0 && seconds < 0.5) return '<1 s';
  const total = Math.round(seconds);
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min${total % 60 ? ` ${total % 60} s` : ''}`;
}

export function routeTimeChange(view: RepairPathView): string {
  if (view.before.reference !== view.after.reference) return 'Time not comparable';
  const before = view.before.route?.duration_seconds;
  const after = view.after.route?.duration_seconds;
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) return 'Time saving unavailable';
  const saved = before - after;
  const prefix = view.before.reference ? 'Walking reference: ' : '';
  return Math.abs(saved) < 0.5 ? `${prefix}time unchanged` : `${prefix}${formatRouteSeconds(Math.abs(saved))} ${saved > 0 ? 'saved' : 'longer'}`;
}
