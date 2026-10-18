import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { placesApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { PlacePoint } from '../savedPlaces/store';
import { colors } from '../theme';
import catalogue from './map-places.json';

export type PlaceOption = PlacePoint & { id: string; address: string; basis: string };
type Props = { areaId: string; query: string; field: string; local?: PlaceOption[]; onChoose: (point: PlacePoint) => void };

export default function PlaceSearch({ areaId, query, field, local = [], onChoose }: Props) {
  const scope = JSON.stringify([areaId, field, query]);
  const current = useRef(scope); current.current = scope;
  const version = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  const [response, setResponse] = useState<{ scope: string; items: PlaceOption[]; bundled: boolean } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  useEffect(() => () => { version.current += 1; current.current = ''; }, []);
  const valid = query.trim().length >= 2 && query.trim().length <= 160;
  const result = response?.scope === scope ? response : null;
  const error = failure?.scope === scope ? failure.message : '';
  const busy = pending === scope;
  const tokens = query.trim().toLocaleLowerCase().match(/[^\s,./;]+/gu) ?? [];
  const bundled: PlaceOption[] = valid ? catalogue.filter(row => row.area_id === areaId && tokens.length > 0
    && tokens.every(token => `${row.name} ${row.address}`.toLocaleLowerCase().includes(token)))
    .sort((a, b) => Number(!a.name.toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase()))
      - Number(!b.name.toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase())) || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, 8).map(row => ({ id: row.id, label: row.name, coordinate: [row.longitude, row.latitude], address: row.address, basis: row.position_basis })) : [];
  const items = result?.items ?? (bundled.length ? bundled : local);

  async function search() {
    if (!valid || busy) return;
    const request = ++version.current;
    setPending(scope); setFailure(null); Keyboard.dismiss();
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error('Sign in again to search places.');
      const result = await placesApi.search(data.session.access_token, areaId, query.trim());
      if (request !== version.current || current.current !== scope) return;
      if (result.area_id !== areaId) throw new Error('Place results do not match the selected area. Retry your search.');
      setResponse({ scope, bundled: result.storage === 'bundled_catalog', items: result.items.map(row => ({
        id: row.id, label: row.name, coordinate: [row.longitude, row.latitude], address: row.address, basis: row.position_basis,
      })) });
    } catch (error) {
      if (request === version.current && current.current === scope) setFailure({ scope,
        message: error instanceof Error ? error.message : 'Could not search places. Retry or pick on the map.' });
    } finally {
      if (request === version.current) setPending(null);
    }
  }

  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel="Search addresses and places" disabled={!valid || busy}
      accessibilityState={{ disabled: !valid || busy, busy }} onPress={search}
      style={[styles.search, (!valid || busy) && styles.disabled]}>
      <Text style={styles.searchText}>{busy ? 'Searching…' : 'Search addresses and places'}</Text>
    </Pressable>
    <Text style={styles.hint}>Search in this service area. Choose a result to set your {field}.</Text>
    {items.map(point => <Pressable key={point.id} accessibilityRole="button" accessibilityLabel={`Choose place: ${point.label}`}
      onPress={() => { Keyboard.dismiss(); onChoose(point); }} style={styles.result}>
      <Text style={styles.name}>{point.label}</Text>
      {!!point.address && <Text style={styles.hint}>{point.address}</Text>}
      {!!point.basis && <Text style={styles.hint}>{point.basis}</Text>}
    </Pressable>)}
    {result && !items.length && <Text accessibilityLiveRegion="polite" style={styles.hint}>
      No matching address or place in this service area. Try another name or pick the location on the map.
    </Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {result?.bundled && <Text style={styles.hint}>Showing the bundled place catalogue.</Text>}
    {(items.length > 0 || result) && <Text style={styles.hint}>Places: OpenStreetMap contributors (ODbL). Coverage may be incomplete.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8 }, search: { minHeight: 44, padding: 12, borderRadius: 12, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 }, searchText: { color: colors.white, fontWeight: '600', fontSize: 13 },
  result: { minHeight: 48, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white },
  name: { color: colors.navy, fontSize: 14, fontWeight: '600' }, hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: '#A63E37', fontSize: 12, lineHeight: 18 },
});
