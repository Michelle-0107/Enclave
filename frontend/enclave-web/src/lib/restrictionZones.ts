import type { RoutingRestriction } from './api';

type Point = [number, number];
type Ring = Point[];
type Rectangle = [number, number, number, number];
type ZoneFeature = {
  type: 'Feature'; properties: { repaired: boolean };
  geometry: { type: 'Polygon'; coordinates: Ring[] };
};

function rectangle(ring: Ring): Rectangle | null {
  if (ring.length !== 5 || ring.some(p => p.length !== 2 || !p.every(Number.isFinite))) return null;
  if (ring[0][0] !== ring[4][0] || ring[0][1] !== ring[4][1]) return null;
  const xs = [...new Set(ring.map(p => p[0]))], ys = [...new Set(ring.map(p => p[1]))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  if (ring.slice(1).some((p, i) => (p[0] === ring[i][0]) === (p[1] === ring[i][1]))) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function area(ring: Ring): number {
  // Subtract the origin to avoid cancellation at geographic coordinates.
  const [x, y] = ring[0];
  return ring.slice(1).reduce((sum, p, i) => sum +
    (ring[i][0] - x) * (p[1] - y) - (p[0] - x) * (ring[i][1] - y), 0) / 2;
}

function contains(ring: Ring, p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
      p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Exact display union of the backend's axis-aligned routing cells.
 * Coordinate compression keeps all original boundaries: no convex hull or
 * bounding box can fill in an unblocked road, bend or hole. Routing is unchanged.
 */
export function unionRestrictionRectangles(rectangles: Rectangle[]): Ring[][] {
  if (!rectangles.length) return [];
  const xs = [...new Set(rectangles.flatMap(r => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rectangles.flatMap(r => [r[1], r[3]]))].sort((a, b) => a - b);
  const width = xs.length, height = ys.length;
  // Bound display memory for unusually large collections. The map uses fill
  // only, so retaining exact cells here still exposes no internal grid lines.
  if (width * height > 1_000_000) {
    return rectangles.map(([w, s, e, n]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]]);
  }
  const xi = new Map(xs.map((x, i) => [x, i])), yi = new Map(ys.map((y, i) => [y, i]));
  const cells = new Int32Array(width * height);
  for (const [w, s, e, n] of rectangles) {
    const a = xi.get(w)!, b = xi.get(e)!, c = yi.get(s)!, d = yi.get(n)!;
    cells[c * width + a]++; cells[c * width + b]--;
    cells[d * width + a]--; cells[d * width + b]++;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    cells[i] += (x ? cells[i - 1] : 0) + (y ? cells[i - width] : 0) - (x && y ? cells[i - width - 1] : 0);
  }
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < width - 1 && y < height - 1 && cells[y * width + x] > 0;
  const edges = new Map<number, Set<number>>();
  function edge(a: number, b: number) {
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a)!.add(b);
  }
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    if (!filled(x, y)) continue;
    const a = y * width + x, b = a + 1, d = a + width, c = d + 1;
    if (!filled(x, y - 1)) edge(a, b);
    if (!filled(x + 1, y)) edge(b, c);
    if (!filled(x, y + 1)) edge(c, d);
    if (!filled(x - 1, y)) edge(d, a);
  }
  const direction = (a: number, b: number) => b === a + 1 ? 0 : b === a + width ? 1 : b === a - 1 ? 2 : 3;
  const loops: Ring[] = [];
  while (edges.size) {
    const start = edges.keys().next().value!;
    let a = start, b = edges.get(a)!.values().next().value!;
    const vertices = [a];
    do {
      const heading = direction(a, b);
      edges.get(a)!.delete(b);
      if (!edges.get(a)!.size) edges.delete(a);
      vertices.push(b);
      if (b === start) break;
      const next = edges.get(b);
      if (!next?.size) throw new Error('Open restriction boundary');
      // Left turns keep diagonally touching components as separate polygons.
      const rank = (c: number) => [1, 0, 3, 2][(direction(b, c) - heading + 4) % 4];
      const c = [...next].sort((p, q) => rank(p) - rank(q))[0];
      a = b; b = c;
    } while (true);
    const open = vertices.slice(0, -1).filter((v, i, list) => {
      const previous = list[(i + list.length - 1) % list.length], next = list[(i + 1) % list.length];
      return direction(previous, v) !== direction(v, next);
    });
    const points = open.map(v => [xs[v % width], ys[Math.floor(v / width)]] as Point);
    points.push(points[0]); loops.push(points);
  }
  const polygons = loops.filter(ring => area(ring) > 0).map(ring => [ring]);
  for (const hole of loops.filter(ring => area(ring) < 0)) {
    const outer = polygons.filter(p => contains(p[0], hole[0])).sort((a, b) => area(a[0]) - area(b[0]))[0];
    if (outer) outer.push(hole);
  }
  return polygons;
}

export function restrictionZoneFeatures(restrictions: RoutingRestriction[], repaired: ReadonlySet<string>): ZoneFeature[] {
  const features: ZoneFeature[] = [];
  for (const selected of [false, true]) {
    const rectangles: Rectangle[] = [];
    for (const item of restrictions) {
      if (repaired.has(item.facility_id) !== selected) continue;
      for (const ring of item.exclusion_rings) {
        const rect = rectangle(ring);
        if (rect) rectangles.push(rect);
        else features.push({ type: 'Feature', properties: { repaired: selected }, geometry: { type: 'Polygon', coordinates: [ring] } });
      }
    }
    for (const coordinates of unionRestrictionRectangles(rectangles)) {
      features.push({ type: 'Feature', properties: { repaired: selected }, geometry: { type: 'Polygon', coordinates } });
    }
  }
  return features;
}
