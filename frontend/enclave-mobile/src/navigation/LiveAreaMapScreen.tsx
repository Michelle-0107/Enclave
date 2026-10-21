import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiError, demoAreasApi, navigationApi, type NavigationArea, type ResidentServiceArea } from '../lib/api';
import { supabase } from '../lib/supabase';
import MapScreen from '../screens/MapScreen';
import { colors } from '../theme';
import { SkeletonMap, SkeletonBlock } from '../components/DataSkeleton';

type Props = Omit<ComponentProps<typeof MapScreen>, 'navigationArea'>;

async function token() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Sign in again to load live service areas.');
  return data.session.access_token;
}

export default function LiveAreaMapScreen(props: Props) {
  const [areas, setAreas] = useState<ResidentServiceArea[]>([]);
  const [area, setArea] = useState<NavigationArea | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const version = useRef(0);
  const busy = useRef(false);

  async function discover() {
    if (busy.current) return;
    busy.current = true;
    const request = ++version.current;
    setLoading(true); setError('');
    try {
      const accessToken = await token();
      if (request !== version.current) return;
      let catalog;
      try { catalog = await demoAreasApi.getAll(accessToken); }
      catch (failure) {
        if (!(failure instanceof ApiError) || failure.status !== 404) throw failure;
        const legacy = await navigationApi.getArea(accessToken);
        if (request === version.current) {
          setArea(legacy);
          setError('Additional live service areas require a backend update. Showing the existing service area.');
        }
        return;
      }
      if (request !== version.current) return;
      const available = catalog.items.filter(item => item.enabled && item.routing_supported);
      if (!available.length) throw new Error('No live walking service areas are enabled.');
      const selected = available.find(item => item.id === catalog.default_area_id) ?? available[0];
      const detail = await navigationApi.getArea(accessToken, selected.id);
      if (request !== version.current) return;
      if (detail.id !== selected.id || JSON.stringify(detail.bbox) !== JSON.stringify(selected.bbox)) throw new Error('Live service-area data does not match the selection.');
      setAreas(available); setArea(detail);
    } catch (failure) {
      if (request === version.current) setError(failure instanceof Error ? failure.message : 'Unable to load live areas.');
    } finally {
      if (request === version.current) { busy.current = false; setLoading(false); }
    }
  }

  async function select(item: ResidentServiceArea) {
    if (busy.current || area?.id === item.id) return;
    busy.current = true;
    const request = ++version.current;
    props.onMapTouchChange?.(false);
    setLoading(true); setError('');
    try {
      const accessToken = await token();
      if (request !== version.current) return;
      const detail = await navigationApi.getArea(accessToken, item.id);
      if (request !== version.current) return;
      if (detail.id !== item.id || JSON.stringify(detail.bbox) !== JSON.stringify(item.bbox)) throw new Error('Live service-area data does not match the selection.');
      setArea(detail);
    } catch (failure) {
      if (request === version.current) setError(failure instanceof Error ? failure.message : 'Unable to switch live area.');
    } finally {
      if (request === version.current) { busy.current = false; setLoading(false); }
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return discover(); });
    return () => { active = false; version.current += 1; busy.current = false; };
  }, []);

  return <View style={{ gap: 12 }}>
    <Text style={{ color: colors.muted }}>Live service area</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {areas.map(item => <Pressable key={item.id} accessibilityRole="button"
        accessibilityLabel={`Live service area: ${item.name}`} accessibilityState={{ selected: area?.id === item.id, disabled: loading }}
        disabled={loading} onPress={() => void select(item)}
        style={{ minHeight: 44, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.navy, backgroundColor: area?.id === item.id ? colors.lavender : colors.white }}>
        <Text style={{ color: colors.navy, fontWeight: '700' }}>{item.name}</Text>
      </Pressable>)}
    </View>
    {area?.crossing_policy === 'mapped_facilities_only' && <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
      Uses mapped footpaths or permitted road-side walking. Cross roads only via mapped marked crossings, pedestrian signals, footbridges or underpasses. Road-side positions are inferred.
    </Text>}
    {area?.temporary_live && <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Temporary live coverage. Damage avoidance and verified step-free coverage are not enabled here.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#A63E37' }}>{error}</Text>}
    {!!error && <Pressable accessibilityRole="button" disabled={loading} onPress={() => void discover()} style={{ padding: 12 }}><Text>Retry service areas</Text></Pressable>}
    {loading ? <><SkeletonBlock width="70%" height={14} /><SkeletonMap /></> : area && <MapScreen key={area.id} {...props} navigationArea={area} />}
  </View>;
}
