import type * as MapLibre from 'maplibre-gl';

type FacilityPin = { id: string; coordinate: [number, number]; label: string; description: string; color: string };

/** Facilities are rendered by the map's camera transform, never positioned DOM views. */
export function addFixedFacilityLayer(map: MapLibre.Map, api: Pick<typeof MapLibre, 'Popup'>, id: string, pins: FacilityPin[]) {
  if (!pins.length) return { showPopup(pinId: string) { void pinId; }, remove() {} };
  const index = new Map(pins.map(pin => [pin.id, pin]));
  const circle = id + '-circle', text = id + '-text', halo = id + '-halo';
  map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: pins.map(pin => ({
    type: 'Feature', id: pin.id, properties: { id: pin.id, label: pin.label, color: pin.color },
    geometry: { type: 'Point', coordinates: pin.coordinate },
  })) } });
  map.addLayer({ id: halo, source: id, type: 'circle', paint: { 'circle-radius': 20, 'circle-color': ['get', 'color'],
    'circle-opacity': 0.18, 'circle-translate': [0, 0], 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'viewport' } });
  map.addLayer({ id: circle, source: id, type: 'circle', paint: { 'circle-radius': 15, 'circle-color': ['get', 'color'],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-translate': [0, 0], 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'viewport' } });
  map.addLayer({ id: text, source: id, type: 'symbol', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'],
    'text-size': 13, 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-anchor': 'center',
    'text-pitch-alignment': 'map', 'text-rotation-alignment': 'map' }, paint: { 'text-color': '#ffffff' } });
  let popup: MapLibre.Popup | undefined;
  function showPopup(pinId: string) {
    const pin = index.get(pinId); if (!pin) return;
    popup?.remove();
    popup = new api.Popup({ offset: 20 }).setLngLat(pin.coordinate).setText(pin.description).addTo(map);
  }
  const click = (event: MapLibre.MapLayerMouseEvent) => {
    const pinId = event.features?.[0]?.properties?.id;
    if (typeof pinId === 'string') showPopup(pinId);
  };
  map.on('click', circle, click);
  return { showPopup, remove() {
    map.off('click', circle, click); popup?.remove();
    for (const layer of [text, circle, halo]) if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(id)) map.removeSource(id);
  } };
}
