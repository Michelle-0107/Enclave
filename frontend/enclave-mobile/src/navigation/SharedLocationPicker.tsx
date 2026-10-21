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
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const chosenPoint = useRef<string | null>(null);
  const currentScope = useRef(''); currentScope.current = `${areaId}:${query.trim()}`;
  const latitude = point?.latitude; const longitude = point?.longitude;
  const key = `${areaId}:${latitude},${longitude}`;
  useEffect(() => {
    let current = true;
    if (latitude === undefined || longitude === undefined || chosenPoint.current === key) return;
    const request = ++version.current;
    setQuery('Selected map point'); setResult(null); setExpanded(false); setBusy(false); setError('');
    const timer = setTimeout(() => { void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('Sign in to look up places.');
        const page = await locationsApi.lookup(data.session.access_token, areaId, { latitude, longitude, limit: 1 });
        if (!current || version.current !== request) return;
        if (page.area_id !== areaId || page.storage !== 'database') throw new Error('Location results do not match this area.');
        const first = page.items[0];
        setQuery(first ? `${(first.distance_meters ?? 0) > 1 ? 'Near ' : ''}${first.name}` : 'Selected map point');
      } catch { /* The exact pin remains selected when a name cannot be resolved. */ }
    })(); }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [latitude, longitude, areaId, key]);
  useEffect(() => () => { version.current += 1; }, []);
  async function search() {
    const scope = query.trim(); if (scope.length < 2) return;
    const request = ++version.current; setBusy(true); setError(''); setExpanded(false);
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
  const items = result?.areaId === areaId && result.query === query.trim() ? result.items : null;
  return <View style={{ gap: 8 }}>
    <TextInput accessibilityLabel="Search report location" placeholder="Search a place, road or section" placeholderTextColor={colors.muted} selectionColor={colors.navy} value={query} maxLength={160}
      onChangeText={value => { version.current += 1; setBusy(false); setExpanded(false); setError(''); setQuery(value); }} onSubmitEditing={() => { void search(); }}
      style={{ minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: colors.white, color: colors.navy }} />
    <Pressable accessibilityRole="button" disabled={busy || query.trim().length < 2} onPress={search} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.navy }}>{busy ? 'Searching...' : 'Search locations'}</Text>
    </Pressable>
    {(expanded ? items : items?.slice(0, 3))?.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => {
      version.current += 1; chosenPoint.current = `${areaId}:${item.latitude},${item.longitude}`;
      setQuery(item.name); setResult(null); setExpanded(false); onChoose(item);
    }} style={{ minHeight: 44, justifyContent: 'center', padding: 8 }}>
      <Text style={{ color: colors.navy }}>{item.name}</Text>{!!item.address && item.address !== item.name && <Text style={{ color: colors.muted }}>{item.address}</Text>}
    </Pressable>)}
    {!!items && items.length > 3 && <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.navy }}>{expanded ? 'Show fewer locations' : `Show more locations (${items.length - 3})`}</Text>
    </Pressable>}
    {items?.length === 0 && <Text>No matching location. Choose the exact point on the map.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#A63E37' }}>{error}</Text>}
  </View>;
}
