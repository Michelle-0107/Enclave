import { NativeMap as Map } from '../navigation/NativeMap';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  UserLocation,
} from '@maplibre/maplibre-react-native';

import type { RouteOption } from './RouteOptionsScreen';
import { colors } from '../theme';

type Props = {
  route: RouteOption;
  destination: string;
  startedAt: number;
  onBack: () => void;
  onArrived: () => void;
  onEndJourney: () => void;
};

type Coordinate = [number, number];

type RouteMatch = {
  distanceAway: number;
  progress: number;
};

const MAP_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

const MAX_ACCURACY_METERS = 35;
const OFF_ROUTE_METERS = 40;
const STALE_LOCATION_MS = 20000;

function distanceBetween(
  first: Coordinate,
  second: Coordinate,
): number {
  const radians = Math.PI / 180;
  const latitudeDifference =
    (second[1] - first[1]) * radians;
  const longitudeDifference =
    (second[0] - first[0]) * radians;

  const value =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(first[1] * radians) *
      Math.cos(second[1] * radians) *
      Math.sin(longitudeDifference / 2) ** 2;

  return (
    6371000 *
    2 *
    Math.atan2(
      Math.sqrt(value),
      Math.sqrt(Math.max(0, 1 - value)),
    )
  );
}

/**
 * Approximate the position along the route by finding
 * the nearest point on its line segments.
 *
 * This is a basic geometric estimate, not a full
 * navigation map-matching engine.
 */
function matchToRoute(
  point: Coordinate,
  coordinates: Coordinate[],
  routeDistance: number,
): RouteMatch | null {
  if (coordinates.length < 2) return null;

  const radians = Math.PI / 180;
  const metersPerDegree = 6371000 * radians;
  const longitudeScale =
    metersPerDegree * Math.cos(point[1] * radians);

  let totalLength = 0;
  let bestDistance = Infinity;
  let bestProgress = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];

    const startX =
      (start[0] - point[0]) * longitudeScale;
    const startY =
      (start[1] - point[1]) * metersPerDegree;

    const endX =
      (end[0] - point[0]) * longitudeScale;
    const endY =
      (end[1] - point[1]) * metersPerDegree;

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared =
      deltaX * deltaX + deltaY * deltaY;

    const fraction =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              -(startX * deltaX + startY * deltaY) /
                lengthSquared,
            ),
          );

    const nearestX = startX + fraction * deltaX;
    const nearestY = startY + fraction * deltaY;
    const distance = Math.hypot(nearestX, nearestY);
    const segmentLength = distanceBetween(start, end);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgress =
        totalLength + fraction * segmentLength;
    }

    totalLength += segmentLength;
  }

  if (totalLength <= 0) return null;

  return {
    distanceAway: bestDistance,
    progress: Math.min(
      routeDistance,
      (bestProgress / totalLength) * routeDistance,
    ),
  };
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.max(0, Math.round(meters))} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

function instructionArrow(instruction: string): string {
  const text = instruction.toLowerCase();

  if (/u[- ]?turn/.test(text)) return '↶';
  if (text.includes('left')) return '↰';
  if (text.includes('right')) return '↱';
  if (
    text.includes('arrive') ||
    text.includes('destination')
  ) {
    return '●';
  }

  return '↑';
}

export default function ActiveJourneyScreen({
  route,
  destination,
  startedAt,
  onBack,
  onArrived,
  onEndJourney,
}: Props) {
  const navigation = route.navigation;

  const cameraRef =
    useRef<React.ComponentRef<typeof Camera>>(null);

  const [position, setPosition] =
    useState<Location.LocationObject | null>(null);

  const [locationEnabled, setLocationEnabled] =
    useState(false);

  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationAttempt, setLocationAttempt] = useState(0);

  const [tracking, setTracking] =
    useState<'course' | undefined>(undefined);

  const [mapError, setMapError] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [now, setNow] = useState(Date.now());

  const coordinates = useMemo(
    () => navigation.geometry.coordinates,
    [navigation.geometry.coordinates],
  );

  const origin = coordinates[0];
  const endpoint = coordinates[coordinates.length - 1];

  const bounds = useMemo<
    [number, number, number, number]
  >(() => {
    const longitudes = coordinates.map((point) => point[0]);
    const latitudes = coordinates.map((point) => point[1]);

    return [
      Math.min(...longitudes),
      Math.min(...latitudes),
      Math.max(...longitudes),
      Math.max(...latitudes),
    ];
  }, [coordinates]);

  const maneuvers = useMemo(
    () =>
      [...navigation.maneuvers]
        .filter(
          (item) =>
            Number.isFinite(item.distance_from_start_meters) &&
            typeof item.instruction === 'string',
        )
        .sort(
          (first, second) =>
            first.distance_from_start_meters -
            second.distance_from_start_meters,
        ),
    [navigation.maneuvers],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | undefined;

    async function startLocation() {
      setLocating(true);
      setLocationEnabled(false);
      setLocationError('');
      setPosition(null);
      setTracking(undefined);

      try {
        const permission =
          await Location.requestForegroundPermissionsAsync();

        if (cancelled) return;

        if (!permission.granted) {
          setLocationError(
            'Location permission is needed for live guidance.',
          );
          return;
        }

        const servicesEnabled =
          await Location.hasServicesEnabledAsync();

        if (cancelled) return;

        if (!servicesEnabled) {
          setLocationError(
            'Turn on your phone’s location services.',
          );
          return;
        }

        setLocationEnabled(true);

        const watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 2,
            timeInterval: 1500,
          },
          (result) => {
            if (cancelled) return;

            setPosition(result);
            setLocationError('');
            setNow(Date.now());
            setLocating(false);
          },
          (message) => {
            if (cancelled) return;

            setLocating(false);
            setLocationError(
              message || 'Unable to update your location.',
            );
          },
        );

        if (cancelled) {
          watcher.remove();
        } else {
          subscription = watcher;
        }
      } catch {
        if (!cancelled) {
          setLocationError(
            'Unable to start live location. Please try again.',
          );
        }
      } finally {
        if (!cancelled) setLocating(false);
      }
    }

    void startLocation();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [locationAttempt]);

  const accuracy = position?.coords.accuracy;

  const locationFresh =
    position !== null &&
    now - position.timestamp <= STALE_LOCATION_MS;

  const locationAccurate =
    typeof accuracy === 'number' &&
    accuracy >= 0 &&
    accuracy <= MAX_ACCURACY_METERS;

  const canGuide =
    locationFresh &&
    locationAccurate &&
    !locationError;

  const routeMatch = useMemo(() => {
    if (!position) return null;

    return matchToRoute(
      [
        position.coords.longitude,
        position.coords.latitude,
      ],
      coordinates,
      navigation.distance_meters,
    );
  }, [
    position,
    coordinates,
    navigation.distance_meters,
  ]);

  const onRoute =
    canGuide &&
    routeMatch !== null &&
    routeMatch.distanceAway <= OFF_ROUTE_METERS;

  const progress =
    onRoute && routeMatch ? routeMatch.progress : null;

  const nextManeuver =
    progress === null
      ? undefined
      : maneuvers.find(
          (item) =>
            item.distance_from_start_meters > progress + 8,
        );

  const distanceToTurn =
    nextManeuver && progress !== null
      ? Math.max(
          0,
          nextManeuver.distance_from_start_meters - progress,
        )
      : null;

  const distanceToDestination = position
    ? distanceBetween(
        [
          position.coords.longitude,
          position.coords.latitude,
        ],
        endpoint,
      )
    : null;

  const nearDestination =
    onRoute &&
    progress !== null &&
    navigation.distance_meters - progress <= 30 &&
    distanceToDestination !== null &&
    distanceToDestination <= 25;

  const remainingDistance =
    progress === null
      ? null
      : Math.max(
          0,
          navigation.distance_meters - progress,
        );

  const estimatedArrival = new Date(
    startedAt + navigation.duration_seconds * 1000,
  ).toLocaleTimeString('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  let guidanceTitle = 'Waiting for your location';
  let guidanceDescription =
    'The selected route is shown on the map.';
  let guidanceArrow = '↑';

  if (locationError) {
    guidanceTitle = 'Live guidance unavailable';
    guidanceDescription = locationError;
  } else if (position && !locationFresh) {
    guidanceTitle = 'Waiting for a fresh GPS signal';
    guidanceDescription =
      'Navigation instructions are paused.';
  } else if (position && !locationAccurate) {
    guidanceTitle = 'GPS accuracy is low';
    guidanceDescription =
      'Move to an open area. Instructions are paused.';
  } else if (canGuide && !onRoute) {
    guidanceTitle = 'You are away from this route';
    guidanceDescription =
      'Return to the selected route or choose a new route.';
  } else if (nearDestination) {
    guidanceTitle = 'Near your destination';
    guidanceDescription =
      'Confirm the location, then tap “I’ve arrived”.';
    guidanceArrow = '●';
  } else if (onRoute && nextManeuver) {
    guidanceTitle = nextManeuver.instruction;
    guidanceDescription =
      distanceToTurn === null
        ? 'Continue along the selected route.'
        : `In approximately ${formatDistance(distanceToTurn)}`;
    guidanceArrow = instructionArrow(
      nextManeuver.instruction,
    );
  } else if (onRoute) {
    guidanceTitle = 'Continue to your destination';
    guidanceDescription =
      'Follow the highlighted route.';
  }

  function showOverview() {
    setTracking(undefined);

    cameraRef.current?.fitBounds(bounds, {
      padding: {
        top: 35,
        right: 35,
        bottom: 35,
        left: 35,
      },
      pitch: 0,
      bearing: 0,
      duration: 600,
    });
  }

  function followLocation() {
    if (!locationFresh || !position || locationError) {
      Alert.alert(
        'Location unavailable',
        'Wait for a fresh GPS signal, or tap Retry location.',
      );
      return;
    }

    setTracking('course');
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>‹ Route options</Text>
      </Pressable>

      <Text style={styles.title}>Your journey.</Text>

      <View style={styles.statusCard}>
        <Text style={styles.cardTitle}>
          Journey in progress
        </Text>

        <Text style={styles.description}>
          {route.name} · {route.distance} · {route.minutes} min
        </Text>
      </View>

      <View style={styles.guidanceCard}>
        <Text style={styles.guidanceArrow}>
          {guidanceArrow}
        </Text>

        <View style={styles.guidanceContent}>
          <Text style={styles.guidanceTitle}>
            {guidanceTitle}
          </Text>

          <Text style={styles.guidanceDescription}>
            {guidanceDescription}
          </Text>
        </View>
      </View>

      <View style={styles.mapContainer}>
        <Map
          key={mapKey}
          style={styles.map}
          mapStyle={MAP_STYLE}
          onDidFailLoadingMap={() => setMapError(true)}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              bounds,
              padding: {
                top: 35,
                right: 35,
                bottom: 35,
                left: 35,
              },
            }}
            trackUserLocation={tracking}
            onTrackUserLocationChange={(event) => {
              setTracking(
                event.nativeEvent.trackUserLocation === 'course'
                  ? 'course'
                  : undefined,
              );
            }}
          />

          <GeoJSONSource
            id="active-journey-route"
            data={{
              type: 'Feature',
              properties: {},
              geometry: navigation.geometry,
            }}
          >
            <Layer
              id="active-journey-route-outline"
              type="line"
              paint={{
                'line-color': '#FFFFFF',
                'line-width': 9,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />

            <Layer
              id="active-journey-route-line"
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

          <Marker
            id="journey-start"
            lngLat={origin}
            anchor="center"
          >
            <View style={styles.startMarker}>
              <Text style={styles.markerText}>S</Text>
            </View>
          </Marker>

          <Marker
            id="journey-destination"
            lngLat={endpoint}
            anchor="center"
          >
            <View style={styles.destinationMarker}>
              <Text style={styles.markerText}>D</Text>
            </View>
          </Marker>

          {locationEnabled ? (
            <UserLocation
              animated
              accuracy
              heading
              minDisplacement={1}
            />
          ) : null}
        </Map>
      </View>

      {mapError ? (
        <View style={styles.notice}>
          <Text style={styles.errorText}>
            The basemap could not load. Check your connection.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMapError(false);
              setMapKey((value) => value + 1);
            }}
            style={styles.smallButton}
          >
            <Text style={styles.smallButtonText}>
              Reload map
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          onPress={followLocation}
          style={styles.controlButton}
        >
          <Text style={styles.controlText}>Re-centre</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={showOverview}
          style={styles.controlButton}
        >
          <Text style={styles.controlText}>Overview</Text>
        </Pressable>
      </View>

      <Text style={styles.description}>
        {locating
          ? 'Starting location…'
          : position
            ? `GPS accuracy: ${
                typeof accuracy === 'number'
                  ? `approximately ${Math.round(accuracy)} m`
                  : 'unknown'
              }`
            : 'Waiting for GPS…'}
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={locating}
        onPress={() => {
          setLocationAttempt((value) => value + 1);
        }}
        style={styles.backButton}
      >
        <Text style={styles.backText}>
          {locating ? 'Starting GPS…' : 'Retry location'}
        </Text>
      </Pressable>

      <View style={styles.destinationCard}>
        <Text style={styles.cardTitle}>
          Destination: {destination}
        </Text>

        <Text style={styles.description}>
          {remainingDistance === null
            ? `Route distance: ${route.distance}`
            : `Approximately ${formatDistance(remainingDistance)} remaining`}
        </Text>

        <Text style={styles.description}>
          Original estimated arrival: {estimatedArrival}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onArrived}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          I’ve arrived
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onEndJourney}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.secondaryButtonText}>
          End journey
        </Text>
      </Pressable>

      <Text style={styles.footnote}>
        Keep this screen open for live guidance.
        Directions use approximate GPS matching.
        Voice guidance and automatic rerouting are not enabled.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.navy,
  },
  title: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: '700',
    color: colors.navy,
  },
  statusCard: {
    backgroundColor: '#E6F3EA',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  guidanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.navy,
    borderRadius: 16,
    padding: 16,
  },
  guidanceArrow: {
    fontSize: 38,
    color: colors.white,
    width: 44,
    textAlign: 'center',
  },
  guidanceContent: {
    flex: 1,
    gap: 6,
  },
  guidanceTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.white,
  },
  guidanceDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: '#DCE5EE',
  },
  mapContainer: {
    height: 320,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.lavender,
  },
  map: {
    flex: 1,
  },
  startMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#247A80',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.navy,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
  },
  controlButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.navy,
  },
  notice: {
    backgroundColor: '#FFF0E9',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#A63E37',
  },
  smallButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  smallButtonText: {
    color: colors.navy,
    fontSize: 13,
    fontWeight: '600',
  },
  destinationCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.white,
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
  },
  pressed: {
    opacity: 0.8,
  },
});