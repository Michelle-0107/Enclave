import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Camera,
  Map,
  Marker,
  type CameraRef,
} from '@maplibre/maplibre-react-native';

import {
  navigationApi,
  reportsApi,
  type MapIssueFeature,
  type NavigationArea,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import SavedPlacesControl from '../savedPlaces/SavedPlacesControl';
import type { PlacePoint } from '../savedPlaces/store';
import PlaceSearch from '../navigation/PlaceSearch';

export type MapEndpoints = { area?: NavigationArea; origin: { latitude: number; longitude: number } | null; destination: { latitude: number; longitude: number } | null };

type Props = {
  navigationArea?: NavigationArea;
  onReportPress: () => void;
  onMapTouchChange?: (active: boolean) => void;
  onChooseRoute?: (
    start: string,
    destination: string,
    points: MapEndpoints,
  ) => void;
};

const MAP_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

// Overview derived from the pilot bounds in the backend contract.
// This is not a destination or a damaged facility.
const PILOT_CENTER: [number, number] = [
  101.731,
  3.226,
];

function formatFacilityType(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function faultLabel(issue: MapIssueFeature): string {
  return issue.properties.fault_kind === 'obstruction'
    ? 'Obstruction'
    : 'Damage';
}

export default function MapScreen({
  navigationArea,
  onReportPress,
  onChooseRoute,
  onMapTouchChange,
}: Props) {
  const [start, setStart] = useState('');
  const [destination, setDestination] = useState('');
  const [startPlace, setStartPlace] = useState<PlacePoint | null>(null);
  const [endPlace, setEndPlace] = useState<PlacePoint | null>(null);
  const [selecting, setSelecting] = useState<'origin' | 'destination'>('origin');
  const [inputMode, setInputMode] = useState<'search' | 'map'>('map');
  const [searching, setSearching] = useState(false);
  const camera = useRef<CameraRef>(null);

  const [issues, setIssues] =
    useState<MapIssueFeature[]>([]);

  const [selectedIssueId, setSelectedIssueId] =
    useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [area, setArea] = useState<NavigationArea | null>(navigationArea ?? null);

  const [mapError, setMapError] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  useEffect(() => () => onMapTouchChange?.(false), [onMapTouchChange]);

  useEffect(() => {
    let mounted = true;

    async function loadIssues() {
      setIsLoading(true);
      setError('');

      try {
        const {
          data,
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!mounted) return;
        if (sessionError) throw sessionError;

        const accessToken = data.session?.access_token;

        if (!accessToken) {
          throw new Error(
            'Your session has expired. Please sign in again.',
          );
        }

        const loadedArea = await navigationApi.getArea(accessToken, navigationArea?.id);

        if (!mounted) return;
        setArea(loadedArea);
        if (loadedArea.community_issues_supported === false) {
          setIssues([]);
          return;
        }

        const loaded = new globalThis.Map<
          string,
          MapIssueFeature
        >();

        let offset = 0;

        while (mounted) {
          const response =
            await reportsApi.getCommunityIssues(
              accessToken,
              100,
              offset,
              loadedArea.bbox,
              false,
            );

          if (!mounted) return;

          for (const issue of response.features) {
            loaded.set(issue.id, issue);
          }

          if (!response.pagination.has_more) {
            break;
          }

          // Avoid repeating an empty or invalid page forever.
          if (response.pagination.returned <= 0) {
            throw new Error(
              'Unable to load all community issues. Please retry.',
            );
          }

          const nextOffset =
            response.pagination.offset +
            response.pagination.returned;

          if (nextOffset <= offset) {
            throw new Error(
              'Invalid pagination response. Please retry.',
            );
          }

          offset = nextOffset;
        }

        if (mounted) {
          setIssues(Array.from(loaded.values()));
        }
      } catch (loadError) {
        if (!mounted) return;

        // Do not leave stale markers presented as current data.
        setIssues([]);
        setSelectedIssueId(null);

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load community issues.',
        );
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadIssues();

    return () => {
      mounted = false;
    };
  }, [refreshKey, navigationArea?.id]);

  const selectedIssue =
    issues.find((issue) => issue.id === selectedIssueId) ??
    null;

  function handleRefresh() {
    setSelectedIssueId(null);
    setIssues([]);
    setRefreshKey((value) => value + 1);
  }

  function chooseLocation(point: PlacePoint, which: 'origin' | 'destination') {
    const [longitude, latitude] = point.coordinate;
    const [west, south, east, north] = area?.bbox ?? [101.7211, 3.2171, 101.7409, 3.2349];
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < west || longitude > east || latitude < south || latitude > north) {
      setError('Select a point inside the selected live service area.'); return;
    }
    setError('');
    Keyboard.dismiss(); setSearching(false); setSelectedIssueId(null);
    camera.current?.easeTo({ center: point.coordinate, zoom: 16, duration: 400 });
    if (which === 'origin') { setStartPlace(point); setStart(point.label); setSelecting('destination'); }
    else { setEndPlace(point); setDestination(point.label); }
  }

  function handleChooseRoute() {
    const startingPoint = start.trim();
    const endPoint = destination.trim();

    if (!startingPoint || !endPoint || !startPlace || !endPlace) {
      Alert.alert(
        'Choose your locations',
        'Choose both locations from search results, saved places, or the map.',
      );
      return;
    }

    if (!onChooseRoute) {
      Alert.alert(
        'Route setup required',
        'The route options screen is not connected yet.',
      );
      return;
    }

    // Carry numeric selections into the live routing page; names alone are labels.
    onChooseRoute(startingPoint, endPoint, {
      area: area ?? undefined,
      origin: startPlace ? { longitude: startPlace.coordinate[0], latitude: startPlace.coordinate[1] } : null,
      destination: endPlace ? { longitude: endPlace.coordinate[0], latitude: endPlace.coordinate[1] } : null,
    });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Around your neighbourhood.
      </Text>

      <Text style={styles.subtitle}>
        Community-reported issues, at a glance.
      </Text>

      <View accessibilityLabel="Location selection method" style={styles.methodRow}>
        {(['search', 'map'] as const).map(method => <Pressable key={method} accessibilityRole="button"
          accessibilityState={{ selected: inputMode === method }} onPress={() => { setInputMode(method); setSearching(method === 'search'); Keyboard.dismiss(); }}
          style={[styles.methodButton, inputMode === method && styles.activeMethod]}>
          <Text style={styles.fieldLabel}>{method === 'search' ? 'Address / place name' : 'Pick on map'}</Text>
        </Pressable>)}
      </View>
      <View style={styles.endpoints}>
        <View style={styles.endpoint}>
          <Text style={styles.fieldLabel}>
            Starting point
          </Text>

          <TextInput
            accessibilityLabel="Starting point"
            value={start}
            onChangeText={value => { setStart(value); setStartPlace(null); setSelecting('origin'); setInputMode('search'); setSearching(true); }}
            onFocus={() => { setSelecting('origin'); setInputMode('search'); setSearching(true); }}
            placeholder="Enter address or place name"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="next"
            style={styles.locationInput}
          />
          <SavedPlacesControl field="starting point" current={startPlace} onChoose={point => chooseLocation(point, 'origin')} />
        </View>

        <View style={styles.divider} />

        <View style={styles.endpoint}>
          <Text style={styles.fieldLabel}>
            End point
          </Text>

          <TextInput
            accessibilityLabel="End point"
            value={destination}
            onChangeText={value => { setDestination(value); setEndPlace(null); setSelecting('destination'); setInputMode('search'); setSearching(true); }}
            onFocus={() => { setSelecting('destination'); setInputMode('search'); setSearching(true); }}
            placeholder="Enter address or place name"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="done"
            style={styles.locationInput}
          />
          <SavedPlacesControl field="destination" current={endPlace} onChoose={point => chooseLocation(point, 'destination')} />
        </View>
      </View>

      {inputMode === 'search' && searching && area && <PlaceSearch areaId={area.id}
        query={selecting === 'origin' ? start : destination} field={selecting === 'origin' ? 'starting point' : 'destination'}
        onChoose={point => chooseLocation(point, selecting)} />}
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Pressable accessibilityRole="button" onPress={() => { setSelecting('origin'); setInputMode('map'); setSearching(false); Keyboard.dismiss(); }} style={{ padding: 12 }}><Text style={styles.fieldLabel}>Pick starting point{inputMode === 'map' && selecting === 'origin' ? ' ✓' : ''}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => { setSelecting('destination'); setInputMode('map'); setSearching(false); Keyboard.dismiss(); }} style={{ padding: 12 }}><Text style={styles.fieldLabel}>Pick destination{inputMode === 'map' && selecting === 'destination' ? ' ✓' : ''}</Text></Pressable>
      </View>
      <Text style={styles.subtitle}>{inputMode === 'map' ? `Tap the map to select your ${selecting === 'origin' ? 'starting point' : 'destination'}.` : 'Enter an address or place name above and choose a search result.'} You can also choose a saved place.</Text>
      <View style={styles.mapContainer}
        onTouchStart={() => onMapTouchChange?.(true)}
        onTouchEnd={event => { if (event.nativeEvent.touches.length === 0) onMapTouchChange?.(false); }}
        onTouchCancel={() => onMapTouchChange?.(false)}>
        <Map
          key={`${area?.id ?? 'loading'}-${mapKey}`}
          style={styles.map}
          mapStyle={area?.map_style_url || MAP_STYLE}
          androidView="texture"
          compass
          dragPan
          touchZoom
          doubleTapZoom
          onPress={event => {
            Keyboard.dismiss(); if (inputMode !== 'map') return;
            const [longitude, latitude] = event.nativeEvent.lngLat;
            chooseLocation({ label: selecting === 'origin' ? 'Selected starting point' : 'Selected destination', coordinate: [longitude, latitude] }, selecting);
          }}
          attribution
          onDidFinishLoadingMap={() => setMapError(false)}
          onDidFailLoadingMap={() => setMapError(true)}
        >
          <Camera
            ref={camera}
            initialViewState={{
              center: area?.center || PILOT_CENTER,
              zoom: 15,
            }}
          />
          {([startPlace, endPlace] as const).map((point, index) => point && <Marker key={`saved-endpoint-${index}`} id={`saved-endpoint-${index}`} lngLat={point.coordinate}>
            <View collapsable={false} style={[styles.endpointFrame, selecting === (index === 0 ? 'origin' : 'destination') && styles.activeEndpointFrame]}>
              <View style={{ backgroundColor: colors.navy, borderRadius: 20, padding: 10 }}><Text style={{ color: colors.white, fontWeight: '700' }}>{index === 0 ? 'S' : 'D'}</Text></View>
            </View>
          </Marker>)}
          {issues.map((issue) => (
            <Marker
              key={issue.id}
              id={issue.id}
              lngLat={issue.geometry.coordinates}
              onPress={event => { event.stopPropagation(); setSelectedIssueId(issue.id); Keyboard.dismiss(); setSearching(false); }}
            >
              <View
                collapsable={false}
                accessible
                accessibilityLabel={
                  `${issue.properties.facility_name}, ` +
                  `${faultLabel(issue)}, ` +
                  `${issue.properties.reporter_count} residents reported`
                }
                style={[
                  styles.marker,
                  issue.id === selectedIssueId &&
                    styles.selectedMarker,
                ]}
              >
                <Text style={styles.markerText}>!</Text>
              </View>
            </Marker>
          ))}
        </Map>

        {mapError && (
          <View style={styles.mapErrorCard}>
            <Text style={styles.closureTitle}>
              Could not load map
            </Text>

            <Text style={styles.closureDescription}>
              Check your internet connection.
            </Text>

            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => {
                setMapError(false);
                setMapKey((value) => value + 1);
              }}
            >
              <Text style={styles.reportLinkText}>
                Retry map
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.mapToolbar}>
        <Text style={styles.mapCount}>
          {isLoading
            ? 'Loading community issues…'
            : error
              ? 'Community issues unavailable'
              : `${issues.length} community issue${
                  issues.length === 1 ? '' : 's'
                } in this area`}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh community issues"
          disabled={isLoading}
          onPress={handleRefresh}
          style={({ pressed }) => [
            styles.textButton,
            (pressed || isLoading) && styles.pressed,
          ]}
        >
          <Text style={styles.reportLinkText}>
            Refresh
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.issueState}>
          <ActivityIndicator
            size="small"
            color={colors.navy}
          />

          <Text style={styles.mapHint}>
            Loading community issues…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.issueState}>
          <Text
            accessibilityRole="alert"
            style={styles.errorText}
          >
            {error}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={handleRefresh}
            style={styles.textButton}
          >
            <Text style={styles.reportLinkText}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : issues.length === 0 ? (
        <View style={styles.issueState}>
          <Text style={styles.cardTitle}>
            {area?.community_issues_supported === false ? 'Community issue coverage is not enabled in this temporary area.' : 'No community-confirmed issues in this area.'}
          </Text>

          <Text style={styles.mapHint}>
            Issues appear after reports from at least
            2 distinct verified residents.
          </Text>
        </View>
      ) : (
        <>
          {selectedIssue && (
            <View style={styles.selectedCard}>
              <Text style={styles.cardTitle}>
                {selectedIssue.properties.facility_name}
              </Text>

              <Text style={styles.closureDescription}>
                {formatFacilityType(
                  selectedIssue.properties.facility_type,
                )}
                {' · '}
                {faultLabel(selectedIssue)}
              </Text>

              <Text style={styles.closureDescription}>
                {selectedIssue.properties.reporter_count}
                {' residents reported · '}
                {selectedIssue.properties.status === 'open'
                  ? 'Open issue'
                  : 'Resolved issue'}
              </Text>

              <Text style={styles.closureDescription}>
                Community-reported; this does not imply
                an on-site inspection.
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedIssueId(null)}
                style={styles.textButton}
              >
                <Text style={styles.reportLinkText}>
                  Close details
                </Text>
              </Pressable>
            </View>
          )}

          {issues.map((issue) => (
            <Pressable
              key={issue.id}
              accessibilityRole="button"
              onPress={() => setSelectedIssueId(issue.id)}
              style={({ pressed }) => [
                styles.closureNotice,
                issue.id === selectedIssueId &&
                  styles.selectedNotice,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closureTitle}>
                {issue.properties.facility_name}
                {' · '}
                {faultLabel(issue)}
              </Text>

              <Text style={styles.closureDescription}>
                {issue.properties.reporter_count}
                {' residents reported · '}
                {formatFacilityType(
                  issue.properties.facility_type,
                )}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={handleChooseRoute}
        style={({ pressed }) => [
          styles.chooseButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.chooseButtonText}>
          Choose route
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onReportPress}
        style={({ pressed }) => [
          styles.reportLink,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.reportLinkText}>
          Report an issue
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  title: {
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '700',
    color: colors.navy,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  endpoints: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  endpoint: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  locationInput: {
    padding: 0,
    margin: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
    includeFontPadding: false,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  mapContainer: {
    width: '100%',
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.lavender,
  },
  map: {
    flex: 1,
  },
  marker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#A63E37',
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedMarker: {
    width: 50,
    height: 50,
    borderColor: '#D99A13',
    borderWidth: 4,
    borderRadius: 25,
    shadowColor: '#1B2633',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.38,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 2,
  },
  endpointFrame: { padding: 3, borderRadius: 9, borderWidth: 3, borderColor: 'transparent' },
  activeEndpointFrame: { borderColor: '#D99A13', backgroundColor: '#FFF3D0' },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodButton: { flex: 1, minHeight: 44, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, justifyContent: 'center' },
  activeMethod: { borderColor: colors.navy, backgroundColor: colors.lavender },
  markerText: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.white,
  },
  mapErrorCard: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.white,
    gap: 6,
  },
  mapToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mapCount: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  mapHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  closureNotice: {
    backgroundColor: '#FDE8E7',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  selectedNotice: {
    borderColor: colors.navy,
  },
  closureTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#A63E37',
  },
  closureDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  selectedCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  issueState: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 18,
    gap: 8,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#A63E37',
  },
  textButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  chooseButton: {
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooseButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.white,
  },
  reportLink: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  reportLinkText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.navy,
  },
  pressed: {
    opacity: 0.8,
  },
});
