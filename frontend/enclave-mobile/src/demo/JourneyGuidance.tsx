import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { colors } from '../theme';
import { compassDirection } from './access';
import { meters, type Coordinate, type Route } from './network';

type Props = { route: Route; origin: Coordinate; destination: Coordinate; waitForStart?: boolean; onRouteReady?: (ready: boolean) => void; onPosition: (point: Coordinate | null) => void; onTarget?: (point: Coordinate | null) => void };
const START_ARRIVAL_RADIUS_METERS = 20;
export default function JourneyGuidance({ route, origin, destination, waitForStart = false, onRouteReady, onPosition, onTarget }: Props) {
  const startGap = meters(origin, route.originSnap.coordinate), endGap = meters(destination, route.destinationSnap.coordinate);
  const [stage, setStage] = useState<'entry' | 'mapped' | 'exit' | 'complete'>(waitForStart || startGap > 3 ? 'entry' : 'mapped');
  const [index, setIndex] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [position, setPosition] = useState<Coordinate | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState('GPS is optional. You can review and advance the route on this map.');
  useEffect(() => {
    if (!tracking) return;
    let disposed = false, subscription: Location.LocationSubscription | undefined;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (disposed) return;
        if (permission.status !== 'granted') { setStatus('Location permission denied. Map guidance remains available.'); setTracking(false); return; }
        const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 }, value => {
          if (disposed) return;
          const point: Coordinate = [value.coords.longitude, value.coords.latitude];
          setPosition(point); setGpsAccuracy(value.coords.accuracy); onPosition(point);
          setStatus(value.coords.accuracy == null ? 'GPS accuracy unknown. Foreground only.' : `GPS accuracy approximately ${Math.round(value.coords.accuracy)} m. Foreground only.`);
        }, () => { if (!disposed) setStatus('GPS unavailable. Continue with the map or retry location.'); });
        if (disposed) watcher.remove(); else subscription = watcher;
      } catch { if (!disposed) { setStatus('Could not start GPS. Map guidance remains available.'); setTracking(false); } }
    })();
    return () => { disposed = true; subscription?.remove(); onPosition(null); };
  }, [tracking, onPosition]);
  const coordinates = route.coordinates;
  const target = stage === 'entry' ? route.originSnap.coordinate : stage === 'exit' ? destination : coordinates[Math.min(index + 1, coordinates.length - 1)];
  const longitude = target[0], latitude = target[1];
  useEffect(() => { onTarget?.(stage === 'complete' ? null : [longitude, latitude]); return () => onTarget?.(null); }, [longitude, latitude, stage, onTarget]);
  const gpsArrived = Boolean(position && gpsAccuracy !== null && gpsAccuracy <= START_ARRIVAL_RADIUS_METERS && meters(position, route.originSnap.coordinate) <= START_ARRIVAL_RADIUS_METERS);
  const awaitingGps = stage === 'entry' && waitForStart && !position;
  const reference = position ?? (awaitingGps ? null : stage === 'entry' ? origin : coordinates[index]);
  const distance = reference ? meters(reference, target) : null;
  useEffect(() => {
    if (stage === 'entry' && waitForStart && gpsArrived) {
      setStage('mapped'); onRouteReady?.(true); setStatus('You reached the adjusted start. Route guidance has started.');
    }
  }, [gpsArrived, stage, waitForStart, onRouteReady]);
  function next() {
    if (stage === 'entry') { setStage('mapped'); if (waitForStart) { onRouteReady?.(true); setStatus('You confirmed you reached the adjusted start. Route guidance has started.'); } }
    else if (stage === 'mapped' && index < coordinates.length - 2) setIndex(index + 1);
    else if (stage === 'mapped') { setStage(endGap > 3 ? 'exit' : 'complete'); if (endGap <= 3) { setTracking(false); setPosition(null); onPosition(null); } }
    else { setStage('complete'); setTracking(false); setPosition(null); onPosition(null); }
  }
  return <View style={styles.card}>
    <Text style={styles.title}>{stage === 'entry' ? waitForStart ? 'Go to your adjusted starting point' : 'Find the mapped walking access' : stage === 'mapped' ? 'Enclave route guidance' : stage === 'exit' ? 'Find the destination access' : 'Route completed'}</Text>
    {stage !== 'complete' && <>
      {distance !== null && <Text style={styles.body}>{Math.round(distance)} m {compassDirection(reference!, target)} · {position ? 'from GPS position' : 'from selected route point'}</Text>}
      <Text style={styles.body}>Target: {target[1].toFixed(6)}, {target[0].toFixed(6)}</Text>
      {stage === 'mapped' ? <Text style={styles.body}>Follow the coloured mapped path. Point {Math.min(index + 2, coordinates.length)} of {coordinates.length}. Advance after reaching each point.</Text> : waitForStart ? <Text style={styles.body}>{position ? `Route guidance starts automatically when GPS is within ${START_ARRIVAL_RADIUS_METERS} m of S and reported accuracy is at or better than ${START_ARRIVAL_RADIUS_METERS} m.` : 'Use GPS to show your current position and approach S. The destination route stays paused until you arrive.'} The O-to-S transfer is not a mapped or verified path. Distance and bearing are references only; follow a visible public passage and do not cross gates, walls, water or private land.</Text> :
        <Text style={styles.body}>Proximity guidance only: this connection is not mapped or verified. The bearing is not a walking path. Use a visible public entrance; do not cross a gate, wall, water or private land. If there is no passage, choose another point.</Text>}
      {!(stage === 'entry' && waitForStart) && <Pressable accessibilityRole="button" onPress={next} style={styles.button}><Text style={styles.action}>{stage === 'entry' ? 'I reached this access safely — continue' : stage === 'exit' ? 'I reached my destination' : index < coordinates.length - 2 ? 'Reached point — next' : 'Reached end of mapped path'}</Text></Pressable>}
      {stage === 'entry' && waitForStart && !gpsArrived && <Pressable accessibilityRole="button" onPress={next} style={styles.button}><Text style={styles.action}>{position ? 'I am at S — confirm manually' : 'I am at S — continue without GPS'}</Text></Pressable>}
      {stage === 'mapped' && index > 0 && <Pressable accessibilityRole="button" onPress={() => setIndex(index - 1)} style={styles.button}><Text style={styles.action}>Previous point</Text></Pressable>}
    </>}
    <Text style={styles.body}>{status}</Text>
    {stage !== 'complete' && <Pressable accessibilityRole="button" onPress={() => { setTracking(value => !value); if (tracking) { setPosition(null); onPosition(null); setStatus('GPS stopped.'); } }} style={styles.button}>
      <Text style={styles.action}>{tracking ? 'Stop GPS' : 'Use my location'}</Text>
    </Pressable>}
    <Text style={styles.body}>{`Keep Enclave open. No background tracking or automatic turn / voice instructions in this preview. Arrival uses a ${START_ARRIVAL_RADIUS_METERS} m GPS radius. Access transfers are never certified step-free.`}</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 14, gap: 8 },
  title: { fontSize: 15, fontWeight: '600', color: colors.navy },
  body: { fontSize: 12, lineHeight: 18, color: colors.muted },
  button: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
  action: { fontSize: 13, fontWeight: '600', color: colors.navy },
});
