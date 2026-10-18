import { dataset, insidePilot, meters, type Coordinate, type Dataset } from './network';

// A real driving provider handles motor-vehicle access, one-way roads and turns.
// Never relabel the bundled pedestrian geometry as a car route.
export function drivingDirectionsUrl(origin: Coordinate, destination: Coordinate, data: Dataset = dataset): string {
  if (!insidePilot(origin, data) || !insidePilot(destination, data)) throw new Error('Select both locations inside the current service area.');
  if (meters(origin, destination) < 5) throw new Error('Choose locations at least 5 m apart.');
  const value = (p: Coordinate) => encodeURIComponent(`${p[1]},${p[0]}`);
  return `https://www.google.com/maps/dir/?api=1&origin=${value(origin)}&destination=${value(destination)}&travelmode=driving&dir_action=navigate`;
}
