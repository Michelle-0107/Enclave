import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { locationsApi, type SharedLocation } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
type Point = { latitude: number; longitude: number };
export default function SharedLocationPicker({ point, onChoose, areaId = 'kl-east-pilot' }: {
  point: Point | null; onChoose: (place: SharedLocation) => void; areaId?: string;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; areaId: string; items: SharedLocation[] } | null>(null);
  const [label, setLabel] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const currentScope = useRef(''); currentScope.current = `${areaId}:${query.trim()}`;
  const latitude = point?.latitude; const longitude = point?.longitude;
  const key = `${areaId}:${latitude},${longitude}`;
  useEffect(() => {
    let current = true;
    if (latitude === undefined || longitude === undefined) return;
    const timer = setTimeout(() => { void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('Sign in to look up places.');
        const page = await locationsApi.lookup(data.session.access_token, areaId, { latitude, longitude, limit: 1 });
        if (!current) return;
        if (page.area_id !== areaId || page.storage !== 'database') throw new Error('Location results do not match this area.');
        const first = page.items[0];
        setLabel({ key, text: first ? `${(first.distance_meters ?? 0) > 1 ? 'Near ' : ''}${first.name}` : 'Selected map point' });
      } catch { if (current) setLabel({ key, text: 'Selected map point · place lookup unavailable' }); }
    })(); }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [latitude, longitude, areaId, key]);
  useEffect(() => () => { version.current += 1; }, []);
  async function search() {
    const scope = query.trim(); if (scope.length < 2) return;
    const request = ++version.current; setBusy(true); setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Sign in to search locations.');
      const page = await locationsApi.lookup(data.session.access_token, areaId, { q: scope, limit: 8 });
      if (request === version.current && currentScope.current === `${areaId}:${scope}`) {
        if (page.area_id !== areaId || page.storage !== 'database') throw new Error('Location results do not match the selected area.');
        setResult({ query: scope, areaId, items: page.items });
      }
    } catch (failure) { if (request === version.current) setError(failure instanceof Error ? failure.message : 'Location search unavailable.'); }
    finally { if (request === version.current) setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <TextInput accessibilityLabel="Search report location" placeholder="Search a place, road or section" value={query} maxLength={160}
      onChangeText={value => { version.current += 1; setBusy(false); setQuery(value); }} onSubmitEditing={() => { void search(); }}
      style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.navy }} />
    <Pressable accessibilityRole="button" disabled={busy || query.trim().length < 2} onPress={search} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.navy }}>{busy ? 'Searching…' : 'Search locations'}</Text>
    </Pressable>
    {result?.areaId === areaId && result.query === query.trim() && result.items.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => { onChoose(item); setQuery(item.name); setResult(null); }} style={{ minHeight: 44, justifyContent: 'center', padding: 8 }}>
      <Text style={{ color: colors.navy }}>{item.name}</Text>{!!item.address && <Text style={{ color: colors.muted }}>{item.address}</Text>}
    </Pressable>)}
    {result?.areaId === areaId && result.query === query.trim() && !result.items.length && <Text>No matching location. Choose the exact point on the map.</Text>}
    {!!point && <Text style={{ color: colors.navy }}>{label?.key === key ? label.text : 'Looking up place…'}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#A63E37' }}>{error}</Text>}
  </View>;
}
