import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
} from '@maplibre/maplibre-react-native';

import {
  ApiError,
  navigationApi,
  type NavigationPoint,
  type NavigationArea,
  type NavigationRouteResponse,
  type RouteMode,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import SavedPlacesControl from '../savedPlaces/SavedPlacesControl';

export type RouteOption = {
  id: 'A' | 'B' | 'C';
  name: string;
  distance: string;
  minutes: number;
  description: string;
  navigation: NavigationRouteResponse;
};

type Props = {
  navigationArea?: NavigationArea;
  start: string;
  destination: string;
  initialOrigin?: NavigationPoint | null;
  initialDestination?: NavigationPoint | null;
  onBack: () => void;
  onMapTouchChange?: (active: boolean) => void;
  onStartJourney: (route: RouteOption, points: { origin: NavigationPoint; destination: NavigationPoint }, names: { start: string; destination: string }) => void;
};

type ModeResult = {
  mode: RouteMode;
  route?: RouteOption;
  error?: string;
};

const MODES: {
  mode: RouteMode;
  id: RouteOption['id'];
  name: string;
  description: string;
}[] = [
  {
    mode: 'shortest',
    id: 'A',
    name: 'Shortest route',
    description:
      'May include stairs and pass community-reported issues.',
  },
  {
    mode: 'avoid_damage',
    id: 'B',
    name: 'Avoid damaged facilities',
    description:
      'Avoids qualifying open community issues affecting routes.',
  },
  {
    mode: 'accessible',
    id: 'C',
    name: 'Verified step-free route',
    description:
      'Uses verified step-free paths and avoids qualifying issues.',
  },
];

const MAP_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

const PILOT_CENTER: [number, number] = [
  101.731,
  3.226,
];

function insidePilot(point: NavigationPoint, area?: NavigationArea): boolean {
  const [west, south, east, north] = area?.bbox ?? [101.7211, 3.2171, 101.7409, 3.2349];
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= south &&
    point.latitude <= north &&
    point.longitude >= west &&
    point.longitude <= east
  );
}

function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(2)} km`;
}

export default function RouteOptionsScreen({
  navigationArea,
  start,
  destination,
  initialOrigin,
  initialDestination,
  onBack,
  onStartJourney,
  onMapTouchChange,
}: Props) {
  const [origin, setOrigin] =
    useState<NavigationPoint | null>(() => initialOrigin && insidePilot(initialOrigin, navigationArea) ? initialOrigin : null);

  const [target, setTarget] =
    useState<NavigationPoint | null>(() => initialDestination && insidePilot(initialDestination, navigationArea) ? initialDestination : null);
  const [originName, setOriginName] = useState(start);
  const [targetName, setTargetName] = useState(destination);

  const [selecting, setSelecting] =
    useState<'origin' | 'destination'>('origin');

  const [results, setResults] = useState<ModeResult[]>([]);
  const [selectedMode, setSelectedMode] =
    useState<RouteMode | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  const requestLock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => () => onMapTouchChange?.(false), [onMapTouchChange]);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const selectedRoute = results.find(
    (item) => item.mode === selectedMode,
  )?.route;

  function choosePoint(longitude: number, latitude: number, which = selecting, label = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`) {
    if (requestLock.current) return;

    const point = { latitude, longitude };

    if (!insidePilot(point, navigationArea)) {
      setError(
        'Select a point inside the selected live service area.',
      );
      return;
    }

    setError('');
    setResults([]);
    setSelectedMode(null);

    if (which === 'origin') {
      setOrigin(point); setOriginName(label);
      setSelecting('destination');
    } else {
      setTarget(point); setTargetName(label);
    }
  }

  async function loadRoutes() {
    if (requestLock.current) return;

    if (!origin || !target) {
      setError(
        'Select both the starting point and destination on the map.',
      );
      return;
    }

    if (
      origin.latitude === target.latitude &&
      origin.longitude === target.longitude
    ) {
      setError(
        'The starting point and destination must be different.',
      );
      return;
    }

    requestLock.current = true;
    setLoading(true);
    setError('');
    setResults([]);
    setSelectedMode(null);

    try {
      const { data, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const token = data.session?.access_token;

      if (!token) {
        throw new Error(
          'Your session has expired. Please sign in again.',
        );
      }

      const nextResults = await Promise.all(
        MODES.map(async (config): Promise<ModeResult> => {
          if (navigationArea && !navigationArea.supported_route_modes.includes(config.mode)) {
            return { mode: config.mode, error: 'This route mode is not enabled in the selected live service area.' };
          }
          try {
            const response = await navigationApi.getRoute(
              token,
              {
                origin,
                destination: target,
                profile: 'walking',
                language: 'en',
                route_mode: config.mode,
              },
            );

            const validGeometry =
              response.geometry?.type === 'LineString' &&
              Array.isArray(response.geometry.coordinates) &&
              response.geometry.coordinates.length >= 2 &&
              response.geometry.coordinates.every(
                (point) =>
                  Array.isArray(point) &&
                  Number.isFinite(point[0]) &&
                  Number.isFinite(point[1]),
              );

            if (
              !validGeometry ||
              !Number.isFinite(response.distance_meters) ||
              response.distance_meters < 0 ||
              !Number.isFinite(response.duration_seconds) ||
              response.duration_seconds < 0
            ) {
              throw new Error(
                'The backend returned invalid route data.',
              );
            }

            return {
              mode: config.mode,
              route: {
                id: config.id,
                name: config.name,
                distance: formatDistance(
                  response.distance_meters,
                ),
                minutes: Math.max(
                  1,
                  Math.ceil(response.duration_seconds / 60),
                ),
                description: config.description,
                navigation: response,
              },
            };
          } catch (routeError) {
            const message =
              routeError instanceof Error
                ? routeError.message
                : 'Unable to load this route.';

            return {
              mode: config.mode,
              error:
                config.mode === 'accessible' &&
                routeError instanceof ApiError &&
                routeError.status === 422
                  ? `No verified step-free route available. ${message}`
                  : message,
            };
          }
        }),
      );

      if (!mounted.current) return;

      setResults(nextResults);

      const firstAvailable = nextResults.find(
        (item) => item.route,
      );

      setSelectedMode(firstAvailable?.mode ?? null);
    } catch (loadError) {
      if (mounted.current) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load routes.',
        );
      }
    } finally {
      requestLock.current = false;

      if (mounted.current) {
        setLoading(false);
      }
    }
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        disabled={loading}
        style={styles.textButton}
      >
        <Text style={styles.link}>‹ Map</Text>
      </Pressable>

      <Text style={styles.title}>
        Choose your route.
      </Text>

      <Text style={styles.body}>
        {originName} → {targetName}
      </Text>

      <Text style={styles.body}>
        Select points on the map or choose your saved places.
        Route calculations use the selected coordinates.
      </Text>

      <View style={styles.pointButtons}>
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => setSelecting('origin')}
          style={[
            styles.pointButton,
            selecting === 'origin' && styles.selectedCard,
          ]}
        >
          <Text style={styles.cardTitle}>
            1. Starting point
          </Text>
          <Text style={styles.body}>
            {origin ? 'Pin selected ✓' : 'Tap map to select'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => setSelecting('destination')}
          style={[
            styles.pointButton,
            selecting === 'destination' &&
              styles.selectedCard,
          ]}
        >
          <Text style={styles.cardTitle}>
            2. Destination
          </Text>
          <Text style={styles.body}>
            {target ? 'Pin selected ✓' : 'Tap map to select'}
          </Text>
        </Pressable>
      </View>

      <SavedPlacesControl field="starting point" disabled={loading}
        current={origin ? { label: originName, coordinate: [origin.longitude, origin.latitude] } : null}
        onChoose={point => choosePoint(point.coordinate[0], point.coordinate[1], 'origin', point.label)} />
      <SavedPlacesControl field="destination" disabled={loading}
        current={target ? { label: targetName, coordinate: [target.longitude, target.latitude] } : null}
        onChoose={point => choosePoint(point.coordinate[0], point.coordinate[1], 'destination', point.label)} />
      <View style={styles.mapContainer}
        onTouchStart={() => onMapTouchChange?.(true)}
        onTouchEnd={event => { if (event.nativeEvent.touches.length === 0) onMapTouchChange?.(false); }}
        onTouchCancel={() => onMapTouchChange?.(false)}>
        <Map
          key={mapKey}
          style={styles.map}
          mapStyle={MAP_STYLE}
          androidView="texture"
          attribution
          compass
          dragPan
          touchZoom
          doubleTapZoom
          onPress={(event) => {
            const [longitude, latitude] =
              event.nativeEvent.lngLat;

            choosePoint(longitude, latitude);
          }}
          onDidFinishLoadingMap={() => setMapError(false)}
          onDidFailLoadingMap={() => setMapError(true)}
        >
          <Camera
            initialViewState={{
              center: navigationArea?.center ?? PILOT_CENTER,
              zoom: 15,
            }}
          />

          {selectedRoute && (
            <GeoJSONSource
              id="selected-route-source"
              data={{
                type: 'Feature',
                properties: {},
                geometry: selectedRoute.navigation.geometry,
              }}
            >
              <Layer
                id="selected-route-line"
                type="line"
                paint={{
                  'line-color': '#247A80',
                  'line-width': 5,
                }}
                layout={{
                  'line-cap': 'round',
                  'line-join': 'round',
                }}
              />
            </GeoJSONSource>
          )}

          {origin && (
            <Marker
              id="route-origin"
              lngLat={[
                origin.longitude,
                origin.latitude,
              ]}
            >
              <View
                collapsable={false}
                style={styles.originPin}
              >
                <Text style={styles.pinText}>S</Text>
              </View>
            </Marker>
          )}

          {target && (
            <Marker
              id="route-destination"
              lngLat={[
                target.longitude,
                target.latitude,
              ]}
            >
              <View
                collapsable={false}
                style={styles.destinationPin}
              >
                <Text style={styles.pinText}>D</Text>
              </View>
            </Marker>
          )}
        </Map>

        {mapError && (
          <View style={styles.mapError}>
            <Text style={styles.error}>
              Unable to load map. Check your connection.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => {
                setMapError(false);
                setMapKey((value) => value + 1);
              }}
            >
              <Text style={styles.link}>Retry map</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Text style={styles.body}>
        {selecting === 'origin'
          ? 'Tap the map to set the starting point.'
          : 'Tap the map to set the destination.'}
      </Text>

      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={!origin || !target || loading}
        onPress={() => void loadRoutes()}
        style={[
          styles.button,
          (!origin || !target || loading) && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>
          {loading ? 'Finding routes…' : 'Find routes'}
        </Text>
      </Pressable>

      {loading && (
        <ActivityIndicator color={colors.navy} />
      )}

      {results.map((result) => {
        const config = MODES.find(
          (item) => item.mode === result.mode,
        )!;

        return (
          <Pressable
            key={result.mode}
            accessibilityRole="radio"
            accessibilityState={{
              checked: selectedMode === result.mode,
              disabled: !result.route,
            }}
            disabled={!result.route}
            onPress={() => setSelectedMode(result.mode)}
            style={[
              styles.routeCard,
              selectedMode === result.mode &&
                styles.selectedCard,
            ]}
          >
            <Text style={styles.cardTitle}>
              {config.name}
            </Text>

            {result.route ? (
              <>
                <Text style={styles.body}>
                  {result.route.distance}
                  {' · '}
                  {result.route.minutes} min
                </Text>
                <Text style={styles.body}>
                  {result.route.description}
                </Text>

                {result.route.navigation.warnings
                  ?.filter(
                    (warning): warning is string =>
                      typeof warning === 'string',
                  )
                  .map((warning, index) => (
                    <Text
                      key={`${index}-${warning}`}
                      style={styles.error}
                    >
                      {warning}
                    </Text>
                  ))}
              </>
            ) : (
              <Text style={styles.error}>
                {result.error}
              </Text>
            )}
          </Pressable>
        );
      })}

      {!!selectedRoute && (
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => { if (origin && target) onStartJourney(selectedRoute, { origin, destination: target }, { start: originName, destination: targetName }); }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            Start journey
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  title: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: '700',
    color: colors.navy,
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  textButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  link: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.navy,
  },
  pointButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  pointButton: {
    flex: 1,
    padding: 12,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  mapContainer: {
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.lavender,
  },
  map: {
    flex: 1,
  },
  mapError: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  originPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: '#247A80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  routeCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  selectedCard: {
    backgroundColor: colors.lavender,
    borderColor: colors.navy,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  button: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
  error: {
    fontSize: 12,
    lineHeight: 18,
    color: '#A63E37',
  },
  disabled: {
    opacity: 0.5,
  },
});
