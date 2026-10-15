import { useState } from 'react';
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

// Demo data. Replace with routes returned by the backend.
const routes: RouteOption[] = [
  {
    id: 'A',
    name: 'Route A',
    distance: '850 m',
    minutes: 12,
    description: 'Avoids the reviewed walkway closure.',
  },
  {
    id: 'B',
    name: 'Route B',
    distance: '1.05 km',
    minutes: 15,
    description: 'Alternative via the main entrance.',
  },
];

export default function RouteOptionsScreen({
  start,
  destination,
  onBack,
  onStartJourney,
}: Props) {
  const [selectedId, setSelectedId] =
    useState<RouteOption['id']>('A');

  const selectedRoute =
    routes.find((route) => route.id === selectedId) ?? routes[0];

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

        <Text style={styles.mapHint}>
          {selectedRoute.name} selected
        </Text>
      </View>

      <View accessibilityRole="radiogroup" style={styles.options}>
        {routes.map((route) => {
          const selected = route.id === selectedId;

          return (
            <Pressable
              key={route.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${route.name}, ${route.distance}, ${route.minutes} minutes`}
              onPress={() => setSelectedId(route.id)}
              style={({ pressed }) => [
                styles.routeCard,
                selected && styles.selectedCard,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.routeTitle}>
                {route.name} · {route.distance} · {route.minutes} min
              </Text>

              <Text style={styles.routeDescription}>
                {route.description}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => onStartJourney(selectedRoute)}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.buttonText}>Start journey</Text>
      </Pressable>
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