import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

export default function ActiveJourneyScreen({
  route,
  destination,
  startedAt,
  onBack,
  onArrived,
  onEndJourney,
}: Props) {
  const estimatedArrival = new Date(
    startedAt + route.minutes * 60 * 1000
  ).toLocaleTimeString('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

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

      <View style={styles.map}>
        <Text style={styles.mapTitle}>Journey map</Text>
        <Text style={styles.description}>
          {route.name} · Map integration comes next.
        </Text>
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
        Illustrative route · No location sharing
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
  map: {
    height: 160,
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