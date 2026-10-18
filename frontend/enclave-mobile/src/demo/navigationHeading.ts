import { meters, type Coordinate } from './network';

export type MotionFix = { coordinate: Coordinate; accuracy: number; timestamp: number; course: number | null; speed: number | null };
export type HeadingState = { anchor: MotionFix | null; heading: number | null; timestamp: number };
export const normalizeHeading = (degrees: number) => (degrees % 360 + 360) % 360;
export const markerRotation = (heading: number, mapBearing: number) => normalizeHeading(heading - mapBearing);
export function movementHeading(previous: HeadingState, fix: MotionFix): HeadingState {
  if (fix.timestamp <= previous.timestamp || fix.accuracy > 25) return previous;
  let heading = previous.heading, anchor = previous.anchor;
  if (fix.course !== null && Number.isFinite(fix.course) && fix.course >= 0 && fix.course < 360
      && fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= .5) heading = fix.course;
  else if (anchor) {
    const gap = meters(anchor.coordinate, fix.coordinate), seconds = (fix.timestamp - anchor.timestamp) / 1000;
    if (seconds > 20) anchor = null;
    else if (fix.accuracy <= 15 && anchor.accuracy <= 15 && seconds >= 2
        && gap >= Math.max(4, fix.accuracy, anchor.accuracy) && gap / seconds <= 3.5) {
      const a = anchor.coordinate, b = fix.coordinate;
      heading = normalizeHeading(Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI);
      anchor = fix;
    }
  }
  return { anchor: anchor ?? fix, heading, timestamp: fix.timestamp };
}
