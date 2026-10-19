import { NativeMap as Map } from '../navigation/NativeMap';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { demoAreasApi, type DemoRouteResponse } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import SavedPlacesControl from '../savedPlaces/SavedPlacesControl';
import PlaceSearch from '../navigation/PlaceSearch';
import { dataset as builtInSnapshot, initialScenario, insidePilot, isBlocked, labels, meters, nearbyAccessPoints, searchPlaces, selectLocation,
  type Coordinate, type Dataset, type Mode, type ModeResult, type Route, type Selection, type Transport } from './network';
import { drivingDirectionsUrl } from './driving';
import { MAX_START_ADJUSTMENT_METERS, type AccessPlan } from './access';
import JourneyGuidance from './JourneyGuidance';
import { geometryDistances } from './navigationProgress';

type Field = 'origin' | 'destination';
type Props = { areaId?: string; data?: Dataset; onShowLiveMap: () => void; onReportPress?: () => void; onMapTouchChange?: (active: boolean) => void };
type Choice = { label: string; coordinate: Coordinate; snap?: Selection['snap'] };
const transports: { id: Transport; name: string; icon: 'car-outline' | 'walk' | 'wheelchair-accessibility' }[] = [
  { id: 'driving', name: 'Car', icon: 'car-outline' }, { id: 'walking', name: 'Walking', icon: 'walk' }, { id: 'wheelchair', name: 'Wheelchair', icon: 'wheelchair-accessibility' },
];
const routeColors: Record<Mode, string> = { shortest: '#8147B4', avoid_damage: '#BD6509', accessible: '#247A80' };
const symbols: Record<string, string> = { stairs: 'ST', crossing: 'ZX', footbridge: 'FB', ramp: 'RP', path_surface: 'P', step_free_path: 'SF' };
const formatDistance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;

export default function DemoMapScreen({ areaId = 'built-in-snapshot', data = builtInSnapshot, onShowLiveMap, onReportPress, onMapTouchChange }: Props) {
  const dataset = data;
  const state = useMemo(() => initialScenario(data), [data]);
  const [origin, setOrigin] = useState<Choice | null>(null);
  const [destination, setDestination] = useState<Choice | null>(null);
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [field, setField] = useState<Field>('origin');
  const [searching, setSearching] = useState(false);
  const [inputMode, setInputMode] = useState<'search' | 'map'>('map');
  const [results, setResults] = useState<ModeResult[]>([]);
  const [mode, setMode] = useState<Mode>('shortest');
  const [selected, setSelected] = useState<{ type: 'facility' | 'place'; id: string } | null>(null);
  const [error, setError] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [alternative, setAlternative] = useState<AccessPlan | null>(null);
  const [adjustmentVisible, setAdjustmentVisible] = useState(false);
  const [originalOrigin, setOriginalOrigin] = useState<Choice | null>(null);
  const [waitForAdjustedStart, setWaitForAdjustedStart] = useState(false);
  const [routeReady, setRouteReady] = useState(true);
  const [navigating, setNavigating] = useState(false);
  const [guidanceTarget, setGuidanceTarget] = useState<Coordinate | null>(null);
  const [gpsPosition, setGpsPosition] = useState<Coordinate | null>(null);
  const [transport, setTransport] = useState<Transport>('walking');
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [lastLocation, setLastLocation] = useState<Coordinate | null>(null);
  const locationRequest = useRef(0);
  const locationBusy = useRef(false);
  const routeRequest = useRef(0);
  const guidanceActive = useRef(false);
  const followCamera = useRef(true);
  useEffect(() => () => { locationRequest.current += 1; routeRequest.current += 1; guidanceActive.current = false; onMapTouchChange?.(false); }, [onMapTouchChange]);
  const approachCameraCentered = useRef(false);
  const camera = useRef<CameraRef>(null);
  const suggestions = searching ? searchPlaces(field === 'origin' ? startText : endText, dataset) : [];
  const route = results.find(item => item.mode === mode)?.route;
  const facility = selected?.type === 'facility' ? dataset.facilities.find(f => f.id === selected.id) : undefined;
  const place = selected?.type === 'place' ? dataset.landmarks.find(p => p.id === selected.id) : undefined;
  const feature = facility || place;
  const facilityData = useMemo(() => ({ type: 'FeatureCollection' as const,
    features: dataset.facilities.map(f => ({ type: 'Feature' as const, id: f.id,
      properties: { id: f.id, blocked: isBlocked(f, state), symbol: symbols[f.kind] },
      geometry: { type: 'Point' as const, coordinates: f.coordinate } })) }), [dataset, state]);
  const placeData = useMemo(() => ({ type: 'FeatureCollection' as const,
    features: dataset.landmarks.map(p => ({ type: 'Feature' as const, id: p.id, properties: { id: p.id, name: p.name },
      geometry: { type: 'Point' as const, coordinates: p.coordinate } })) }), [dataset]);
  const selectedMarkerData = useMemo(() => {
    if (!feature) return null;
    const color = selected?.type === 'place'
      ? '#0B4FB8'
      : facility && isBlocked(facility, state)
        ? '#7F2E28'
        : '#15575C';
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: { color },
        geometry: { type: 'Point' as const, coordinates: feature.coordinate },
      }],
    };
  }, [feature, facility, selected, state]);
  const bounds: [number, number, number, number] = dataset.bbox;

  function clearRoute() { routeRequest.current += 1; guidanceActive.current = false; followCamera.current = true; setCalculating(false); setResults([]); setSelected(null); setError(''); setAlternative(null); setAdjustmentVisible(false); setWaitForAdjustedStart(false); setRouteReady(true); setNavigating(false); setGpsPosition(null); setGuidanceTarget(null); approachCameraCentered.current = false; }
  function changeTransport(next: Transport) {
    if (next === transport) return;
    setTransport(next); clearRoute(); setSearching(false); setMode(next === 'wheelchair' ? 'accessible' : 'shortest');
    if (next === 'driving') return;
    // Raw selections stay fixed. Access planning resolves nearby paths explicitly.

  }
  function fitRoute(value: Route) {
    const points = [...value.coordinates, ...(origin ? [origin.coordinate] : []), ...(destination ? [destination.coordinate] : [])];
    camera.current?.fitBounds([Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
      Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))], { padding: { top: 35, right: 35, bottom: 35, left: 35 }, duration: 400 });
  }
  function edit(value: string, which: Field) {
    setField(which); setInputMode('search'); setSearching(true); clearRoute();
    if (which === 'origin') { setStartText(value); setOrigin(null); setOriginalOrigin(null); } else { setEndText(value); setDestination(null); }
  }
  function choose(coordinate: Coordinate, label: string, which: Field = field) {
    try {
      if (!insidePilot(coordinate, dataset)) throw new Error('Select a point inside the current service area.');
      let selection: Choice = { label, coordinate };
      if (transport !== 'driving') { try { selection = selectLocation(label, coordinate, dataset); } catch { /* Keep the raw pin for explicit nearby-access planning. */ } }
      clearRoute(); setSearching(false); Keyboard.dismiss();
      if (which === 'origin') { setOrigin(selection); setOriginalOrigin(null); setStartText(label); setField('destination'); }
      else { setDestination(selection); setEndText(label); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to select that location.'); }
  }
  const routeResults = useCallback((response: DemoRouteResponse): ModeResult[] => {
    return response.options.map(option => {
      const source = option.route;
      if (!source) return { mode: option.mode, route: null, unavailableReason: option.unavailable_reason ?? undefined };
      const coordinates = source.geometry.coordinates.map(point => [point[0], point[1]] as Coordinate);
      const cumulative = geometryDistances(coordinates);
      const facilityIds = new Set(source.demo_facility_ids ?? []);
      const snap = (coordinate: Coordinate, distance: number, id: string) => ({ edgeId: id, coordinate, distance, offset: 0 });
      const route: Route = {
        id: source.route_id,
        maneuvers: source.maneuvers.map(step => ({ instruction: step.instruction, coordinate: step.coordinate,
          type: step.type, distanceFromStart: step.begin_shape_index === undefined
            ? step.distance_from_start_meters * (cumulative.at(-1)! / source.distance_meters)
            : cumulative[step.begin_shape_index] ?? step.distance_from_start_meters })),
        profile: transport === 'wheelchair' ? 'wheelchair' : 'walking', mode: option.mode,
        distance: source.distance_meters, seconds: source.duration_seconds, coordinates, segments: [],
        facilities: dataset.facilities.filter(item => facilityIds.has(item.id)),
        originSnap: snap(coordinates[0], source.origin_snap_distance_meters, `${source.route_id}-start`),
        destinationSnap: snap(coordinates[coordinates.length - 1], source.destination_snap_distance_meters, `${source.route_id}-end`),
        dataSource: dataset.source, fieldVerified: false,
      };
      return { mode: option.mode, route };
    });
  }, [dataset, transport]);

  const rerouteFromPosition = useCallback(async (point: Coordinate): Promise<boolean> => {
    if (!guidanceActive.current || !destination || transport === 'driving') return false;
    if (!insidePilot(point, dataset)) throw new Error('You are outside the selected service area. Return to coverage or choose another area.');
    const requestId = ++routeRequest.current;
    const { data: session, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.session?.access_token) throw new Error('Sign in again to recalculate your route.');
    if (!guidanceActive.current || requestId !== routeRequest.current) return false;
    const response = await demoAreasApi.getRoutes(session.session.access_token, areaId, {
      origin: { longitude: point[0], latitude: point[1] },
      destination: { longitude: destination.coordinate[0], latitude: destination.coordinate[1] },
      profile: transport, start_candidates: [],
    });
    if (!guidanceActive.current || requestId !== routeRequest.current) return false;
    const next = routeResults(response);
    const selectedRoute = next.find(item => item.mode === mode);
    if (response.adjusted_start || !selectedRoute?.route) throw new Error(selectedRoute?.unavailableReason ?? 'No route is available for your selected route type. The destination and route type have been kept.');
    setResults(next);
    setOrigin({ coordinate: point, label: 'Current location · updated route' });
    setStartText('Current location · updated route'); setOriginalOrigin(null);
    setWaitForAdjustedStart(false); setRouteReady(true); setError('');
    return true;
  }, [areaId, dataset, destination, mode, routeResults, transport]);

  function toggleGuidance() {
    guidanceActive.current = !navigating;
    followCamera.current = true;
    if (navigating) { routeRequest.current += 1; setGpsPosition(null); setGuidanceTarget(null); }
    setNavigating(!navigating); setRouteReady(!waitForAdjustedStart);
  }

  async function showRoutes() {
    Keyboard.dismiss(); setSearching(false); clearRoute();
    if (!origin || !destination) { setError('Select both locations using the map or search results.'); return; }
    const requestId = routeRequest.current;
    try {
      if (transport === 'driving') throw new Error('Use Open driving navigation for car travel.');
      if (areaId === 'built-in-snapshot') throw new Error('Connect to a server-provided service area to calculate demo routes with the backend.');
      setCalculating(true);
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.session?.access_token) throw new Error('Sign in again to calculate demo routes.');
      const candidates = transport === 'wheelchair' ? [] : nearbyAccessPoints(origin.coordinate, dataset, MAX_START_ADJUSTMENT_METERS, 8)
        .filter(point => meters(point.coordinate, origin.coordinate) > 3)
        .map(point => ({ longitude: point.coordinate[0], latitude: point.coordinate[1] }));
      const response = await demoAreasApi.getRoutes(session.session.access_token, areaId, {
        origin: { longitude: origin.coordinate[0], latitude: origin.coordinate[1] },
        destination: { longitude: destination.coordinate[0], latitude: destination.coordinate[1] },
        profile: transport, start_candidates: candidates,
      });
      if (requestId !== routeRequest.current) return;
      const next = routeResults(response);
      if (response.adjusted_start) {
        const candidateRoute = next.find(item => item.mode === 'shortest')?.route ?? next.find(item => item.route)?.route;
        if (!candidateRoute) throw new Error('A nearby connected starting point was found, but no route is available from it.');
        const selectedCoordinate: Coordinate = [response.selected_origin.longitude, response.selected_origin.latitude];
        const from = { edgeId: `${candidateRoute.originSnap.edgeId}-adjusted`, coordinate: selectedCoordinate, distance: response.start_adjustment_meters, offset: 0 };
        setAlternative({ from, to: candidateRoute.destinationSnap, results: next,
          startGap: response.start_adjustment_meters, endGap: candidateRoute.destinationSnap.distance, connectorVerified: false });
        setAdjustmentVisible(true);
        fitRoute(candidateRoute);
        setError('A nearby connected starting point is available. Accept or choose another starting point.');
      } else {
        setResults(next);
        const required = transport === 'wheelchair' ? 'accessible' : 'shortest';
        const available = next.find(item => item.mode === required && item.route) ?? next.find(item => item.route);
        setMode(available?.mode ?? required);
        if (!available) setError(next.find(item => item.mode === required)?.unavailableReason ??
          (transport === 'wheelchair' ? 'No connected step-free path is recorded for these places.' : 'No connected mapped walking route was found within 100 m of the selected start.'));
        else if (available.route) fitRoute(available.route);
      }
    } catch (failure) {
      if (requestId === routeRequest.current) setError(failure instanceof Error ? failure.message : 'Unable to calculate routes.');
    } finally {
      if (requestId === routeRequest.current) setCalculating(false);
    }
  }
  function acceptStartAdjustment() {
    if (!alternative || !origin) return;
    const previous = origin, candidate = alternative;
    setOriginalOrigin(previous);
    setOrigin({ label: 'Nearby connected starting point', coordinate: candidate.from.coordinate, snap: candidate.from });
    setStartText(`Connected start · ${formatDistance(candidate.startGap)} from selected point`);
    setResults(candidate.results); setAlternative(null); setAdjustmentVisible(false);
    setWaitForAdjustedStart(true); setRouteReady(false); setNavigating(false); setMode('shortest'); setError('');
    approachCameraCentered.current = false;
    const selectedRoute = candidate.results.find(item => item.mode === 'shortest')?.route;
    if (selectedRoute) fitRoute(selectedRoute);
  }
  function declineStartAdjustment() {
    setAlternative(null); setAdjustmentVisible(false); setResults([]); setNavigating(false);
    setWaitForAdjustedStart(false); setRouteReady(true); setGpsPosition(null); setGuidanceTarget(null);
    setOrigin(null); setOriginalOrigin(null); setStartText(''); setField('origin'); setSearching(false);
    setError('Choose a different starting point. The destination is unchanged.');
  }
  function metersForAccess(i: number, coordinate: Coordinate) { return meters((i === 0 ? origin : destination)!.coordinate, coordinate); }
  async function openDriving() {
    setError(''); Keyboard.dismiss(); setSearching(false);
    if (!origin || !destination) { setError('Select both locations using the map or search results.'); return; }
    try { await Linking.openURL(drivingDirectionsUrl(origin.coordinate, destination.coordinate, dataset)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to open driving directions.'); }
  }
  const handleGuidancePosition = useCallback((point: Coordinate | null) => {
    setGpsPosition(point);
    if (!point) approachCameraCentered.current = false;
    else if (guidanceActive.current && followCamera.current) camera.current?.easeTo({ center: point, zoom: 17, duration: 500 });
  }, []);
  const handleGuidanceComplete = useCallback(() => { guidanceActive.current = false; routeRequest.current += 1; }, []);
  useEffect(() => {
    if (!navigating || !waitForAdjustedStart || routeReady || !gpsPosition || !origin || approachCameraCentered.current) return;
    const points = [gpsPosition, origin.coordinate];
    camera.current?.fitBounds([Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
      Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))], { padding: { top: 60, right: 60, bottom: 60, left: 60 }, duration: 350 });
    approachCameraCentered.current = true;
  }, [gpsPosition, navigating, waitForAdjustedStart, routeReady, origin]);

  async function locate(useAsStart: boolean) {
    if (locationBusy.current) return;
    locationBusy.current = true;
    const request = ++locationRequest.current;
    setLocating(true); setLocationStatus('Finding your location…');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (request !== locationRequest.current) return;
      if (permission.status !== 'granted') throw new Error('Allow location permission in your phone settings, or choose a point on the map.');
      if (!await Location.hasServicesEnabledAsync()) throw new Error('Turn on your phone location services and try again.');
      if (request !== locationRequest.current) return;
      const value = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Location took too long. Try again outdoors or select a point on the map.')), 20000); }),
      ]);
      if (request !== locationRequest.current) return;
      const point: Coordinate = [value.coords.longitude, value.coords.latitude];
      setLastLocation(point);
      camera.current?.easeTo({ center: point, zoom: 16, duration: 400 });
      if (useAsStart && insidePilot(point, dataset)) choose(point, 'Current location', 'origin');
      setLocationStatus(!insidePilot(point, dataset)
        ? 'You are outside the selected service area. Your starting point is unchanged; use Show area or switch service area.'
        : `Location updated${value.coords.accuracy == null ? '' : ` · accuracy approximately ${Math.round(value.coords.accuracy)} m`}.`);
    } catch (failure) {
      if (request === locationRequest.current) setLocationStatus(failure instanceof Error ? failure.message : 'Could not get your location. Try again.');
    } finally {
      if (timeout) clearTimeout(timeout);
      locationBusy.current = false;
      if (request === locationRequest.current) setLocating(false);
    }
  }
  function recentre() {
    if (gpsPosition) camera.current?.easeTo({ center: gpsPosition, zoom: 16, duration: 400 });
    else void locate(false);
  }

  return <View style={styles.container}>
    <Text style={styles.title}>Around your neighbourhood.</Text>
    <Text style={styles.subtitle}>Facilities and community-reported issues, at a glance.</Text>
    <Text style={styles.demoBadge}>Demo · {dataset.name}</Text>
    <View style={styles.transportRow} accessibilityRole="tablist">
      {transports.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.name}
        accessibilityState={{ selected: transport === item.id }} onPress={() => changeTransport(item.id)}
        style={[styles.transportButton, transport === item.id && styles.selectedCard]}>
        <MaterialCommunityIcons name={item.icon} size={24} color={colors.navy} />
        <Text style={styles.transportLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{item.name}</Text>
      </Pressable>)}
    </View>
    {transport === 'driving' ? <Text style={styles.hint}>Car navigation opens Google Maps with your selected locations. Demo facility restrictions are not sent to Google Maps.</Text> :
      transport === 'wheelchair' ? <Text style={styles.hint}>Wheelchair travel uses step-free paths and avoids reported damage. Demo access conditions are not field verified.</Text> :
        <Text style={styles.hint}>Walking: shortest, avoid damaged facilities, or verified step-free route. Verification is simulated in this demo.</Text>}
    <View accessibilityLabel="Location selection method" style={styles.row}>
      {(['search', 'map'] as const).map(method => <Pressable key={method} accessibilityRole="button"
        accessibilityState={{ selected: inputMode === method }} onPress={() => { setInputMode(method); setSearching(method === 'search'); Keyboard.dismiss(); }}
        style={[styles.pointButton, inputMode === method && styles.selectedCard]}>
        <Text style={styles.cardTitle}>{method === 'search' ? 'Address / place name' : 'Pick on map'}</Text>
      </Pressable>)}
    </View>
    <View style={styles.endpoints}>
      <View style={styles.endpoint}>
        <Text style={styles.fieldLabel}>Starting point</Text>
        <TextInput accessibilityLabel="Starting point" value={startText} onChangeText={value => edit(value, 'origin')}
          onFocus={() => { setField('origin'); setInputMode('search'); setSearching(true); }} placeholder="Enter address or place name"
          placeholderTextColor={colors.muted} autoCorrect={false} style={styles.locationInput} />
        <SavedPlacesControl field="starting point" current={origin} disabled={navigating}
          onChoose={point => { choose(point.coordinate, point.label, 'origin'); camera.current?.easeTo({ center: point.coordinate, zoom: 16, duration: 400 }); }} />
        {originalOrigin && origin ? <Text style={styles.hint}>Updated {formatDistance(meters(originalOrigin.coordinate, origin.coordinate))} from your original start</Text> : transport !== 'driving' && origin?.snap && <Text style={styles.hint}>Mapped access {Math.round(origin.snap.distance)} m from selection</Text>}
      </View>
      <View style={styles.divider} />
      <View style={styles.endpoint}>
        <Text style={styles.fieldLabel}>End point</Text>
        <TextInput accessibilityLabel="End point" value={endText} onChangeText={value => edit(value, 'destination')}
          onFocus={() => { setField('destination'); setInputMode('search'); setSearching(true); }} placeholder="Enter address or place name"
          placeholderTextColor={colors.muted} autoCorrect={false} style={styles.locationInput} />
        <SavedPlacesControl field="destination" current={destination} disabled={navigating}
          onChoose={point => { choose(point.coordinate, point.label, 'destination'); camera.current?.easeTo({ center: point.coordinate, zoom: 16, duration: 400 }); }} />
        {transport !== 'driving' && destination?.snap && <Text style={styles.hint}>Road access {Math.round(destination.snap.distance)} m from selection</Text>}
      </View>
    </View>
    {inputMode === 'search' && searching && <PlaceSearch areaId={areaId} query={field === 'origin' ? startText : endText}
      field={field === 'origin' ? 'starting point' : 'destination'}
      local={suggestions.map(p => ({ id: p.id, label: p.name, coordinate: p.coordinate, address: '', basis: p.positionBasis }))}
      onChoose={p => { choose(p.coordinate, p.label); camera.current?.easeTo({ center: p.coordinate, zoom: 16, duration: 400 }); }} />}
    <View style={styles.row}>
      {(['origin', 'destination'] as Field[]).map(which => <Pressable key={which} accessibilityRole="button"
        accessibilityLabel={which === 'origin' ? 'Pick starting point on map' : 'Pick end point on map'}
        accessibilityState={{ selected: inputMode === 'map' && field === which }}
        onPress={() => { setField(which); setInputMode('map'); setSearching(false); Keyboard.dismiss(); }} style={[styles.pointButton, inputMode === 'map' && field === which && styles.selectedCard]}>
        <Text style={styles.cardTitle}>{which === 'origin' ? '1. Starting point' : '2. End point'}</Text>
        <Text style={styles.body}>{inputMode === 'map' && field === which ? 'Tap map to choose' : 'Pick on map'}</Text>
      </Pressable>)}
    </View>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" disabled={locating || navigating} onPress={() => void locate(true)} style={styles.textButton}>
        <Text style={styles.link}>{locating ? 'Locating…' : 'Use current location as start'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={locating} onPress={recentre} style={styles.textButton}><Text style={styles.link}>Recentre</Text></Pressable>
    </View>
    {locationStatus ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{locationStatus}</Text> : null}
    <View style={styles.mapContainer} onTouchStart={() => { followCamera.current = false; onMapTouchChange?.(true); }}
      onTouchEnd={event => { if (event.nativeEvent.touches.length === 0) onMapTouchChange?.(false); }}
      onTouchCancel={() => onMapTouchChange?.(false)}>
      <Map key={mapKey} style={styles.map} mapStyle={dataset.styleUrl} androidView="texture" compass attribution dragPan touchZoom doubleTapZoom
        onPress={event => { Keyboard.dismiss(); if (inputMode !== 'map') return; const p = event.nativeEvent.lngLat; choose(p, field === 'origin' ? 'Selected starting point' : 'Selected destination'); }}
        onDidFailLoadingMap={() => setMapError(true)} onDidFinishLoadingMap={() => setMapError(false)}>
        <Camera ref={camera} initialViewState={{ bounds, padding: { top: 15, right: 15, bottom: 15, left: 15 } }} />
        {alternative?.results[0]?.route && <GeoJSONSource id="demo-suggested-route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: alternative.results[0].route.coordinates } }}>
          <Layer id="demo-suggested-route-line" type="line" paint={{ 'line-color': '#2675D8', 'line-width': 4, 'line-dasharray': [2, 2] }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        </GeoJSONSource>}
        {route && (!navigating || routeReady) && <GeoJSONSource id="demo-selected-route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coordinates } }}>
          <Layer id="demo-route-line" type="line" paint={{ 'line-color': routeColors[mode], 'line-width': 5 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        </GeoJSONSource>}
        {route && ([route.originSnap, route.destinationSnap] as const).map((snap, i) => metersForAccess(i, snap.coordinate) > 3 && <Marker key={'access-' + i} id={'demo-access-' + i} lngLat={snap.coordinate}>
          <View collapsable={false} style={[styles.marker, styles.accessPin]}><Text style={styles.pinText}>{i === 0 ? 'A' : 'B'}</Text></View>
        </Marker>)}
        {originalOrigin && <Marker id="demo-original-start" lngLat={originalOrigin.coordinate}>
          <View collapsable={false} style={[styles.marker, styles.originalPin]}><Text style={styles.pinText}>O</Text></View>
        </Marker>}
        {alternative && <Marker id="demo-suggested-start" lngLat={alternative.from.coordinate}>
          <View collapsable={false} style={[styles.marker, styles.suggestedPin]}><Text style={styles.pinText}>N</Text></View>
        </Marker>}
        {guidanceTarget && <Marker id="demo-guidance-target" lngLat={guidanceTarget}><View collapsable={false} style={[styles.marker, styles.accessPin]}><Text style={styles.pinText}>Next</Text></View></Marker>}
        {(gpsPosition || lastLocation) && <Marker id="demo-gps" lngLat={(gpsPosition || lastLocation)!}><View collapsable={false} style={[styles.marker, styles.accessPin]}><Text style={styles.pinText}>Me</Text></View></Marker>}
        <GeoJSONSource id="demo-places" data={placeData} hitbox={{ top: 8, right: 8, bottom: 8, left: 8 }}
          onPress={event => { event.stopPropagation(); const id = event.nativeEvent.features[0]?.properties?.id; if (typeof id === 'string') { setSelected({ type: 'place', id }); setSearching(false); Keyboard.dismiss(); } }}>
          <Layer id="demo-place-points" type="circle" minzoom={15} paint={{ 'circle-radius': 4, 'circle-color': '#175CD3', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1 }} />
        </GeoJSONSource>
        <GeoJSONSource id="demo-facilities" data={facilityData} hitbox={{ top: 10, right: 10, bottom: 10, left: 10 }}
          onPress={event => { event.stopPropagation(); const id = event.nativeEvent.features[0]?.properties?.id; if (typeof id === 'string') { setSelected({ type: 'facility', id }); setSearching(false); Keyboard.dismiss(); } }}>
          <Layer id="demo-facility-points" type="circle" paint={{ 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 16, 10],
            'circle-color': ['case', ['get', 'blocked'], '#A63E37', '#247A80'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 }} />
          <Layer id="demo-facility-labels" type="symbol" minzoom={15.5} layout={{ 'text-field': ['get', 'symbol'], 'text-font': ['Noto Sans Regular'], 'text-size': 9, 'text-allow-overlap': true }} paint={{ 'text-color': '#FFFFFF' }} />
        </GeoJSONSource>
        {feature && selectedMarkerData && <GeoJSONSource id="demo-selection-highlight" data={selectedMarkerData}>
          <Layer id="demo-selection-shadow" type="circle" paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 12, 5, 14, 7, 16, 9, 18, 11],
            'circle-color': ['get', 'color'], 'circle-opacity': 0.28,
            'circle-translate': [2, 3], 'circle-blur': 0.35,
          }} />
          <Layer id="demo-selection-halo" type="circle" paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 12, 5.5, 14, 7, 16, 9, 18, 11],
            'circle-color': ['get', 'color'], 'circle-opacity': 0.1,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 1.6, 18, 2],
          }} />
        </GeoJSONSource>}
        {([origin, destination] as const).map((p, i) => p && <Marker key={i} id={'demo-endpoint-' + i} lngLat={p.coordinate}>
          <View collapsable={false} style={[styles.endpointFrame, field === (i === 0 ? 'origin' : 'destination') && styles.activeEndpointFrame]}>
            <View style={[styles.marker, i === 1 && styles.destinationPin]}><Text style={styles.pinText}>{i === 0 ? 'S' : 'D'}</Text></View>
          </View>
        </Marker>)}
      </Map>
      {mapError && <View style={styles.mapErrorCard}><Text style={styles.cardTitle}>Could not load map</Text>
        <Text style={styles.body}>Check your internet connection.</Text>
        <Pressable accessibilityRole="button" onPress={() => { setMapError(false); setMapKey(n => n + 1); }} style={styles.textButton}><Text style={styles.link}>Retry map</Text></Pressable>
      </View>}
    </View>
    <View style={styles.row}><Text style={styles.count}>{dataset.facilities.length} facilities · {dataset.facilities.filter(f => isBlocked(f, state)).length} reported issues in the pilot area</Text>
      <Pressable accessibilityRole="button" onPress={() => camera.current?.fitBounds(bounds, { padding: { top: 15, right: 15, bottom: 15, left: 15 }, duration: 400 })} style={styles.textButton}><Text style={styles.link}>Show area</Text></Pressable></View>
    <Text style={styles.hint}>Red: reported damage · Teal: facilities · Blue: real places. A gold frame marks your selection. {inputMode === 'map' ? `Tap the map to choose ${field === 'origin' ? 'your start' : 'your destination'}.` : 'Search for an address or place above, or switch to Pick on map.'}</Text>
    {feature && <View style={styles.selectedPanel}>
      <Text style={styles.cardTitle}>{feature.name}</Text>
      <Text style={styles.body}>{facility ? `${facility.kind.replaceAll('_', ' ')} · ${isBlocked(facility, state) ? `${facility.reporters} residents reported` : 'No confirmed damage'}` : 'Real mapped landmark'}</Text>
      <Text style={styles.hint}>{facility ? 'Fictional facility data for this resident demo.' : place?.positionBasis}</Text>
      <View style={styles.row}>{(['origin', 'destination'] as Field[]).map(which => <Pressable key={which} accessibilityRole="button"
        onPress={() => choose(feature.coordinate, feature.name, which)} style={styles.textButton}><Text style={styles.link}>{which === 'origin' ? 'Use as start' : 'Use as end'}</Text></Pressable>)}
        <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.textButton}><Text style={styles.link}>Close</Text></Pressable></View>
    </View>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {(transport === 'driving' || (results.length === 0 && !adjustmentVisible)) && <Pressable accessibilityRole="button"
      disabled={calculating} onPress={transport === 'driving' ? () => void openDriving() : showRoutes} style={styles.chooseButton}>
      <Text style={styles.chooseButtonText}>{transport === 'driving' ? 'Open driving navigation' : calculating ? 'Calculating routes…' : 'Choose route'}</Text></Pressable>}
    {originalOrigin && <View style={styles.selectedPanel}><Text style={styles.cardTitle}>Starting point updated</Text><Text style={styles.body}>Original point O stays on the map as a reference. The route now starts from S, the connected point you accepted.</Text><Text style={styles.hint}>The transfer between O and S is not a mapped or verified path.</Text></View>}
    {route && origin && destination && <>
      <Pressable accessibilityRole="button" onPress={toggleGuidance} style={styles.chooseButton}><Text style={styles.chooseButtonText}>{navigating ? 'Close route guidance' : waitForAdjustedStart ? 'Go to adjusted starting point' : 'Start Enclave guidance'}</Text></Pressable>
      {navigating && <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={toggleGuidance}>
        <JourneyGuidance route={route} origin={origin.coordinate} destination={destination.coordinate} waitForStart={waitForAdjustedStart} onRouteReady={setRouteReady} onPosition={handleGuidancePosition} onTarget={setGuidanceTarget} onReroute={rerouteFromPosition} onComplete={handleGuidanceComplete}
          presentation={{ styleUrl: dataset.styleUrl, onClose: toggleGuidance }} />
      </Modal>}
    </>}
    {navigating && guidanceTarget && <Pressable accessibilityRole="button" onPress={() => camera.current?.easeTo({ center: guidanceTarget, zoom: 18, duration: 400 })} style={styles.textButton}><Text style={styles.link}>Focus next point</Text></Pressable>}
    {navigating && gpsPosition && <Pressable accessibilityRole="button" onPress={() => { followCamera.current = true; camera.current?.easeTo({ center: gpsPosition, zoom: 17, duration: 400 }); }} style={styles.textButton}><Text style={styles.link}>Follow my location</Text></Pressable>}
    {results.length > 0 && <>
      <Text style={styles.title}>Choose your route.</Text>
      {results.map(result => <Pressable key={result.mode} accessibilityRole="radio" accessibilityState={{ checked: result.mode === mode, disabled: !result.route }} disabled={!result.route}
        onPress={() => { routeRequest.current += 1; guidanceActive.current = false; setMode(result.mode); setSelected(null); setNavigating(false); setGpsPosition(null); setGuidanceTarget(null); if (result.route) fitRoute(result.route); }} style={[styles.routeCard, result.mode === mode && styles.selectedCard]}>
        <Text style={styles.cardTitle}>{labels[result.mode]} · {result.route ? formatDistance(result.route.distance) : 'Unavailable'}</Text>
        <Text style={styles.body}>{result.mode === 'shortest' ? 'Minimum mapped distance; may pass stairs or reported damage.' : result.mode === 'avoid_damage' ? 'Avoids confirmed damage; may use stairs.' : 'Avoids stairs and damage. Demo verification only; not field verified.'}</Text>
        {result.route ? <Text style={styles.body}>{Math.ceil(result.route.seconds / 60)} min estimate · {result.route.facilities.filter(f => isBlocked(f, state)).length} reported issues on route · {result.route.facilities.length} facilities</Text> :
          <Text style={styles.body}>{result.unavailableReason ?? 'No eligible connected path for these selected road access points.'}</Text>}
      </Pressable>)}
      {route && <View style={styles.selectedPanel}>
        <Text style={styles.cardTitle}>Facilities on this route</Text>
        {route.facilities.length ? route.facilities.map(f => <Text key={f.id} style={isBlocked(f, state) ? styles.error : styles.body}>
          {f.name} · {isBlocked(f, state) ? 'Reported damage' : f.kind === 'stairs' ? 'Stairs' : 'No confirmed damage'}</Text>) : <Text style={styles.body}>No demo facilities intersect this path.</Text>}
        <Text style={styles.hint}>The destination stays fixed. If you accepted a nearby connected start, O marks your original point and S marks the updated point. Mapped access points are shown separately; unrecorded connections are not drawn as roads. Routes can be identical when no relevant restrictions affect this journey.</Text>
      </View>}
    </>}
    <Modal visible={adjustmentVisible && Boolean(alternative)} transparent animationType="fade" onRequestClose={declineStartAdjustment}>
      <View style={styles.modalOverlay}><View style={styles.modalCard}>
        <Text style={styles.modalEyebrow}>STARTING POINT SUGGESTION</Text>
        <Text style={styles.cardTitle}>Move your starting point to a nearby connected place?</Text>
        <Text style={styles.body}>A mapped walking route reaches your destination from this point. It is {formatDistance(alternative?.startGap ?? 0)} from your selected start and within the {MAX_START_ADJUSTMENT_METERS} m demo limit.</Text>
        <Text style={styles.body}>Accepting updates the starting point for this trip. The map marks the original point O and suggested point N. After you accept, navigation first waits for you to reach the new start.</Text>
        <Pressable accessibilityRole="button" onPress={acceptStartAdjustment} style={styles.chooseButton}><Text style={styles.chooseButtonText}>Accept and update start</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={declineStartAdjustment} style={styles.textButton}><Text style={styles.link}>No, let me choose another start</Text></Pressable>
      </View></View>
    </Modal>
    {onReportPress && <Pressable accessibilityRole="button" onPress={onReportPress} style={styles.textButton}><Text style={styles.link}>Report an issue</Text></Pressable>}
    <Text style={styles.hint}>Only facility and access conditions are fictional. Roads and landmarks: OpenStreetMap contributors (ODbL). Basemap: OpenFreeMap. Step-free conditions are not field verified.</Text>
    <Pressable accessibilityRole="button" onPress={onShowLiveMap} style={styles.textButton}><Text style={styles.link}>Open live community map</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 10 }, title: { fontSize: 24, lineHeight: 34, fontWeight: '700', color: colors.navy },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.muted }, demoBadge: { fontSize: 11, color: colors.navy, alignSelf: 'flex-start', backgroundColor: colors.lavender, padding: 6, borderRadius: 6 },
  endpoints: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 12 }, endpoint: { gap: 4 },
  fieldLabel: { fontSize: 11, lineHeight: 16, color: colors.muted }, locationInput: { padding: 0, margin: 0, fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.navy, includeFontPadding: false },
  divider: { height: 1, backgroundColor: colors.border }, suggestion: { padding: 12, gap: 3, backgroundColor: colors.white, borderRadius: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, pointButton: { flex: 1, padding: 10, gap: 4, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  transportRow: { flexDirection: 'row', gap: 8 },
  transportButton: { flex: 1, minWidth: 0, height: 78, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  transportLabel: { color: colors.navy, fontSize: 12, fontWeight: '600' },
  mapContainer: { width: '100%', height: 320, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.lavender }, map: { flex: 1 },
  marker: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.navy, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  endpointFrame: { padding: 3, borderRadius: 9, borderWidth: 3, borderColor: 'transparent' },
  activeEndpointFrame: { borderColor: '#D99A13', backgroundColor: '#FFF3D0' },
  accessPin: { backgroundColor: '#BD6509' }, originalPin: { backgroundColor: '#8790A0' }, suggestedPin: { backgroundColor: '#2675D8' }, destinationPin: { backgroundColor: '#247A80' }, pinText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  mapErrorCard: { position: 'absolute', top: 16, right: 16, left: 16, padding: 14, borderRadius: 14, backgroundColor: colors.white, gap: 6 },
  count: { flex: 1, color: colors.muted, fontSize: 12 }, hint: { fontSize: 11, lineHeight: 17, color: colors.muted },
  body: { fontSize: 12, lineHeight: 18, color: colors.muted }, cardTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.navy },
  selectedPanel: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  textButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }, link: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.navy },
  chooseButton: { minHeight: 50, padding: 14, borderRadius: 16, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  chooseButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.white },
  routeCard: { backgroundColor: colors.white, padding: 14, gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border }, selectedCard: { borderColor: colors.navy, backgroundColor: '#E8F1F4' },
  modalOverlay: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: '#15203788' },
  modalCard: { borderRadius: 18, padding: 18, gap: 10, backgroundColor: colors.white },
  modalEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#247A80' },
  error: { color: '#A63E37', fontSize: 12, lineHeight: 18 },
});
