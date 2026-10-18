import { meters, type Coordinate, type Route } from './network';

export const MAX_GUIDANCE_ACCURACY_METERS = 25;
export const ARRIVAL_RADIUS_METERS = 20;
export const REROUTE_COOLDOWN_MS = 30000;
export type InstructionKind = 'left' | 'right' | 'uturn' | 'crossing' | 'arrive' | 'continue';
export type Instruction = { text: string; coordinate: Coordinate; at: number; kind: InstructionKind };
export type NavigationModel = { coordinates: Coordinate[]; cumulative: number[]; total: number; instructions: Instruction[] };

export function geometryDistances(points: Coordinate[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + meters(points[i - 1], points[i]));
  return cumulative;
}

function instructionKind(text: string, type?: number): InstructionKind {
  if (/arriv|destination reached/i.test(text) || type === 4) return 'arrive';
  if (/u[ -]?turn|turn around/i.test(text)) return 'uturn';
  if (/\bcross\b|crossing/i.test(text)) return 'crossing';
  if (/\bleft\b/i.test(text)) return 'left';
  if (/\bright\b/i.test(text)) return 'right';
  return 'continue';
}

export function navigationModel(route: Route): NavigationModel {
  const coordinates = route.coordinates;
  const cumulative = geometryDistances(coordinates), total = cumulative.at(-1) ?? 0;
  let instructions: Instruction[] = (route.maneuvers ?? []).map(step => ({
    text: step.instruction, coordinate: step.coordinate,
    at: Math.max(0, Math.min(total, step.distanceFromStart)), kind: instructionKind(step.instruction, step.type),
  })).filter(step => step.kind !== 'continue');
  // Older cached demo routes have no backend maneuvers. Derive turns from their
  // actual polyline, never from the bearing to a destination across buildings.
  if (!route.maneuvers?.length) {
    instructions = [];
    for (let i = 1; i < coordinates.length - 1; i++) {
      const [a, b, c] = coordinates.slice(i - 1, i + 2);
      const scale = Math.cos(b[1] * Math.PI / 180);
      const x = (b[0] - a[0]) * scale, y = b[1] - a[1];
      const u = (c[0] - b[0]) * scale, v = c[1] - b[1];
      const turn = Math.atan2(x * v - y * u, x * u + y * v) * 180 / Math.PI;
      if (Math.abs(turn) < 35) continue;
      const kind = Math.abs(turn) > 150 ? 'uturn' : turn > 0 ? 'left' : 'right';
      instructions.push({ text: kind === 'uturn' ? 'Turn around along the mapped route.' : `Turn ${kind}.`, kind, at: cumulative[i], coordinate: b });
    }
  }
  instructions = instructions.filter(step => step.kind !== 'arrive').sort((a, b) => a.at - b.at);
  instructions.push({ text: 'You have arrived at the end of the mapped route.', kind: 'arrive', at: total, coordinate: coordinates.at(-1)! });
  return { coordinates, cumulative, total, instructions };
}

export type RouteMatch = { along: number; deviation: number; coordinate: Coordinate };
export function matchPosition(model: NavigationModel, point: Coordinate, previous: number | null, elapsedSeconds = 0): RouteMatch {
  const scale = Math.cos(point[1] * Math.PI / 180);
  const candidates: RouteMatch[] = [];
  const lower = previous === null ? 0 : Math.max(0, previous - 25);
  const upper = previous === null ? model.total : Math.min(model.total, previous + Math.max(40, Math.min(180, elapsedSeconds * 3)));
  for (let i = 1; i < model.coordinates.length; i++) {
    const length = model.cumulative[i] - model.cumulative[i - 1];
    if (length < .01 || model.cumulative[i] < lower || model.cumulative[i - 1] > upper) continue;
    const a = model.coordinates[i - 1], b = model.coordinates[i];
    const x = (b[0] - a[0]) * scale, y = b[1] - a[1];
    const fraction = Math.max(Math.max(0, (lower - model.cumulative[i - 1]) / length),
      Math.min(Math.min(1, (upper - model.cumulative[i - 1]) / length),
        (((point[0] - a[0]) * scale * x + (point[1] - a[1]) * y) / (x * x + y * y)) || 0));
    const coordinate: Coordinate = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
    candidates.push({ along: model.cumulative[i - 1] + length * fraction, deviation: meters(point, coordinate), coordinate });
  }
  candidates.sort((a, b) => a.deviation - b.deviation);
  const nearest = candidates[0];
  if (!nearest) return { along: previous ?? 0, deviation: Infinity, coordinate: model.coordinates[0] };
  // Prefer the earlier/local part of a loop when several segments are equally
  // plausible. Progress cannot jump to a nearby parallel leg hundreds of m ahead.
  const plausible = candidates.filter(item => item.deviation <= nearest.deviation + (previous === null ? 8 : 2.5));
  plausible.sort((a, b) => previous === null ? a.along - b.along : Math.abs(a.along - previous) - Math.abs(b.along - previous));
  return plausible[0];
}

export function nextInstruction(model: NavigationModel, progress: number): Instruction {
  return model.instructions.find(step => step.at >= progress - 5) ?? model.instructions.at(-1)!;
}

export type TurnArrival = { index: number; hits: number; since: number };
// A resident can stop at a junction. Do not require walking five metres past it
// before showing the next instruction. Two precise fixes confirm arrival; an
// unmarked crossing still stays active until progress passes the crossing start.
export function advanceInstruction(model: NavigationModel, index: number, progress: number,
  point: Coordinate, accuracy: number, time: number, previous: TurnArrival) {
  let next = index;
  while (next < model.instructions.length - 1 && progress > model.instructions[next].at + 5) next++;
  const step = model.instructions[next];
  const near = step.kind !== 'arrive' && step.kind !== 'crossing' && accuracy <= 15
    && Math.abs(progress - step.at) <= 10 && meters(point, step.coordinate) <= 10;
  let arrival: TurnArrival = { index: next, hits: 0, since: time };
  if (near) {
    arrival = { index: next, hits: previous.index === next ? previous.hits + 1 : 1,
      since: previous.index === next && previous.hits ? previous.since : time };
    if (arrival.hits >= 2 && time - arrival.since >= 2000) {
      next++; arrival = { index: next, hits: 0, since: time };
    }
  }
  return { index: next, arrival };
}

export type OffRouteEvidence = { hits: number; since: number; lastAttempt: number | null };
export function offRouteEvidence(previous: OffRouteEvidence, deviation: number, accuracy: number | null, time: number) {
  const reliable = accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_GUIDANCE_ACCURACY_METERS;
  const offRoute = reliable && deviation > Math.max(30, accuracy * 2);
  const evidence: OffRouteEvidence = {
    hits: offRoute ? previous.hits + 1 : 0,
    since: offRoute ? previous.hits ? previous.since : time : 0,
    lastAttempt: previous.lastAttempt,
  };
  const shouldReroute = offRoute && evidence.hits >= 3 && time - evidence.since >= 8000
    && (evidence.lastAttempt === null || time - evidence.lastAttempt >= REROUTE_COOLDOWN_MS);
  return { evidence, offRoute, shouldReroute };
}
