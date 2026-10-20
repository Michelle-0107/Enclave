import { NativeMap as Map } from '../navigation/NativeMap';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  Camera,
  Marker,
  type CameraRef,
} from '@maplibre/maplibre-react-native';

import SharedLocationPicker from '../navigation/SharedLocationPicker';
import { colors } from '../theme';
import { ReportFacilityMarkers, ReportFacilityHint, useReportFacilityPoints } from '../facilities/ReportFacilityPoints';

export type ReportLocationDetails = {
  description: string;
  coordinates: {
    latitude: number;
    longitude: number;
  } | null;
};

type Props = {
  initialDetails?: ReportLocationDetails;
  children?: ReactNode;
  onDescriptionFocus?: () => void;
  onMapTouchChange?: (active: boolean) => void;
  onBack: () => void;
  onDetailsChange: (details: ReportLocationDetails) => void;
};

type Coordinates = NonNullable<
  ReportLocationDetails['coordinates']
>;

const MAP_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

// Pilot overview, not an automatically selected report location.
const PILOT_CENTER: [number, number] = [
  101.731,
  3.226,
];

function isInsidePilot(value: Coordinates): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= 3.2171 &&
    value.latitude <= 3.2349 &&
    value.longitude >= 101.7211 &&
    value.longitude <= 101.7409
  );
}

function coordinateLabel(value: Coordinates): string {
  return (
    `${value.latitude.toFixed(5)}, ` +
    `${value.longitude.toFixed(5)}`
  );
}

export default function ReportLocationScreen({
  initialDetails,
  children,
  onDescriptionFocus,
  onMapTouchChange,
  onBack,
  onDetailsChange,
}: Props) {
  const facilityPoints = useReportFacilityPoints();
  const cameraRef = useRef<CameraRef>(null);
  const locationLock = useRef(false);

  const [description, setDescription] = useState(
    initialDetails?.description ?? '',
  );

  const [coordinates, setCoordinates] =
    useState<ReportLocationDetails['coordinates']>(
      initialDetails?.coordinates ?? null,
    );

  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showFacilities, setShowFacilities] = useState(false);
  const mapViewState = useRef<{ center: [number, number]; zoom: number }>({
    center: initialDetails?.coordinates && isInsidePilot(initialDetails.coordinates)
      ? [initialDetails.coordinates.longitude, initialDetails.coordinates.latitude] : PILOT_CENTER,
    zoom: initialDetails?.coordinates ? 17 : 15,
  });
  useEffect(() => () => { onMapTouchChange?.(false); }, [onMapTouchChange]);

  function closeMap() {
    onMapTouchChange?.(false);
    setExpanded(false);
  }
  function changeZoom(amount: number) {
    const zoom = Math.max(12, Math.min(20, mapViewState.current.zoom + amount));
    mapViewState.current = { ...mapViewState.current, zoom };
    cameraRef.current?.easeTo({ center: mapViewState.current.center, zoom, duration: 200 });
  }

  function selectMapLocation(
    longitude: number,
    latitude: number,
  ) {
    if (locationLock.current) {
      return;
    }

    const next = { latitude, longitude };

    if (!isInsidePilot(next)) {
      setError(
        'Please select an issue location inside the KL East pilot area.',
      );
      return;
    }

    setCoordinates(next);
    onDetailsChange({ description: description.trim(), coordinates: next });

    setError('');
  }

  async function useCurrentLocation() {
    if (locationLock.current) {
      return;
    }

    locationLock.current = true;
    setLocating(true);
    setError('');

    try {
      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        setError(
          'Location access was not granted. You can still tap the map to select the actual issue location.',
        );
        return;
      }

      const enabled =
        await Location.hasServicesEnabledAsync();

      if (!enabled) {
        setError(
          'Turn on your phone’s Location / GPS, or select the issue location on the map.',
        );
        return;
      }

      const result =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

      const next: Coordinates = {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
      };

      if (!isInsidePilot(next)) {
        setError(
          'Your current location is outside KL East. It has not been used. Select the actual issue location on the map.',
        );
        return;
      }

      setCoordinates(next);
      onDetailsChange({ description: description.trim(), coordinates: next });

      cameraRef.current?.easeTo({
        center: [next.longitude, next.latitude],
        zoom: 17,
        duration: 700,
      });

      if (
        result.coords.accuracy !== null &&
        result.coords.accuracy > 50
      ) {
        setError(
          'GPS accuracy is low. Check the pin and tap the map to correct the issue location.',
        );
      }
    } catch {
      setError(
        'Unable to get your location. Try again or tap the actual issue location on the map.',
      );
    } finally {
      locationLock.current = false;
      setLocating(false);
    }
  }

  const mapView = (
      <View style={[styles.mapContainer, expanded && styles.expandedMap]}
        onTouchStart={() => { Keyboard.dismiss(); onMapTouchChange?.(true); }}
        onTouchEnd={event => { if (event.nativeEvent.touches.length === 0) onMapTouchChange?.(false); }}
        onTouchCancel={() => onMapTouchChange?.(false)}>
        <Map
          key={mapKey}
          style={styles.map}
          mapStyle={MAP_STYLE}
          androidView="texture"
          compass
          attribution
          dragPan
          touchZoom
          doubleTapZoom
          onRegionDidChange={event => { mapViewState.current = { center: event.nativeEvent.center, zoom: event.nativeEvent.zoom }; }}
          onPress={(event) => {
            const [longitude, latitude] =
              event.nativeEvent.lngLat;

            Keyboard.dismiss();
            selectMapLocation(longitude, latitude);
          }}
          onDidFinishLoadingMap={() => setMapError(false)}
          onDidFailLoadingMap={() => setMapError(true)}
        >
          <Camera
            ref={cameraRef}
            initialViewState={mapViewState.current}
          />

          {showFacilities && <ReportFacilityMarkers facilities={facilityPoints.facilities} onSelect={facility => {
            if (locationLock.current) return;
            selectMapLocation(facility.longitude, facility.latitude);
          }} />}

          {coordinates && isInsidePilot(coordinates) && (
            <Marker
              id="report-location"
              lngLat={[
                coordinates.longitude,
                coordinates.latitude,
              ]}
            >
              <View
                collapsable={false}
                style={styles.pin}
                accessible
                accessibilityLabel="Selected issue location"
              >
                <Text style={styles.pinText}>!</Text>
              </View>
            </Marker>
          )}
        </Map>

        <View style={styles.zoomControls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom in report map" onPress={() => changeZoom(1)} style={styles.zoomButton}><Text style={styles.zoomText}>+</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom out report map" onPress={() => changeZoom(-1)} style={styles.zoomButton}><Text style={styles.zoomText}>−</Text></Pressable>
        </View>
        {mapError && (
          <View style={styles.mapErrorCard}>
            <Text style={styles.label}>
              Unable to load map
            </Text>

            <Text style={styles.helper}>
              Check your internet connection.
            </Text>

            <Pressable
              accessibilityRole="button"
              style={styles.backButton}
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
  );

  return (
    <View style={styles.container}>
      <View style={styles.navigation}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          disabled={locating}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.step}>STEP 02 OF 02</Text>
      </View>

      <View style={styles.introduction}>
        <Text style={styles.title}>
          Where is the issue?
        </Text>

        <Text style={styles.subtitle}>
          Tap the actual issue location, add a description, then choose a nearby facility below.
        </Text>
      </View>

      <SharedLocationPicker point={coordinates} onChoose={place => {
        selectMapLocation(place.longitude, place.latitude);
        cameraRef.current?.easeTo({ center: [place.longitude, place.latitude], zoom: 17, duration: 400 });
      }} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: locating,
          busy: locating,
        }}
        onPress={useCurrentLocation}
        disabled={locating}
        style={({ pressed }) => [
          styles.locationButton,
          locating && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {locating && (
          <ActivityIndicator color={colors.navy} />
        )}

        <Text style={styles.locationButtonText}>
          {locating
            ? 'Finding location…'
            : 'Use current location'}
        </Text>
      </Pressable>

      <View style={styles.mapToolbar}>
        <Pressable accessibilityRole="switch" accessibilityLabel="Show report facility markers" accessibilityState={{ checked: showFacilities }}
          onPress={() => setShowFacilities(value => !value)} style={styles.backButton}><Text style={styles.backText}>{showFacilities ? 'Hide facility markers' : 'Show facility markers'}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Expand report map" onPress={() => { Keyboard.dismiss(); onMapTouchChange?.(false); setExpanded(true); }} style={styles.backButton}><Text style={styles.backText}>Expand map ↗</Text></Pressable>
      </View>
      {expanded ? <Modal visible presentationStyle="fullScreen" animationType="slide" hardwareAccelerated onRequestClose={closeMap}>
        <SafeAreaView style={styles.fullScreen} edges={['top', 'bottom']}>
          <View style={styles.mapToolbar}><Text style={styles.label}>Choose issue location</Text>
            <Pressable accessibilityRole="button" onPress={closeMap} style={styles.backButton}><Text style={styles.backText}>Done</Text></Pressable></View>
          <Text style={styles.helper}>Drag to move. Pinch or use + / − to zoom. Tap to place the issue pin.</Text>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {mapView}
          <Pressable accessibilityRole="button" disabled={locating} onPress={useCurrentLocation} style={styles.locationButton}><Text style={styles.locationButtonText}>{locating ? 'Finding location…' : 'Use current location'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={!coordinates || locating} accessibilityState={{ disabled: !coordinates || locating }} onPress={closeMap} style={[styles.locationButton, (!coordinates || locating) && styles.disabled]}><Text style={styles.locationButtonText}>Use this location</Text></Pressable>
        </SafeAreaView>
      </Modal> : mapView}

      <ReportFacilityHint loading={facilityPoints.loading} error={facilityPoints.error}
        count={facilityPoints.facilities.length} onRetry={facilityPoints.reload} markersVisible={showFacilities} />

      <Text style={styles.helper}>
        {coordinates && isInsidePilot(coordinates)
          ? `Selected pin: ${coordinateLabel(coordinates)}`
          : 'No issue location selected yet.'}
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>

        <TextInput
          accessibilityLabel="Issue description"
          onFocus={onDescriptionFocus}
          value={description}
          onChangeText={(value) => {
            setDescription(value);
            onDetailsChange({ description: value.trim(), coordinates });
          }}
          editable={!locating}
          placeholder="Describe the damage or obstruction and how it affects residents."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          maxLength={500}
          style={[
            styles.input,
            styles.descriptionInput,
          ]}
        />
      </View>

      {!!error && (
        <Text
          accessibilityRole="alert"
          style={styles.error}
        >
          {error}
        </Text>
      )}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 20,
  },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  step: {
    fontSize: 10,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.muted,
  },
  introduction: {
    gap: 8,
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    color: colors.navy,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
  locationButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationButtonText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.navy,
  },
  mapContainer: {
    height: 360,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.lavender,
  },
  map: {
    flex: 1,
  },
  mapToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  fullScreen: { flex: 1, backgroundColor: colors.white, paddingHorizontal: 16, gap: 12 },
  expandedMap: { flex: 1, height: undefined, borderRadius: 16 },
  zoomControls: { position: 'absolute', right: 12, top: 52, gap: 4 },
  zoomButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: colors.navy, fontSize: 24, fontWeight: '600' },
  pin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.navy,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: {
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
    borderRadius: 14,
    padding: 14,
    backgroundColor: colors.white,
    gap: 6,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.navy,
  },
  input: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    lineHeight: 22,
    color: colors.navy,
  },
  descriptionInput: {
    minHeight: 130,
  },
  helper: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
  error: {
    fontSize: 12,
    lineHeight: 19,
    color: '#A63E37',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
});
