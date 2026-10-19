import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Map as MapLibreMap, type MapProps } from '@maplibre/maplibre-react-native';
import { loadNativeMapStyle, normalizeNativeMapStyle, type NativeMapStyle } from './nativeMapStyle';

/** Load and correct the basemap before passing it to the native renderer. */
export function NativeMap({ mapStyle, style, ...props }: MapProps) {
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
      </> : <ActivityIndicator accessibilityLabel="Loading map" color="#20304d" />}
    </View>;
  }
  return <MapLibreMap {...props} style={style} mapStyle={current?.value ?? inlineStyle} />;
}

const s = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f4f0' },
  message: { color: '#20304d', textAlign: 'center', padding: 16 },
  retry: { padding: 12 },
  retryText: { color: '#087f86', fontWeight: '600' },
});
