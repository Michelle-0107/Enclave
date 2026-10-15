import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { colors } from '../theme';

export type ReportLocationDetails = {
  location: string;
  description: string;
  coordinates: {
    latitude: number;
    longitude: number;
  } | null;
};

type Props = {
  initialDetails?: ReportLocationDetails;
  onBack: () => void;
  onContinue: (details: ReportLocationDetails) => void;
};

export default function ReportLocationScreen({
  initialDetails,
  onBack,
  onContinue,
}: Props) {
  const [location, setLocation] = useState(
    initialDetails?.location ?? ''
  );

  const [description, setDescription] = useState(
    initialDetails?.description ?? ''
  );

  const [coordinates, setCoordinates] = useState<
    ReportLocationDetails['coordinates']
  >(initialDetails?.coordinates ?? null);

  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  async function useCurrentLocation() {
    if (locating) return;

    setLocating(true);
    setError('');

    try {
      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Location access needed',
          'Allow location access in your phone settings, or enter the issue location manually.'
        );
        return;
      }

      const servicesEnabled =
        await Location.hasServicesEnabledAsync();

      if (!servicesEnabled) {
        Alert.alert(
          'Turn on location',
          'Enable your phone’s location services, or enter the location manually.'
        );
        return;
      }

      const result = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const nextCoordinates = {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
      };

      setCoordinates(nextCoordinates);

      // Coordinates remain usable even if address lookup fails.
      let label =
        `${nextCoordinates.latitude.toFixed(5)}, ` +
        `${nextCoordinates.longitude.toFixed(5)}`;

      try {
        const addresses = await Location.reverseGeocodeAsync(
          nextCoordinates
        );

        const address = addresses[0];

        if (address) {
          const parts = [
            address.name,
            address.street,
            address.district,
            address.city,
          ].filter(
            (part): part is string =>
              typeof part === 'string' && part.trim().length > 0
          );

          const addressLabel = [...new Set(parts)].join(', ');

          if (addressLabel) {
            label = addressLabel;
          }
        }
      } catch {
        // Keep the coordinate label when no address is available.
      }

      setLocation(label);
    } catch {
      Alert.alert(
        'Unable to get location',
        'Please try again or enter the issue location manually.'
      );
    } finally {
      setLocating(false);
    }
  }

  function handleContinue() {
    if (!location.trim()) {
      setError('Please enter the issue location.');
      return;
    }

    if (!description.trim()) {
      setError('Please add a short description.');
      return;
    }

    setError('');

    onContinue({
      location: location.trim(),
      description: description.trim(),
      coordinates,
    });
  }

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

        <Text style={styles.step}>STEP 02 OF 03</Text>
      </View>

      <View style={styles.introduction}>
        <Text style={styles.title}>Where is the issue?</Text>

        <Text style={styles.subtitle}>
          Add the location and a short description.
        </Text>
      </View>

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
        {locating ? (
          <ActivityIndicator color={colors.navy} />
        ) : null}

        <Text style={styles.locationButtonText}>
          {locating ? 'Finding location...' : 'Use current location'}
        </Text>
      </Pressable>

      <View style={styles.map}>
        <Text style={styles.mapTitle}>Location map</Text>

        <Text style={styles.mapHint}>
          {coordinates
            ? `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`
            : 'Map integration comes next.'}
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Location</Text>

        <TextInput
          accessibilityLabel="Issue location"
          value={location}
          onChangeText={(value) => {
            setLocation(value);

            // Manual changes need a new map/geocoding selection
            // before coordinates can be associated with this text.
            setCoordinates(null);
            setError('');
          }}
          editable={!locating}
          placeholder="e.g. Park Entrance"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />

        <Text style={styles.helper}>
          Confirm the exact spot before continuing.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>

        <TextInput
          accessibilityLabel="Issue description"
          value={description}
          onChangeText={(value) => {
            setDescription(value);
            setError('');
          }}
          placeholder="Describe what is damaged and how it affects residents."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          maxLength={500}
          style={[styles.input, styles.descriptionInput]}
        />
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={handleContinue}
        disabled={locating}
        style={({ pressed }) => [
          styles.continueButton,
          locating && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.continueText}>Continue</Text>
      </Pressable>
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
  map: {
    height: 140,
    borderRadius: 18,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  mapTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.navy,
  },
  mapHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
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
  continueButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  continueText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.white,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
});