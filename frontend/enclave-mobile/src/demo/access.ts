import { calculateProfileRoutes, dataset, insidePilot, meters, nearbyAccessPoints, routesBetweenAccessPoints, snapToRoad,
  type Coordinate, type Dataset, type ModeResult, type Snap, type TravelProfile } from './network';

export const MAX_START_ADJUSTMENT_METERS = 100;
export type AccessPlan = {
  from: Snap; to: Snap; results: ModeResult[]; startGap: number; endGap: number;
  connectorVerified: false;
};
export type JourneyPlan = { direct: ModeResult[]; adjustment: AccessPlan | null };

export function planJourney(profile: TravelProfile, origin: Coordinate, destination: Coordinate, data: Dataset = dataset): JourneyPlan {
  if (!insidePilot(origin, data) || !insidePilot(destination, data)) throw new Error('Select a point inside the current service area.');
  if (meters(origin, destination) < 5) throw new Error('Choose locations at least 5 m apart.');
  let direct: ModeResult[] = [];
  try { direct = calculateProfileRoutes(profile, origin, destination, data); } catch { /* Preserve the pins and check mapped start candidates below. */ }
  if (profile === 'wheelchair') return { direct, adjustment: null };
  let fixedDestination: Snap;
  try { fixedDestination = snapToRoad(destination, data); } catch { return { direct, adjustment: null }; }
  const directRoute = direct.find(item => item.mode === 'shortest')?.route;
  let best: AccessPlan | null = null;
  // Search real pedestrian graph points only. The chosen destination anchor stays fixed.
  const candidates = nearbyAccessPoints(origin, data, MAX_START_ADJUSTMENT_METERS, 80)
    .filter(snap => meters(snap.coordinate, directRoute?.originSnap.coordinate ?? origin) > 3)
    .sort((a, b) => a.distance - b.distance);
  for (const from of candidates) {
    if (meters(from.coordinate, fixedDestination.coordinate) < 5) continue;
    let results: ModeResult[];
    try { results = routesBetweenAccessPoints('walking', from, fixedDestination, data); } catch { continue; }
    const shortest = results.find(item => item.mode === 'shortest')?.route;
    if (!shortest) continue;
    // Offer a nearby start when the current start is disconnected, or when it avoids a material detour.
    if (directRoute && (directRoute.distance - shortest.distance - from.distance < 80 || shortest.distance + from.distance > directRoute.distance * 0.8)) continue;
    const adjustment: AccessPlan = { from, to: fixedDestination, results, startGap: meters(origin, from.coordinate), endGap: meters(destination, fixedDestination.coordinate), connectorVerified: false };
    if (!best || adjustment.startGap < best.startGap || (adjustment.startGap === best.startGap && shortest.distance < best.results[0].route!.distance)) best = adjustment;
  }
  return { direct, adjustment: best };
}

export function compassDirection(from: Coordinate, to: Coordinate): string {
  const r = Math.PI / 180, lat1 = from[1] * r, lat2 = to[1] * r, lon = (to[0] - from[0]) * r;
  const bearing = (Math.atan2(Math.sin(lon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon)) / r + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];
}
