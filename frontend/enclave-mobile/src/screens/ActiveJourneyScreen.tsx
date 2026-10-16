import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import {
  Camera,
  Map,
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

type LocationStatus =
  | 'checking'
  | 'ready'
  | 'denied'
  | 'disabled'
  | 'error';

type TrackingMode = 'default' | 'heading' | 'course';

// Initial overview only; GPS tracking centres on your real location.
const INITIAL_CENTER: [number, number] = [101.69, 3.14];

const MAP_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

export default function ActiveJourneyScreen({
  route,
  destination,
  startedAt,
  onBack,
  onArrived,
  onEndJourney,
}: Props) {
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>('checking');

  const [tracking, setTracking] =
    useState<TrackingMode | undefined>('heading');

  const [mapError, setMapError] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [permissionAttempt, setPermissionAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function prepareLocation() {
      setLocationStatus('checking');

      try {
        const permission =
          await Location.requestForegroundPermissionsAsync();

        if (cancelled) return;

        if (permission.status !== 'granted') {
          setLocationStatus('denied');
          return;
        }

        const enabled =
          await Location.hasServicesEnabledAsync();

        if (cancelled) return;

        setLocationStatus(enabled ? 'ready' : 'disabled');

        if (enabled) {
          setTracking('heading');
        }
      } catch {
        if (!cancelled) {
          setLocationStatus('error');
        }
      }
    }

    void prepareLocation();

    return () => {
      cancelled = true;
    };
  }, [permissionAttempt]);

  const estimatedArrival = new Date(
    startedAt + route.minutes * 60 * 1000
  ).toLocaleTimeString('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const locationMessage = {
    checking: 'Requesting location access…',
    ready: 'Location enabled · Waiting for or tracking GPS',
    denied: 'Location permission denied. Enable it in app settings.',
    disabled: 'Turn on your phone’s Location / GPS, then tap Retry.',
    error: 'Unable to enable location. Please try again.',
  }[locationStatus];

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
        <Text style={styles.cardTitle}>Journey in progress</Text>
        <Text style={styles.description}>
          {route.name} · {route.distance} · {route.minutes} min
        </Text>
      </View>

      <View style={styles.mapContainer}>
        <Map
          key={mapKey}
          style={styles.map}
          mapStyle={MAP_STYLE}
          androidView="texture"
          compass
          attribution
          onDidFinishLoadingMap={() => setMapError(false)}
          onDidFailLoadingMap={() => setMapError(true)}
        >
          <Camera
            initialViewState={{
              center: INITIAL_CENTER,
              zoom: 11,
            }}
            zoom={16}
            pitch={40}
            trackUserLocation={
              locationStatus === 'ready' ? tracking : undefined
            }
            onTrackUserLocationChange={(event) => {
              setTracking(
                event.nativeEvent.trackUserLocation ?? undefined
              );
            }}
          />

          {locationStatus === 'ready' && (
            <UserLocation
              animated
              accuracy
              heading
              minDisplacement={1}
            />
          )}
        </Map>

        {locationStatus === 'ready' && !mapError && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Re-centre map on my location"
            onPress={() => setTracking('heading')}
            style={styles.recentreButton}
          >
            <Text style={styles.recentreText}>◎ Re-centre</Text>
          </Pressable>
        )}

        {mapError && (
          <View style={styles.mapErrorCard}>
            <Text style={styles.cardTitle}>
              Could not load map
            </Text>
            <Text style={styles.description}>
              Check your internet connection.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.retryButton}
              onPress={() => {
                setMapError(false);
                setMapKey((value) => value + 1);
              }}
            >
              <Text style={styles.backText}>Retry map</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.locationCard}>
        {locationStatus === 'checking' && (
          <ActivityIndicator color={colors.navy} size="small" />
        )}

        <Text style={styles.locationText}>
          {locationMessage}
        </Text>

        {locationStatus === 'denied' && (
          <Pressable
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={() => {
              void Linking.openSettings();
            }}
          >
            <Text style={styles.backText}>Open settings</Text>
          </Pressable>
        )}

        {locationStatus !== 'ready' &&
          locationStatus !== 'checking' && (
            <Pressable
              accessibilityRole="button"
              style={styles.retryButton}
              onPress={() =>
                setPermissionAttempt((value) => value + 1)
              }
            >
              <Text style={styles.backText}>Retry location</Text>
            </Pressable>
          )}
      </View>

      <View style={styles.destinationCard}>
        <Text style={styles.cardTitle}>
          Destination: {destination}
        </Text>
        <Text style={styles.description}>
          Estimated arrival: {estimatedArrival}
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
        Route guidance not connected yet · Arrival estimate
        uses the selected route’s original duration
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
    lineHeight: 17,
    color: colors.muted,
  },
  mapContainer: {
    height: 300,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.lavender,
  },
  map: {
    flex: 1,
  },
  recentreButton: {
    position: 'absolute',
    right: 12,
    bottom: 40,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  recentreText: {
    color: colors.navy,
    fontSize: 13,
    fontWeight: '600',
  },
  mapErrorCard: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.white,
    gap: 6,
  },
  locationCard: {
    gap: 4,
    paddingHorizontal: 4,
  },
  locationText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  retryButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  destinationCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
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
    lineHeight: 16,
    color: colors.muted,
  },
  pressed: {
    opacity: 0.8,
  },
});