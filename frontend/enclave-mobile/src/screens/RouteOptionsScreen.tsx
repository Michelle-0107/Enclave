import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme';

export type RouteOption = {
  id: 'A' | 'B';
  name: string;
  distance: string;
  minutes: number;
  description: string;
};

type Props = {
  start: string;
  destination: string;
  onBack: () => void;
  onStartJourney: (route: RouteOption) => void;
};

export default function RouteOptionsScreen({
  start,
  destination,
  onBack,
  onStartJourney,
}: Props) {
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>‹ Map</Text>
      </Pressable>

      <Text style={styles.title}>Choose your route.</Text>

      <Text style={styles.subtitle}>
        {start} → {destination}
      </Text>

      <View style={styles.map}>
        <Text style={styles.mapTitle}>Route map</Text>

        <Text style={styles.mapHint}>Route data is not available.</Text>
      </View>

      <Text style={styles.subtitle}>
        Route planning will be available when its backend endpoint is added.
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
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  map: {
    height: 180,
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
    color: colors.muted,
  },
  options: {
    gap: 10,
  },
  routeCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  selectedCard: {
    backgroundColor: colors.lavender,
    borderColor: colors.navy,
  },
  routeTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  routeDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  button: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  buttonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.white,
  },
  pressed: {
    opacity: 0.8,
  },
});
