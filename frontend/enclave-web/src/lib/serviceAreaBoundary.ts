import type { Map } from 'maplibre-gl';

// Backend PILOT_BBOX used by the management What-if API.
export const PILOT_SERVICE_BOUNDS: [number, number, number, number] = [101.721, 3.217, 101.741, 3.235];

export function addServiceAreaBoundary(map: Map, bounds = PILOT_SERVICE_BOUNDS) {
  const [w, s, e, n] = bounds;
  const source = 'service-area-boundary';
  map.addSource(source, { type: 'geojson', data: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
  } });
  map.addLayer({ id: source, source, type: 'line',
    paint: { 'line-color': '#526987', 'line-width': 2.5, 'line-dasharray': [4, 3], 'line-opacity': 0.95 },
  });
}
