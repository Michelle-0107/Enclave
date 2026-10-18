import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { colors } from '../theme';
import { compassDirection } from './access';
import { meters, type Coordinate, type Route } from './network';
import { ARRIVAL_RADIUS_METERS, MAX_GUIDANCE_ACCURACY_METERS, matchPosition, navigationModel, nextInstruction,
  offRouteEvidence, type OffRouteEvidence } from './navigationProgress';

type Props = { route: Route; origin: Coordinate; destination: Coordinate; waitForStart?: boolean;
  onRouteReady?: (ready: boolean) => void; onPosition: (point: Coordinate | null) => void;
  onTarget?: (point: Coordinate | null) => void; onReroute?: (point: Coordinate) => Promise<boolean>; onComplete?: () => void };
type Fix = { point: Coordinate; accuracy: number | null; timestamp: number; receivedAt: number };
type Stage = 'entry' | 'mapped' | 'exit' | 'complete';
const symbols = { left: '↰', right: '↱', uturn: '↶', crossing: '↔', arrive: '⚑', continue: '↑' };

export default function JourneyGuidance({ route, origin, destination, waitForStart = false, onRouteReady, onPosition, onTarget, onReroute, onComplete }: Props) {
  const model = useMemo(() => navigationModel(route), [route]);
  const [stage, setStage] = useState<Stage>(waitForStart || meters(origin, route.originSnap.coordinate) > 3 ? 'entry' : 'mapped');
  const [tracking, setTracking] = useState(true);
  const [fix, setFix] = useState<Fix | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Starting GPS…');
  const [rerouting, setRerouting] = useState(false);
  const [rerouteError, setRerouteError] = useState('');
  const alive = useRef(true), busy = useRef(false);
  const processedFix = useRef<Fix | null>(null);
  const progressRef = useRef(0), lastMatchTime = useRef<number | null>(null), lastTimestamp = useRef(0);
  const evidence = useRef<OffRouteEvidence>({ hits: 0, since: 0, lastAttempt: null });
  const previousRoute = useRef(route);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (stage === 'complete') onComplete?.(); }, [stage, onComplete]);
  useEffect(() => {
    progressRef.current = 0; lastMatchTime.current = null; processedFix.current = null;
    evidence.current = { hits: 0, since: 0, lastAttempt: evidence.current.lastAttempt };
    const entry = waitForStart || meters(origin, route.originSnap.coordinate) > 3;
    setProgress(0); setStage(entry ? 'entry' : 'mapped'); setRerouteError(''); onRouteReady?.(!entry);
    if (previousRoute.current !== route) setStatus('Route updated. Continuing with your selected route type.');
    previousRoute.current = route;
  }, [route, origin, waitForStart, onRouteReady]);

  useEffect(() => {
    if (!tracking) return;
    let disposed = false, subscription: Location.LocationSubscription | undefined;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (disposed) return;
        if (permission.status !== 'granted') { setStatus('Location permission denied. You can review instructions manually or enable location.'); setTracking(false); return; }
        const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 2000 }, value => {
          if (disposed) return;
          const point: Coordinate = [value.coords.longitude, value.coords.latitude];
          if (!point.every(Number.isFinite)) return;
          const receivedAt = Date.now();
          setFix({ point, accuracy: value.coords.accuracy, timestamp: value.timestamp ?? receivedAt, receivedAt });
        }, () => { if (!disposed) { setStatus('GPS unavailable. Retry location or review the route manually.'); setTracking(false); } });
        if (disposed) watcher.remove(); else subscription = watcher;
      } catch { if (!disposed) { setStatus('Could not start GPS. Retry location or review the route manually.'); setTracking(false); } }
    })();
    return () => { disposed = true; subscription?.remove(); onPosition(null); };
  }, [tracking, onPosition]);

  const recalculate = useCallback(async (point: Coordinate, time: number) => {
    if (busy.current || !onReroute) return;
    busy.current = true; evidence.current.lastAttempt = time;
    setRerouting(true); setRerouteError(''); setStatus('Off route. Recalculating from your current position…');
    try {
      const updated = await onReroute(point);
      if (alive.current && updated) setStatus('Route updated. Your destination and route type are unchanged.');
    } catch (failure) {
      if (alive.current) setRerouteError(failure instanceof Error ? failure.message : 'Unable to recalculate. Check your connection and retry.');
    } finally {
      busy.current = false;
      evidence.current = { hits: 0, since: 0, lastAttempt: Date.now() };
      if (alive.current) setRerouting(false);
    }
  }, [onReroute]);

  useEffect(() => {
    if (!tracking || !fix || processedFix.current === fix || stage === 'complete') return;
    processedFix.current = fix;
    const fresh = fix.timestamp > lastTimestamp.current && fix.receivedAt - fix.timestamp <= 15000 && fix.timestamp <= fix.receivedAt + 10000;
    if (!fresh) { setStatus('Waiting for a fresh GPS location…'); return; }
    lastTimestamp.current = fix.timestamp;
    const reliable = fix.accuracy !== null && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= MAX_GUIDANCE_ACCURACY_METERS;
    if (!reliable) {
      evidence.current = { ...evidence.current, hits: 0, since: 0 };
      setStatus(`Waiting for more accurate GPS${fix.accuracy == null ? '' : ` (approximately ${Math.round(fix.accuracy)} m)`}. Route progress is paused.`);
      return;
    }
    onPosition(fix.point);
    if (stage === 'entry') {
      if (fix.accuracy! <= ARRIVAL_RADIUS_METERS && meters(fix.point, route.originSnap.coordinate) <= ARRIVAL_RADIUS_METERS) {
        setStage('mapped'); onRouteReady?.(true); setStatus('Starting point reached. Following the mapped route.');
      } else setStatus('Approach the marked starting point. Destination navigation starts when you arrive.');
      return;
    }
    if (stage === 'exit') {
      if (fix.accuracy! <= ARRIVAL_RADIUS_METERS && meters(fix.point, destination) <= ARRIVAL_RADIUS_METERS) {
        setStage('complete'); setTracking(false); setStatus('You have reached your destination.');
      }
      return;
    }
    const elapsed = lastMatchTime.current === null ? 0 : (fix.receivedAt - lastMatchTime.current) / 1000;
    const match = matchPosition(model, fix.point, lastMatchTime.current === null ? null : progressRef.current, elapsed);
    const check = offRouteEvidence(evidence.current, match.deviation, fix.accuracy, fix.receivedAt);
    evidence.current = check.evidence;
    if (check.offRoute) {
      setStatus('You appear to be off route. Checking your position…');
      if (check.shouldReroute && !busy.current) void recalculate(fix.point, fix.receivedAt);
      return;
    }
    progressRef.current = Math.max(progressRef.current, match.along);
    lastMatchTime.current = fix.receivedAt;
    setProgress(progressRef.current);
    setStatus(`Following route · GPS accuracy approximately ${Math.round(fix.accuracy!)} m.`);
    if (model.total - progressRef.current <= ARRIVAL_RADIUS_METERS && fix.accuracy! <= ARRIVAL_RADIUS_METERS
        && meters(fix.point, route.destinationSnap.coordinate) <= ARRIVAL_RADIUS_METERS) {
      if (meters(fix.point, destination) <= ARRIVAL_RADIUS_METERS) {
        setStage('complete'); setTracking(false); setStatus('You have reached your destination.');
      } else { setStage('exit'); setStatus('Mapped route completed. Find the destination entrance.'); }
    }
  }, [fix, tracking, stage, model, route, destination, onPosition, onRouteReady, recalculate]);

  const instruction = nextInstruction(model, progress);
  const target = stage === 'entry' ? route.originSnap.coordinate : stage === 'exit' ? destination : instruction.coordinate;
  const longitude = target[0], latitude = target[1];
  useEffect(() => { onTarget?.(stage === 'complete' ? null : [longitude, latitude]); return () => onTarget?.(null); }, [longitude, latitude, stage, onTarget]);
  const reliableFix = tracking && fix !== null && fix.accuracy !== null && Number.isFinite(fix.accuracy)
    && fix.accuracy >= 0 && fix.accuracy <= MAX_GUIDANCE_ACCURACY_METERS
    && Date.now() - fix.timestamp <= 15000 && fix.timestamp <= Date.now() + 10000;
  const remaining = Math.max(0, model.total - progress);
  const turnDistance = Math.max(0, instruction.at - progress);
  const reference = reliableFix ? fix.point : origin;
  function nextManually() {
    if (stage === 'entry') { setStage('mapped'); onRouteReady?.(true); }
    else if (stage === 'exit') { setStage('complete'); setTracking(false); }
    else if (instruction.kind === 'arrive') {
      setStage(meters(destination, route.destinationSnap.coordinate) > 3 ? 'exit' : 'complete'); setTracking(false);
    } else { progressRef.current = instruction.at + 6; setProgress(progressRef.current); }
  }
  return <View style={styles.card}>
    <Text style={styles.title}>{stage === 'entry' ? waitForStart ? 'Go to your adjusted starting point' : 'Go to the route starting point' : stage === 'mapped' ? 'Enclave navigation' : stage === 'exit' ? 'Find the destination entrance' : 'Route completed'}</Text>
    {stage === 'mapped' && <View style={styles.turnCard}>
      <Text style={styles.turnSymbol}>{symbols[instruction.kind]}</Text>
      <View style={styles.turnText}>
        <Text style={styles.title}>{rerouting ? 'Recalculating route…' : turnDistance <= 8 ? 'Now' : `In ${Math.round(turnDistance)} m`}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.instruction}>{instruction.text}</Text>
      </View>
    </View>}
    {stage === 'mapped' && <Text style={styles.body}>{Math.round(remaining)} m remaining · {Math.max(1, Math.ceil(route.seconds * remaining / Math.max(1, model.total) / 60))} min estimate</Text>}
    {(stage === 'entry' || stage === 'exit') && <>
      <Text style={styles.body}>{Math.round(meters(reference, target))} m {compassDirection(reference, target)} · {reliableFix ? 'from GPS position' : 'from selected point'}</Text>
      <Text style={styles.body}>Approach the marked access using a visible passage. Distance and bearing are references; this transfer is not a mapped walking route.</Text>
      {stage === 'entry' && <Text style={styles.body}>Navigation begins automatically within {ARRIVAL_RADIUS_METERS} m of the start when GPS accuracy is at or better than {ARRIVAL_RADIUS_METERS} m.</Text>}
      <Pressable accessibilityRole="button" onPress={nextManually} style={styles.button}><Text style={styles.action}>{stage === 'entry' ? 'I am at S — confirm arrival' : 'I reached my destination'}</Text></Pressable>
    </>}
    {stage === 'mapped' && !tracking && <Pressable accessibilityRole="button" onPress={nextManually} style={styles.button}><Text style={styles.action}>{instruction.kind === 'arrive' ? 'Reached end of mapped path' : 'Next instruction'}</Text></Pressable>}
    <Text style={styles.body}>{status}</Text>
    {rerouteError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{rerouteError}</Text> : null}
    {stage === 'mapped' && reliableFix && onReroute && <Pressable accessibilityRole="button" disabled={rerouting} onPress={() => void recalculate(fix.point, Date.now())} style={styles.button}><Text style={styles.action}>{rerouting ? 'Recalculating…' : 'Recalculate from my location'}</Text></Pressable>}
    {stage !== 'complete' && <Pressable accessibilityRole="button" onPress={() => { if (tracking) { setTracking(false); onPosition(null); setStatus('GPS paused. You can review instructions manually.'); } else { setFix(null); processedFix.current = null; setTracking(true); setStatus('Starting GPS…'); } }} style={styles.button}>
      <Text style={styles.action}>{tracking ? 'Pause GPS' : 'Resume GPS'}</Text>
    </Pressable>}
    <Text style={styles.body}>Keep Enclave open for GPS navigation. Foreground only; voice guidance is not enabled.</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 14, gap: 8 },
  title: { fontSize: 15, fontWeight: '600', color: colors.navy },
  turnCard: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'center' },
  turnSymbol: { fontSize: 38, color: colors.navy }, turnText: { flex: 1, gap: 4 },
  instruction: { fontSize: 16, lineHeight: 23, color: colors.navy },
  body: { fontSize: 12, lineHeight: 18, color: colors.muted },
  error: { fontSize: 12, lineHeight: 18, color: '#A63E37' },
  button: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
  action: { fontSize: 13, fontWeight: '600', color: colors.navy },
});
