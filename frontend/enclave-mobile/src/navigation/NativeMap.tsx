import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SkeletonMap } from '../components/DataSkeleton';
import { Map as MapLibreMap, GeoJSONSource, Layer, type MapProps } from '@maplibre/maplibre-react-native';
import { loadNativeMapStyle, normalizeNativeMapStyle, type NativeMapStyle } from './nativeMapStyle';

/** Load and correct the basemap before passing it to the native renderer. */
export function NativeMap({ mapStyle, style, children, serviceAreaBounds, ...props }: MapProps & { serviceAreaBounds?: readonly [number, number, number, number] }) {
  const remoteUrl = typeof mapStyle === 'string' && /^https?:\/\//i.test(mapStyle) ? mapStyle : null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    url: string; attempt: number; value?: NativeMapStyle; failed?: boolean;
  } | null>(null);
  const inlineStyle = useMemo(() => typeof mapStyle === 'object' ? normalizeNativeMapStyle(mapStyle) : mapStyle, [mapStyle]);

  useEffect(() => {
    if (!remoteUrl) return;
    let active = true;
    void loadNativeMapStyle(remoteUrl).then(
      value => { if (active) setResult({ url: remoteUrl, attempt, value }); },
      () => { if (active) setResult({ url: remoteUrl, attempt, failed: true }); },
    );
    return () => { active = false; };
  }, [remoteUrl, attempt]);

  const current = result?.url === remoteUrl && result.attempt === attempt ? result : null;
  if (remoteUrl && !current?.value) {
    return <View style={[s.placeholder, style]}>
      {current?.failed ? <>
        <Text style={s.message}>Unable to load the map. Check your connection.</Text>
        <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={s.retry}>
          <Text style={s.retryText}>Retry map</Text>
        </Pressable>
      </> : <SkeletonMap />}
    </View>;
  }
  if (!serviceAreaBounds) return <MapLibreMap {...props} style={style} mapStyle={current?.value ?? inlineStyle}>{children}</MapLibreMap>;
  return <MapLibreMap {...props} style={style} mapStyle={current?.value ?? inlineStyle}>
    {serviceAreaBounds && <GeoJSONSource id="service-area-boundary" data={{ type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [
        [serviceAreaBounds[0], serviceAreaBounds[1]], [serviceAreaBounds[2], serviceAreaBounds[1]],
        [serviceAreaBounds[2], serviceAreaBounds[3]], [serviceAreaBounds[0], serviceAreaBounds[3]],
        [serviceAreaBounds[0], serviceAreaBounds[1]],
      ] },
    }}>
      <Layer id="service-area-boundary-line" type="line" paint={{ 'line-color': '#526987', 'line-width': 2.5, 'line-dasharray': [4, 3], 'line-opacity': 0.95 }} />
    </GeoJSONSource>}
    {children}
  </MapLibreMap>;
}

const s = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f4f0' },
  message: { color: '#20304d', textAlign: 'center', padding: 16 },
  retry: { padding: 12 },
  retryText: { color: '#087f86', fontWeight: '600' },
});
