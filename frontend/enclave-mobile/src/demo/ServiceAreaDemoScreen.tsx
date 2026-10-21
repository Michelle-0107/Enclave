import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { demoAreasApi, type ResidentServiceArea } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { SkeletonMap, SkeletonBlock } from '../components/DataSkeleton';
import DemoMapScreen from './DemoMapScreen';
import { dataset as builtInSnapshot, validateDataset, type Dataset } from './network';

type Props = { onShowLiveMap: () => void; onReportPress?: () => void; onMapTouchChange?: (active: boolean) => void };

async function accessToken() {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !data.session?.access_token) throw new Error('Sign in again to load service areas.');
  return data.session.access_token;
}
async function readArea(area: ResidentServiceArea, token: string) {
  const response = await demoAreasApi.getDataset(token, area.id);
  const data = validateDataset(response.dataset as Dataset);
  if (response.area_id !== area.id || JSON.stringify(data.bbox) !== JSON.stringify(area.bbox)) {
    throw new Error('The map data does not match the selected service area.');
  }
  return { id: area.id, dataset: data };
}

export default function ServiceAreaDemoScreen(props: Props) {
  const [areas, setAreas] = useState<ResidentServiceArea[]>([]);
  const [current, setCurrent] = useState<{ id: string; dataset: Dataset } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const version = useRef(0);
  const busy = useRef(false);
  const currentId = useRef<string | null>(null);
  const loadAreas = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const request = ++version.current;
    try {
      const token = await accessToken();
      if (request !== version.current) return;
      const catalog = await demoAreasApi.getAll(token);
      if (request !== version.current) return;
      if (!Array.isArray(catalog.items) || catalog.items.length > 100) throw new Error('Invalid service-area response.');
      const available = catalog.items.filter(area => area.enabled && area.resident_demo_supported);
      if (!available.length || new Set(available.map(area => area.id)).size !== available.length) throw new Error('No demo service areas are currently available.');
      const first = available.find(area => area.id === currentId.current) ?? available.find(area => area.id === catalog.default_area_id) ?? available[0];
      const loaded = await readArea(first, token);
      if (request !== version.current) return;
      currentId.current = loaded.id;
      setAreas(available); setCurrent(loaded);
    } catch (failure) {
      if (request !== version.current) return;
      // Retain the existing offline snapshot while an older/offline server cannot
      // provide the new catalog. The UI explicitly labels this as a cached map.
      setError(failure instanceof Error ? failure.message : 'Could not load service areas.');
      setCurrent(previous => previous ?? { id: 'built-in-snapshot', dataset: builtInSnapshot });
    } finally {
      if (request === version.current) { busy.current = false; setLoading(false); }
    }
  }, []);
  function retryAreas() {
    if (busy.current) return;
    setLoading(true); setError('');
    void loadAreas();
  }
  async function selectArea(area: ResidentServiceArea) {
    if (busy.current || area.id === current?.id) return;
    busy.current = true;
    const request = ++version.current;
    props.onMapTouchChange?.(false);
    setLoading(true); setError('');
    try {
      const loaded = await readArea(area, await accessToken());
      if (request === version.current) { currentId.current = loaded.id; setCurrent(loaded); }
    } catch (failure) {
      if (request === version.current) setError(failure instanceof Error ? failure.message : 'Could not load this service area.');
    } finally {
      if (request === version.current) { busy.current = false; setLoading(false); }
    }
  }

  useEffect(() => {
    let active = true;
    // Schedule asynchronous discovery after effect registration; cancelled mounts
    // must not start a request or update the loading UI.
    void Promise.resolve().then(() => { if (active) return loadAreas(); });
    return () => { active = false; version.current += 1; busy.current = false; };
  }, [loadAreas]);

  return <View style={styles.container}>
    <Text style={styles.label}>Service area</Text>
    <View style={styles.areas}>
      {areas.map(area => <Pressable key={area.id} accessibilityRole="button" accessibilityLabel={`Service area: ${area.name}`}
        accessibilityState={{ selected: current?.id === area.id, disabled: loading }} disabled={loading}
        onPress={() => void selectArea(area)} style={[styles.area, current?.id === area.id && styles.selected]}>
        <Text style={styles.name}>{area.name}</Text>
      </Pressable>)}
    </View>
    {areas.length > 1 && <Text style={styles.hint}>Changing service area clears the current route.</Text>}
    {error ? <View style={styles.notice}>
      <Text accessibilityRole="alert" style={styles.hint}>{error}</Text>
      {current?.id === 'built-in-snapshot' && <Text style={styles.hint}>Using the built-in demo snapshot. Server service areas are unavailable.</Text>}
      <Pressable accessibilityRole="button" disabled={loading} onPress={retryAreas} style={styles.retry}><Text style={styles.name}>Retry service areas</Text></Pressable>
    </View> : null}
    {loading ? <View style={styles.loading}><SkeletonBlock width="60%" height={14} /><SkeletonMap /></View>
      : current && <DemoMapScreen key={current.id} {...props} areaId={current.id} data={current.dataset} />}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 10 }, label: { color: colors.muted, fontSize: 13 },
  areas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  area: { minHeight: 44, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  selected: { backgroundColor: colors.lavender, borderColor: colors.navy },
  name: { color: colors.navy, fontWeight: '700' }, hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  notice: { padding: 12, borderRadius: 12, backgroundColor: colors.lavender }, retry: { minHeight: 44, justifyContent: 'center' },
  loading: { padding: 24, gap: 12, alignItems: 'center' },
});
