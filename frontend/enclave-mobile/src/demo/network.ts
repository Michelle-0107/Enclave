import raw from './kl-east-demo.json';

export type Coordinate = [number, number];
export type Mode = 'shortest' | 'avoid_damage' | 'accessible';
export type TravelProfile = 'walking' | 'wheelchair';
export type Transport = TravelProfile | 'driving';
export type Facility = {
  id: string; name: string; kind: string; coordinate: Coordinate; damaged: boolean; reporters: number;
  source: 'fictional_facility'; edgeId: string; restrictionRadiusMeters: number; gridCell: number[];
};
export type Landmark = { id: string; name: string; coordinate: Coordinate; osmType: 'node' | 'way'; osmId: string; positionBasis: string };
export type Edge = {
  id: string; start: string; end: string; facilityId: string | null; mappedHasSteps: boolean; baseStepFree: boolean;
  direction: 'both' | 'forward' | 'backward'; geometry: Coordinate[]; osmNodeIds: string[]; osmWayId: string;
  highway: string; layer: string; roadName: string; accessBasis: 'fictional_demo_assumption';
};
export type Dataset = {
  version: 3; source: 'osm_roads_with_fictional_facilities'; fieldVerified: false; name: string;
  bbox: [number, number, number, number]; center: Coordinate; styleUrl: string;
  nodes: { id: string; coordinate: Coordinate }[]; edges: Edge[]; facilities: Facility[]; landmarks: Landmark[];
  provenance: { geometrySource: 'OpenStreetMap'; sourceXmlSha256: string; license: 'ODbL-1.0';
    downloadedAt: string; attribution: string; extractUrl: string; networkScope: string; routingAccess: string };
};
export type Scenario = { repairedIds: string[]; reporterCounts: Record<string, number> };
export type Snap = { edgeId: string; coordinate: Coordinate; distance: number; offset: number };
export type Selection = { label: string; coordinate: Coordinate; snap: Snap };
export type Segment = {
  id: string; sourceEdgeId: string; start: string; end: string; geometry: Coordinate[]; distance: number;
  facilityId: string | null; hasSteps: boolean; stepFree: boolean; roadName: string; direction: Edge['direction'];
};
export type Route = {
  id?: string;
  maneuvers?: { instruction: string; coordinate: Coordinate; distanceFromStart: number; type?: number }[];
  profile: TravelProfile;
  mode: Mode; distance: number; seconds: number; coordinates: Coordinate[]; segments: Segment[];
  facilities: Facility[]; originSnap: Snap; destinationSnap: Snap;
  dataSource: Dataset['source']; fieldVerified: false;
};
export type ModeResult = { mode: Mode; route: Route | null; unavailableReason?: string };
export const modes: Mode[] = ['shortest', 'avoid_damage', 'accessible'];
export const labels: Record<Mode, string> = {
  shortest: 'Shortest route', avoid_damage: 'Avoid damaged facilities', accessible: 'Verified step-free route',
};

export function meters(a: Coordinate, b: Coordinate): number {
  const radians = (n: number) => n * Math.PI / 180;
  const q = Math.sin(radians(b[1] - a[1]) / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 12742017.6 * Math.asin(Math.min(1, Math.sqrt(q)));
}
export function insidePilot(point: Coordinate, data: Dataset): boolean {
  return point.length === 2 && point.every(Number.isFinite) && point[0] >= data.bbox[0] && point[0] <= data.bbox[2] && point[1] >= data.bbox[1] && point[1] <= data.bbox[3];
}
function project(point: Coordinate, a: Coordinate, b: Coordinate) {
  const scale = Math.cos(point[1] * Math.PI / 180);
  const x = (b[0] - a[0]) * scale, y = b[1] - a[1];
  const t = Math.max(0, Math.min(1, (((point[0] - a[0]) * scale * x + (point[1] - a[1]) * y) / (x * x + y * y)) || 0));
  const coordinate: Coordinate = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { coordinate, t, distance: meters(point, coordinate) };
}
export function validateDataset(data: Dataset): Dataset {
  if (data.version !== 3 || data.source !== 'osm_roads_with_fictional_facilities' || data.fieldVerified !== false ||
      data.provenance.geometrySource !== 'OpenStreetMap' || data.provenance.license !== 'ODbL-1.0' || !/^[a-f0-9]{64}$/.test(data.provenance.sourceXmlSha256) ||
      !Array.isArray(data.bbox) || data.bbox.length !== 4 || !data.bbox.every(Number.isFinite) ||
      data.bbox[0] < -180 || data.bbox[2] > 180 || data.bbox[1] < -90 || data.bbox[3] > 90 ||
      data.bbox[0] >= data.bbox[2] || data.bbox[1] >= data.bbox[3] || !insidePilot(data.center, data)) throw new Error('Invalid pilot dataset provenance.');
  const nodes = new Map(data.nodes.map(n => [n.id, n]));
  const facilities = new Map(data.facilities.map(f => [f.id, f]));
  if (!data.edges.length || nodes.size !== data.nodes.length || facilities.size !== data.facilities.length || new Set(data.edges.map(e => e.id)).size !== data.edges.length) throw new Error('Invalid dataset identifiers.');
  for (const n of data.nodes) if (!insidePilot(n.coordinate, data)) throw new Error('Invalid mapped junction.');
  for (const e of data.edges) {
    if (!nodes.has(e.start) || !nodes.has(e.end) || e.start === e.end || e.geometry.length < 2 || e.geometry.length !== e.osmNodeIds.length ||
        e.geometry.some(p => !insidePilot(p, data)) || JSON.stringify(e.geometry[0]) !== JSON.stringify(nodes.get(e.start)!.coordinate) ||
        JSON.stringify(e.geometry.at(-1)) !== JSON.stringify(nodes.get(e.end)!.coordinate) || e.osmNodeIds[0] !== e.start || e.osmNodeIds.at(-1) !== e.end ||
        (e.facilityId !== null && !facilities.has(e.facilityId)) || !/^\d+$/.test(e.osmWayId) ||
        !['both', 'forward', 'backward'].includes(e.direction) || typeof e.mappedHasSteps !== 'boolean' || typeof e.baseStepFree !== 'boolean' ||
        (e.mappedHasSteps && e.baseStepFree) || e.accessBasis !== 'fictional_demo_assumption') throw new Error('Invalid mapped segment.');
  }
  for (const f of data.facilities) {
    const e = data.edges.find(item => item.id === f.edgeId && item.facilityId === f.id);
    if (!e || !insidePilot(f.coordinate, data) || f.source !== 'fictional_facility' || !Number.isInteger(f.reporters) || f.reporters < 0 ||
        !Number.isFinite(f.restrictionRadiusMeters) || f.restrictionRadiusMeters <= 0 || f.restrictionRadiusMeters > 10 ||
        !e.geometry.slice(1).some((p, i) => project(f.coordinate, e.geometry[i], p).distance < 0.02)) throw new Error('Invalid fictional facility.');
  }
  for (const p of data.landmarks) if (!insidePilot(p.coordinate, data) || !p.name || !/^\d+$/.test(p.osmId)) throw new Error('Invalid real landmark.');
  return data;
}
export const dataset = validateDataset(raw as Dataset);
export function initialScenario(data = dataset): Scenario {
  return { repairedIds: [], reporterCounts: Object.fromEntries(data.facilities.map(f => [f.id, f.reporters])) };
}
export function isBlocked(f: Facility, state: Scenario): boolean {
  return f.damaged && !state.repairedIds.includes(f.id) && (state.reporterCounts[f.id] ?? f.reporters) >= 2;
}
type Geometry = { lengths: number[]; total: number };
const geometryCache = new WeakMap<Edge, Geometry>();
function measured(edge: Edge): Geometry {
  const cached = geometryCache.get(edge); if (cached) return cached;
  const lengths = [0];
  for (let i = 1; i < edge.geometry.length; i++) lengths.push(lengths[i - 1] + meters(edge.geometry[i - 1], edge.geometry[i]));
  const value = { lengths, total: lengths.at(-1)! }; geometryCache.set(edge, value); return value;
}
function nearestOnEdge(point: Coordinate, edge: Edge): Snap {
  const { lengths } = measured(edge); let best: Snap | undefined;
  for (let i = 1; i < edge.geometry.length; i++) {
    const p = project(point, edge.geometry[i - 1], edge.geometry[i]);
    if (!best || p.distance < best.distance) best = { edgeId: edge.id, coordinate: p.coordinate, distance: p.distance, offset: lengths[i - 1] + (lengths[i] - lengths[i - 1]) * p.t };
  }
  return best!;
}
export function snapToRoad(point: Coordinate, data = dataset): Snap {
  if (!insidePilot(point, data)) throw new Error('Select a point inside the current service area.');
  let best: Snap | undefined;
  for (const e of data.edges) { const candidate = nearestOnEdge(point, e); if (!best || candidate.distance < best.distance - 0.000001) best = candidate; }
  if (!best || best.distance > 40) throw new Error('No mapped road access within 40 m. Please choose a nearby road or footpath.');
  return best;
}
export function selectLocation(label: string, coordinate: Coordinate, data = dataset): Selection {
  return { label, coordinate, snap: snapToRoad(coordinate, data) };
}
export function searchPlaces(query: string, data = dataset): Landmark[] {
  const value = query.trim().toLocaleLowerCase(); if (value.length < 2) return [];
  const pair = value.split(',').map(s => Number(s.trim()));
  if (pair.length === 2 && pair.every(Number.isFinite)) {
    const coordinate: Coordinate = [pair[1], pair[0]];
    return insidePilot(coordinate, data) ? [{ id: 'coordinate-search', name: `${pair[0].toFixed(6)}, ${pair[1].toFixed(6)}`, coordinate, osmType: 'node', osmId: '0', positionBasis: 'User-entered coordinate' }] : [];
  }
  return data.landmarks.filter(p => p.name.toLocaleLowerCase().includes(value)).sort((a, b) => Number(!a.name.toLocaleLowerCase().startsWith(value)) - Number(!b.name.toLocaleLowerCase().startsWith(value)) || a.name.localeCompare(b.name)).slice(0, 6);
}
function pointAt(edge: Edge, offset: number): Coordinate {
  const { lengths, total } = measured(edge);
  if (offset <= 0) return edge.geometry[0]; if (offset >= total) return edge.geometry.at(-1)!;
  const i = lengths.findIndex(n => n >= offset);
  const t = (offset - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
  return [edge.geometry[i - 1][0] + t * (edge.geometry[i][0] - edge.geometry[i - 1][0]), edge.geometry[i - 1][1] + t * (edge.geometry[i][1] - edge.geometry[i - 1][1])];
}
function sliceGeometry(edge: Edge, from: number, to: number): Coordinate[] {
  return [pointAt(edge, from), ...edge.geometry.filter((_, i) => measured(edge).lengths[i] > from + 0.000001 && measured(edge).lengths[i] < to - 0.000001), pointAt(edge, to)];
}
type Arc = { next: string; segment: Segment; reverse: boolean };
function prepare(origin: Snap, target: Snap, data: Dataset) {
  const adjacency = new Map<string, Arc[]>(); let start = '', end = '';
  const facilities = new Map(data.facilities.map(f => [f.id, f]));
  for (const edge of data.edges) {
    const total = measured(edge).total;
    const f = edge.facilityId ? facilities.get(edge.facilityId) : undefined;
    const position = f ? nearestOnEdge(f.coordinate, edge).offset : 0;
    const low = f ? Math.max(0, position - f.restrictionRadiusMeters) : -1;
    const high = f ? Math.min(total, position + f.restrictionRadiusMeters) : -1;
    const values = [0, total];
    if (f) values.push(low, high);
    if (origin.edgeId === edge.id) values.push(origin.offset);
    if (target.edgeId === edge.id) values.push(target.offset);
    const cuts = [...new Set(values)].sort((a, b) => a - b);
    const nodeId = (offset: number) => offset <= 0.000001 ? edge.start : offset >= total - 0.000001 ? edge.end : `${edge.id}@${offset.toFixed(9)}`;
    if (origin.edgeId === edge.id) start = nodeId(origin.offset);
    if (target.edgeId === edge.id) end = nodeId(target.offset);
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1], to = cuts[i]; if (to - from < 0.000001) continue;
      const contains = Boolean(f && (from + to) / 2 >= low && (from + to) / 2 <= high);
      const hasSteps = edge.mappedHasSteps || (contains && f?.kind === 'stairs');
      const geometry = sliceGeometry(edge, from, to);
      const segment: Segment = { id: `${edge.id}:${i}`, sourceEdgeId: edge.id, start: nodeId(from), end: nodeId(to), geometry,
        distance: geometry.slice(1).reduce((sum, p, j) => sum + meters(geometry[j], p), 0), facilityId: contains ? f!.id : null,
        hasSteps, stepFree: edge.baseStepFree && !hasSteps, roadName: edge.roadName, direction: edge.direction };
      if (!adjacency.has(segment.start)) adjacency.set(segment.start, []);
      if (!adjacency.has(segment.end)) adjacency.set(segment.end, []);
      if (edge.direction !== 'backward') adjacency.get(segment.start)!.push({ next: segment.end, segment, reverse: false });
      if (edge.direction !== 'forward') adjacency.get(segment.end)!.push({ next: segment.start, segment, reverse: true });
    }
  }
  return { adjacency, start, end, facilities };
}
// Binary heap keeps arbitrary area-wide requests O((V+E) log V), rather than sorting all nodes each step.
class Queue {
  items: { node: string; cost: number }[] = [];
  push(item: { node: string; cost: number }) {
    this.items.push(item); let i = this.items.length - 1;
    while (i > 0) { const parent = (i - 1) >> 1; if (this.items[parent].cost <= item.cost) break; this.items[i] = this.items[parent]; i = parent; } this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length && last) { let i = 0;
      while (i * 2 + 1 < this.items.length) { let child = i * 2 + 1; if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child++;
        if (this.items[child].cost >= last.cost) break; this.items[i] = this.items[child]; i = child; } this.items[i] = last;
    }
    return first;
  }
}
function routeThrough(graph: ReturnType<typeof prepare>, mode: Mode, state: Scenario, origin: Snap, target: Snap, data: Dataset): Route | null {
  const { start, end, adjacency, facilities } = graph;
  if (start === end) throw new Error('Choose two different road access points.');
  const best = new Map([[start, 0]]); const previous = new Map<string, { from: string; arc: Arc }>();
  const queue = new Queue(); queue.push({ node: start, cost: 0 });
  while (queue.items.length) {
    const current = queue.pop(); if (current.cost !== best.get(current.node)) continue;
    if (current.node === end) break;
    for (const arc of adjacency.get(current.node) ?? []) {
      const f = arc.segment.facilityId ? facilities.get(arc.segment.facilityId) : undefined;
      if (mode !== 'shortest' && f && isBlocked(f, state)) continue;
      if (mode === 'accessible' && (arc.segment.hasSteps || !arc.segment.stepFree)) continue;
      const cost = current.cost + arc.segment.distance;
      if (cost < (best.get(arc.next) ?? Infinity)) { best.set(arc.next, cost); previous.set(arc.next, { from: current.node, arc }); queue.push({ node: arc.next, cost }); }
    }
  }
  if (!previous.has(end)) return null;
  const parts: Arc[] = []; let cursor = end;
  while (cursor !== start) { const item = previous.get(cursor)!; parts.unshift(item.arc); cursor = item.from; }
  const coordinates: Coordinate[] = [];
  for (const part of parts) { const p = part.reverse ? [...part.segment.geometry].reverse() : part.segment.geometry; coordinates.push(...(coordinates.length ? p.slice(1) : p)); }
  const ids = new Set(parts.map(p => p.segment.facilityId).filter((id): id is string => Boolean(id)));
  return { profile: 'walking', mode, distance: best.get(end)!, seconds: best.get(end)! / 1.2, coordinates, segments: parts.map(p => p.segment),
    facilities: [...ids].map(id => facilities.get(id)!), originSnap: origin, destinationSnap: target, dataSource: data.source, fieldVerified: false };
}
export function calculateRoutes(origin: Coordinate, destination: Coordinate, data = dataset, state = initialScenario(data)): ModeResult[] {
  if (meters(origin, destination) < 5) throw new Error('Choose locations at least 5 m apart.');
  // All modes use the SAME closest mapped access points. Never jump over a blocked edge to force a route.
  const from = snapToRoad(origin, data), to = snapToRoad(destination, data);
  if (meters(from.coordinate, to.coordinate) < 0.05) throw new Error('Choose two different road access points.');
  if (state.repairedIds.some(id => !data.facilities.some(f => f.id === id && f.damaged))) throw new Error('Unknown facility repair.');
  const graph = prepare(from, to, data);
  return modes.map(mode => ({ mode, route: routeThrough(graph, mode, state, from, to, data) }));
}

// Wheelchair travel never falls back to a shorter walking route containing stairs.
// "Verified" is the product option name; this bundled dataset models verification
// with fictional access assumptions. Every returned route remains fieldVerified=false.
export function calculateProfileRoutes(profile: TravelProfile, origin: Coordinate, destination: Coordinate, data = dataset): ModeResult[] {
  if (profile !== 'walking' && profile !== 'wheelchair') throw new Error('Driving requires a driving directions provider.');
  const results = calculateRoutes(origin, destination, data);
  return results.filter(item => profile === 'walking' || item.mode === 'accessible').map(item => ({ ...item,
    route: item.route ? { ...item.route, profile, seconds: item.route.distance / (profile === 'wheelchair' ? 0.9 : 1.2) } : null }));
}

// Explicit access planning keeps alternative anchors separate from the user's pins.
export function nearbyAccessPoints(point: Coordinate, data = dataset, radius = 120, limit = 6): Snap[] {
  if (!insidePilot(point, data)) throw new Error('Select a point inside the current service area.');
  const sorted = data.edges.map(edge => nearestOnEdge(point, edge)).filter(snap => snap.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  const result: Snap[] = [];
  for (const snap of sorted) {
    if (result.some(other => meters(snap.coordinate, other.coordinate) < 8)) continue;
    result.push(snap); if (result.length === limit) break;
  }
  return result;
}
export function routesBetweenAccessPoints(profile: TravelProfile, from: Snap, to: Snap, data = dataset): ModeResult[] {
  if (profile !== 'walking' && profile !== 'wheelchair') throw new Error('Invalid walking profile.');
  const graph = prepare(from, to, data), state = initialScenario(data);
  return modes.filter(mode => profile === 'walking' || mode === 'accessible').map(mode => {
    const route = routeThrough(graph, mode, state, from, to, data);
    return { mode, route: route ? { ...route, profile, seconds: route.distance / (profile === 'wheelchair' ? 0.9 : 1.2) } : null };
  });
}
