import type { RouteOutcome, RouteDetails, WhatIfResult } from './api';

export type RepairPlanResult = WhatIfResult['plans'][number];
export type RouteDisplay = { route: RouteDetails | null; reference: boolean; state: string };
export type RepairPathView = {
  key: string; name: string; mode: 'avoid_damage' | 'accessible';
  before: RouteDisplay; after: RouteDisplay; effect: string;
};

function display(outcome: RouteOutcome | undefined, walking: RouteOutcome | undefined): RouteDisplay {
  if (outcome?.state === 'available') return { route: outcome, reference: false, state: outcome.state };
  if (outcome?.fallback) return { route: outcome.fallback, reference: true, state: outcome.state };
  // Also works while the previous backend is rolling out: its walking outcome
  // stays explicitly labelled as a reference instead of becoming accessible.
  if (walking?.state === 'available') return { route: walking, reference: true, state: outcome?.state ?? 'no_route' };
  return { route: null, reference: false, state: outcome?.state ?? 'no_route' };
}

export function repairPathViews(baseline: WhatIfResult['baseline'], paths: RepairPlanResult['paths']): RepairPathView[] {
  return paths.map(path => {
    const original = baseline.find(row => row.path_id === path.path_id && row.route_mode === path.route_mode);
    const walkingBefore = baseline.find(row => row.path_id === path.path_id && row.route_mode === 'avoid_damage');
    const walkingAfter = paths.find(row => row.path_id === path.path_id && row.route_mode === 'avoid_damage');
    return {
      key: `${path.path_id}:${path.route_mode}`, name: path.path_name, mode: path.route_mode,
      before: display(original?.current, path.route_mode === 'accessible' ? walkingBefore?.current : undefined),
      after: display(path.after, path.route_mode === 'accessible' ? walkingAfter?.after : undefined),
      effect: path.effect,
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
