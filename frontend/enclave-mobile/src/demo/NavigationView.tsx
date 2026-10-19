import { NativeMap as Map } from '../navigation/NativeMap';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera, GeoJSONSource, Layer, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { meters, type Coordinate, type Route } from './network';
import type { Instruction } from './navigationProgress';
import { markerRotation, movementHeading, type HeadingState, type MotionFix } from './navigationHeading';

type Props = {
  styleUrl: string; route: Route; destination: Coordinate; stage: 'entry' | 'mapped' | 'exit' | 'complete';
  position: Coordinate | null; instruction: Instruction; next?: Instruction; turnDistance: number; remaining: number; total: number;
  motion?: MotionFix; status: string; error: string; tracking: boolean; rerouting: boolean; deviating: boolean; voiceEnabled: boolean; voiceStatus: string;
  onToggleVoice: () => void; onRepeat: () => void; onToggleTracking: () => void; onManualNext: () => void; onClose: () => void; onRetry?: () => void;
};
const icons = { left: 'arrow-left-top', right: 'arrow-right-top', uturn: 'arrow-u-left-top', crossing: 'walk', arrive: 'flag-checkered', continue: 'arrow-up' } as const;
const distance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
export default function NavigationView(p: Props) {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const headingState = useRef<HeadingState>({ anchor: null, heading: null, timestamp: 0 });
  const [following, setFollowing] = useState(true), [loaded, setLoaded] = useState(false), [mapError, setMapError] = useState(false), [mapKey, setMapKey] = useState(0);
  const [heading, setHeading] = useState<number | null>(null), [mapBearing, setMapBearing] = useState(0);
  useEffect(() => {
    if (!p.motion) return;
    headingState.current = movementHeading(headingState.current, p.motion);
    setHeading(headingState.current.heading);
  }, [p.motion]);
  useEffect(() => {
    if (!following || !loaded || !p.position) return;
    if (p.stage === 'entry' && p.position) {
      const points = [p.position, p.route.originSnap.coordinate];
      camera.current?.fitBounds([Math.min(...points.map(x => x[0])), Math.min(...points.map(x => x[1])),
        Math.max(...points.map(x => x[0])), Math.max(...points.map(x => x[1]))],
      { padding: { top: 220, bottom: 260, left: 60, right: 60 }, duration: 700 });
    } else camera.current?.easeTo({ center: p.position, zoom: 18, pitch: 45, bearing: heading ?? 0,
      padding: { top: 180, bottom: 220, left: 20, right: 20 }, duration: 700 });
  }, [p.position, p.stage, p.route, following, loaded, heading]);
  const minutes = Math.max(1, Math.ceil(p.route.seconds * p.remaining / Math.max(1, p.total) / 60));
  const time = new Date(Date.now() + minutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const transfer = p.stage === 'entry' || p.stage === 'exit';
  const title = p.rerouting ? 'Updating your route automatically…' : p.deviating ? 'Checking GPS for automatic rerouting…' : p.stage === 'entry' ? 'Go to the starting point'
    : p.stage === 'exit' ? 'Find the destination entrance' : p.stage === 'complete' ? 'You have arrived' : p.instruction.text;
  const toAccess = p.stage === 'entry' ? p.route.originSnap.coordinate : p.destination;
  function overview() {
    setFollowing(false);
    const points = [...p.route.coordinates, ...(p.position ? [p.position] : [])];
    camera.current?.fitBounds([Math.min(...points.map(x => x[0])), Math.min(...points.map(x => x[1])),
      Math.max(...points.map(x => x[0])), Math.max(...points.map(x => x[1]))],
    { padding: { top: 230, bottom: 260, left: 45, right: 70 }, duration: 500 });
  }
  return <View style={s.screen}>
    <View style={s.map} onTouchStart={() => setFollowing(false)}>
      <Map key={mapKey} style={s.map} mapStyle={p.styleUrl} androidView="texture" attribution dragPan touchZoom doubleTapZoom
        onRegionIsChanging={event => setMapBearing(event.nativeEvent.bearing)}
        onRegionDidChange={event => setMapBearing(event.nativeEvent.bearing)}
        onDidFinishLoadingMap={() => { setLoaded(true); setMapError(false); }} onDidFailLoadingMap={() => setMapError(true)}>
        <Camera ref={camera} initialViewState={{ center: p.position ?? p.route.originSnap.coordinate, zoom: 17, pitch: 40 }} />
        {p.stage !== 'entry' && <GeoJSONSource id="guidance-route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.route.coordinates } }}>
          <Layer id="guidance-route-casing" type="line" paint={{ 'line-color': '#FFFFFF', 'line-width': 11 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
          <Layer id="guidance-route-line" type="line" paint={{ 'line-color': '#2466EA', 'line-width': 7 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        </GeoJSONSource>}
        {p.route.facilities.map(f => <Marker key={f.id} id={`guidance-facility-${f.id}`} lngLat={f.coordinate}>
          <View collapsable={false} style={s.facility}><MaterialCommunityIcons name={f.kind === 'stairs' ? 'stairs' : f.kind === 'crossing' ? 'walk' : 'map-marker-alert-outline'} size={16} color="#7D4613" /></View>
        </Marker>)}
        {p.route.navigationFacilities?.map(f => <Marker key={f.id} id={`guidance-crossing-${f.id}`} lngLat={f.coordinate}>
          <View collapsable={false} style={[s.facility, { backgroundColor: f.routingSource === 'simulation' ? '#EADDFA' : '#D4EFEC' }]}><MaterialCommunityIcons name={f.kind === 'footbridge' ? 'bridge' : 'walk'} size={18} color={f.routingSource === 'simulation' ? '#8147B4' : '#056364'} /></View>
        </Marker>)}
        {p.stage === 'entry' && <Marker id="guidance-start" lngLat={p.route.originSnap.coordinate}><View collapsable={false} style={s.pin}><Text style={s.pinText}>S</Text></View></Marker>}
        <Marker id="guidance-destination" lngLat={p.destination}><View collapsable={false} style={s.pin}><MaterialCommunityIcons name="flag-checkered" size={22} color="#FFFFFF" /></View></Marker>
        {p.position && <Marker id="guidance-user" lngLat={p.position}><View collapsable={false} style={s.user}>
          {heading === null ? <View style={s.positionDot} /> : <MaterialCommunityIcons name="navigation" size={36} color="#2466EA" style={{ transform: [{ rotate: `${markerRotation(heading, mapBearing)}deg` }] }} />}
        </View></Marker>}
      </Map>
    </View>
    <View pointerEvents="box-none" style={[s.top, { top: insets.top + 10 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Repeat navigation instruction" onPress={p.onRepeat} style={s.banner}>
        <MaterialCommunityIcons name={transfer ? 'map-marker-path' : p.stage === 'complete' ? 'flag-checkered' : icons[p.instruction.kind]} size={42} color="#FFFFFF" />
        <View style={s.bannerText}>
          <Text style={s.distance}>{p.rerouting || p.deviating ? 'Automatic rerouting' : transfer ? p.position ? `${distance(meters(p.position, toAccess))} to access` : 'Waiting for GPS'
            : p.stage === 'complete' ? 'Destination reached' : p.turnDistance <= 10 ? 'Now' : `In ${distance(p.turnDistance)}`}</Text>
          <Text accessibilityLiveRegion="polite" style={s.instruction}>{title}</Text>
        </View>
      </Pressable>
      {p.stage === 'mapped' && !p.deviating && !p.rerouting && p.next && <View style={s.then}><Text style={s.thenLabel}>Then</Text><MaterialCommunityIcons name={icons[p.next.kind]} size={22} color="#FFFFFF" /><Text numberOfLines={2} style={s.thenText}>{p.next.text}</Text></View>}
      {mapError && <Pressable style={s.warning} accessibilityRole="button" onPress={() => { setLoaded(false); setMapKey(x => x + 1); }}><Text>Map could not load. Tap to retry.</Text></Pressable>}
    </View>
    <View style={[s.controls, { bottom: Math.max(265, insets.bottom + 255) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={p.voiceEnabled ? 'Mute voice guidance' : 'Enable voice guidance'} onPress={p.onToggleVoice} style={s.round}><MaterialCommunityIcons name={p.voiceEnabled ? 'volume-high' : 'volume-off'} size={25} color="#202C46" /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Recenter navigation on me" onPress={() => setFollowing(true)} style={[s.round, following && s.active]}><MaterialCommunityIcons name="crosshairs-gps" size={25} color="#202C46" /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Show entire route" onPress={overview} style={s.round}><MaterialCommunityIcons name="map-outline" size={25} color="#202C46" /></Pressable>
    </View>
    <View style={[s.bottom, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <View style={s.summary}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit Enclave guidance" onPress={p.onClose} style={s.round}><MaterialCommunityIcons name="close" size={30} color="#202C46" /></Pressable>
        <View style={s.summaryText}><Text style={s.eta}>{p.stage === 'complete' ? 'Arrived' : transfer ? 'Reach the access point' : `${minutes} min`}</Text>
          <Text style={s.subtitle}>{transfer ? 'S and your GPS position are marked' : `${distance(p.remaining)} remaining · ${time}`}</Text></View>
        <MaterialCommunityIcons name={p.route.profile === 'wheelchair' ? 'wheelchair-accessibility' : 'walk'} size={26} color="#202C46" />
      </View>
      <Text numberOfLines={2} style={s.status}>{p.status}</Text>
      {p.route.navigationFacilities?.some(f => f.routingSource === 'simulation') && <Text style={s.error}>Demo only: includes fictional crossing facilities. Do not follow these crossings on a real road.</Text>}
      {transfer && <Text style={s.status}>Access transfer is a distance reference. Use a visible passage.</Text>}
      {p.voiceStatus ? <Text style={s.error}>{p.voiceStatus}</Text> : null}
      {p.error ? <Text accessibilityRole="alert" style={s.error}>{p.error}</Text> : null}
      <View style={s.actions}>
        {p.stage !== 'complete' && <Pressable accessibilityRole="button" onPress={p.onToggleTracking} style={s.action}><Text style={s.actionText}>{p.tracking ? 'Pause GPS' : 'Resume GPS'}</Text></Pressable>}
        {p.stage !== 'complete' && (transfer || !p.tracking) && <Pressable accessibilityRole="button" onPress={p.onManualNext} style={s.action}><Text style={s.actionText}>{p.stage === 'entry' ? 'I am at S' : p.stage === 'exit' ? 'I have arrived' : 'Next instruction'}</Text></Pressable>}
        {p.onRetry && <Pressable accessibilityRole="button" disabled={p.rerouting} onPress={p.onRetry} style={s.action}><Text style={s.actionText}>{p.rerouting ? 'Recalculating…' : 'Retry now'}</Text></Pressable>}
      </View>
    </View>
  </View>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F4EF' }, map: { flex: 1 }, top: { position: 'absolute', left: 12, right: 12, gap: 0 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 15, backgroundColor: '#056364', padding: 17, borderRadius: 20, elevation: 5 },
  bannerText: { flex: 1, gap: 4 }, distance: { color: '#D0F2E9', fontSize: 16, fontWeight: '600' }, instruction: { color: '#FFFFFF', fontSize: 21, lineHeight: 28, fontWeight: '600' },
  then: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#064C50', borderBottomLeftRadius: 18, borderBottomRightRadius: 18, marginHorizontal: 9 },
  thenLabel: { color: '#FFFFFF', fontSize: 14 }, thenText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, flex: 1 },
  controls: { position: 'absolute', right: 14, gap: 12 }, round: { backgroundColor: '#FFFFFF', height: 52, width: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', elevation: 3, borderWidth: 1, borderColor: '#DADDE3' },
  active: { backgroundColor: '#E7F1FC', borderColor: '#2466EA' }, bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, backgroundColor: '#FFFFFF', gap: 7, elevation: 7 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 }, summaryText: { flex: 1, gap: 3 }, eta: { fontSize: 25, fontWeight: '700', color: '#202C46' }, subtitle: { fontSize: 13, color: '#687083' },
  status: { fontSize: 12, lineHeight: 17, color: '#687083' }, error: { fontSize: 12, lineHeight: 17, color: '#A63E37' }, actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 5 }, actionText: { fontSize: 13, fontWeight: '600', color: '#056364' },
  pin: { backgroundColor: '#056364', width: 34, height: 34, borderRadius: 17, borderColor: '#FFFFFF', borderWidth: 3, alignItems: 'center', justifyContent: 'center' }, pinText: { color: '#FFFFFF', fontWeight: '700' },
  user: { backgroundColor: '#FFFFFF', borderRadius: 28, height: 52, width: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#B5CFFF' },
  positionDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#2466EA' },
  facility: { padding: 4, borderRadius: 12, backgroundColor: '#FFF0D8', borderWidth: 1, borderColor: '#FFFFFF' }, warning: { backgroundColor: '#FFF0D8', padding: 12, borderRadius: 12 },
});
