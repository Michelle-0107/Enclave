import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { facilitiesApi, type FacilityRecord } from '../lib/api';
import { supabase } from '../lib/supabase';
import { SkeletonBlock } from '../components/DataSkeleton';

/** Registered facilities; these are not confirmed damage or surveyed access. */
export function useReportFacilityPoints() {
  const [facilities, setFacilities] = useState<FacilityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setFacilities([]);
    async function load() {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token)
        throw new Error('Sign in again to load registered facilities.');
      const points = new Map<string, FacilityRecord>();
      for (let offset = 0; offset < 4000; offset += 200) {
        const page = await facilitiesApi.getAll(data.session.access_token, {
          limit: 200, offset, bbox: [101.7211, 3.2171, 101.7409, 3.2349],
        });
        if (!active) return;
        for (const point of page.items) points.set(point.id, point);
        if (!page.pagination.has_more) {
          setFacilities([...points.values()]);
          return;
        }
        if (!page.items.length) break;
      }
      throw new Error('Unable to load all facilities. Please retry.');
    }
    load().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load facilities.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  return { facilities, loading, error, reload: () => setAttempt(value => value + 1) };
}

export function ReportFacilityMarkers({ facilities, onSelect }: {
  facilities: FacilityRecord[];
  onSelect: (facility: FacilityRecord) => void;
}) {
  return <>{facilities.map(facility => (
    <Marker key={facility.id} id={`report-facility-${facility.id}`}
      lngLat={[facility.longitude, facility.latitude]}
      onPress={event => { event.stopPropagation(); onSelect(facility); }}>
      <View collapsable={false} style={styles.point}
        accessibilityLabel={`${facility.name}, ${facility.facility_type.replace(/_/g, ' ')}`}>
        <View style={styles.dot}><Text style={styles.letter}>F</Text></View>
        <Text style={styles.name} numberOfLines={2}>{facility.name}</Text>
      </View>
    </Marker>
  ))}</>;
}

export function ReportFacilityHint({ loading, error, count, onRetry, markersVisible = true }: {
  loading: boolean; error: string; count: number; onRetry: () => void; markersVisible?: boolean;
}) {
  if (loading) return <View style={{ gap: 8 }} accessibilityLabel="Loading facilities" accessibilityRole="progressbar"><SkeletonBlock width="70%" height={12} /><SkeletonBlock width="92%" height={12} /></View>;
  if (error) return <View>
    <Text style={styles.hint}>{error}</Text>
    <Pressable accessibilityRole="button" onPress={onRetry}>
      <Text style={styles.retry}>Retry facilities</Text>
    </Pressable>
  </View>;
  return <Text style={styles.hint}>
    {count} registered facilities. {markersVisible ? 'Tap a teal F marker to choose its location, then select the facility below.' : 'Facility markers are hidden. Tap the actual issue location and choose a nearby facility below, or show the markers.'} [DEMO] points are fictional facilities on mapped roads, not surveyed accessibility.
  </Text>;
}

const styles = StyleSheet.create({
  point: { alignItems: 'center', width: 138 },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#fff', backgroundColor: '#247a82', alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#fff', fontWeight: '700', fontSize: 15 },
  name: { color: '#202c46', backgroundColor: '#fff', paddingHorizontal: 4, paddingVertical: 2, fontSize: 10, textAlign: 'center', borderRadius: 4 },
  hint: { color: '#64748b', fontSize: 12, lineHeight: 18 },
  retry: { color: '#202c46', paddingVertical: 12, fontWeight: '600' },
});
