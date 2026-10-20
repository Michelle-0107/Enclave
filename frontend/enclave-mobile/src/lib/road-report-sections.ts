import type { FacilityRecord } from './api';

// Distance to the section itself determines the nearest section near a 100m
// boundary; distance to its midpoint alone could suggest the adjacent section.
export function distanceToRoadSection(facility: FacilityRecord, latitude: number, longitude: number): number | null {
  const geometry = facility.road_section?.geometry;
  if (!geometry || geometry.length < 2) return null;
  const scale = Math.cos(latitude * Math.PI / 180);
  let best = Infinity;
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1], b = geometry[i];
    const ax = (a[0] - longitude) * scale, ay = a[1] - latitude;
    const dx = (b[0] - a[0]) * scale, dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy;
    const t = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy) * 111195.08);
  }
  return Number.isFinite(best) ? best : null;
}
