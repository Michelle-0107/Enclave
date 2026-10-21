import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { locationsApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { SkeletonBlock } from '../components/DataSkeleton';

export function useMapPointName(coordinate: readonly [number, number] | null | undefined, areaId: string) {
  const latitude = coordinate?.[1]; const longitude = coordinate?.[0];
  const key = `${areaId}:${latitude},${longitude}`;
  const [result, setResult] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    let current = true;
    if (latitude === undefined || longitude === undefined) return;
    const timer = setTimeout(() => { void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('Sign in again.');
        const page = await locationsApi.lookup(data.session.access_token, areaId, { latitude, longitude, limit: 1 });
        if (page.area_id !== areaId || page.storage !== 'database') throw new Error('Location results do not match this area.');
        const item = page.items[0];
        if (current) setResult({ key, text: item ? `${(item.distance_meters ?? 0) > 1 ? 'Near ' : ''}${item.name}` : 'Selected map point' });
      } catch { if (current) setResult({ key, text: 'Selected map point · place lookup unavailable' }); }
    })(); }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [latitude, longitude, areaId, key]);
  return coordinate ? (result?.key === key ? result.text : null) : null;
}

export default function NamedMapPoint({ coordinate, areaId, label }: {
  coordinate?: readonly [number, number] | null; areaId: string; label: string;
}) {
  const name = useMapPointName(coordinate, areaId);
  if (!coordinate) return null;
  return name ? <Text style={{ color: colors.navy, fontSize: 12 }}>{label}: {name}</Text> : <View accessibilityLabel={`Loading ${label.toLowerCase()} place name`} accessibilityRole="progressbar" style={{ paddingVertical: 3 }}><SkeletonBlock width="64%" height={11} /></View>;
}
