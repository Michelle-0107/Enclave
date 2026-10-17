import { dataset, insidePilot, meters, type Coordinate } from './network';

// A real driving provider handles motor-vehicle access, one-way roads and turns.
// Never relabel the bundled pedestrian geometry as a car route.
export function drivingDirectionsUrl(origin: Coordinate, destination: Coordinate): string {
  if (!insidePilot(origin, dataset) || !insidePilot(destination, dataset)) throw new Error('Select both locations inside the KL East pilot area.');
  if (meters(origin, destination) < 5) throw new Error('Choose locations at least 5 m apart.');
  const value = (p: Coordinate) => encodeURIComponent(`${p[1]},${p[0]}`);
  return `https://www.google.com/maps/dir/?api=1&origin=${value(origin)}&destination=${value(destination)}&travelmode=driving&dir_action=navigate`;
}
