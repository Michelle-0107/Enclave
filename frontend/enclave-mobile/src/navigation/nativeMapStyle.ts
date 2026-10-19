import type { MapProps } from '@maplibre/maplibre-react-native';

export type NativeMapStyle = Exclude<MapProps['mapStyle'], string>;

/** OpenFreeMap parks also contain label points, which cannot be drawn as lines. */
export function normalizeNativeMapStyle(style: NativeMapStyle): NativeMapStyle {
  return {
    ...style,
    layers: style.layers.map(layer => {
      if (layer.id !== 'park_outline' || layer.type !== 'line' || layer['source-layer'] !== 'park') return layer;
      const geometryFilter = ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false];
      return {
        ...layer,
        filter: (layer.filter ? ['all', layer.filter, geometryFilter] : geometryFilter) as typeof layer.filter,
      };
    }),
  };
}

const styles = new Map<string, Promise<NativeMapStyle>>();

/** Share downloads between screens; a failed download can be retried. */
export function loadNativeMapStyle(url: string): Promise<NativeMapStyle> {
  const cached = styles.get(url);
  if (cached) return cached;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Map style request failed (${response.status}).`);
      const style: NativeMapStyle = await response.json();
      if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) {
        throw new Error('The map service returned an invalid style.');
      }
      return normalizeNativeMapStyle(style);
    } finally {
      clearTimeout(timeout);
    }
  })();
  styles.set(url, request);
  void request.catch(() => {
    if (styles.get(url) === request) styles.delete(url);
  });
  return request;
}
