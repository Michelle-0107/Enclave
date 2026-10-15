import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme';

type Props = {
  onReportPress: () => void;
  onChooseRoute?: (start: string, destination: string) => void;
};

export default function MapScreen({
  onReportPress,
  onChooseRoute,
}: Props) {
  const [start, setStart] = useState('Community Clubhouse');
  const [destination, setDestination] = useState('Lakeside Park');

  function handleChooseRoute() {
    const startingPoint = start.trim();
    const endPoint = destination.trim();

    if (!startingPoint || !endPoint) {
      Alert.alert(
        'Choose your locations',
        'Please enter a starting point and an end point.'
      );
      return;
    }

    if (onChooseRoute) {
      onChooseRoute(startingPoint, endPoint);
      return;
    }

    Alert.alert(
      'Route options',
      'The Route options page will be connected next.'
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Around your neighbourhood.
      </Text>

      <Text style={styles.subtitle}>
        Reviewed issues, at a glance.
      </Text>

      <View style={styles.endpoints}>
        <View style={styles.endpoint}>
          <Text style={styles.fieldLabel}>Starting point</Text>

          <TextInput
            accessibilityLabel="Starting point"
            value={start}
            onChangeText={setStart}
            placeholder="Choose a starting point"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="next"
            style={styles.locationInput}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.endpoint}>
          <Text style={styles.fieldLabel}>End point</Text>

          <TextInput
            accessibilityLabel="End point"
            value={destination}
            onChangeText={setDestination}
            placeholder="Choose an end point"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="done"
            style={styles.locationInput}
          />
        </View>
      </View>

      {/* Replace this placeholder with the map component later. */}
      <View style={styles.map}>
        <Text style={styles.mapTitle}>Community map</Text>

        <Text style={styles.mapHint}>
          Map integration comes next.
        </Text>
      </View>

      {/* Demo issue; replace with reviewed issues from the API. */}
      <View style={styles.closureNotice}>
        <Text style={styles.closureTitle}>
          Walkway closure · Park Entrance
        </Text>

        <Text style={styles.closureDescription}>
          Reviewed by management · Avoid this section.
        </Text>
      </View>

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
  map: {
    width: '100%',
    height: 200,
    borderRadius: 18,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 8,
  },
  mapTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.navy,
  },
  mapHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
  closureNotice: {
    backgroundColor: '#FDE8E7',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
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