import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

type Props = {
  onReportPress: () => void;
};

export default function MapScreen({ onReportPress }: Props) {
  const [start, setStart] = useState('Community Clubhouse');
  const [destination, setDestination] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Around your{'\n'}neighbourhood.
      </Text>

      <Text style={styles.subtitle}>
        Reviewed issues, at a glance.
      </Text>

      <View style={styles.locationCard}>
        <Text style={styles.label}>Starting point</Text>

        <TextInput
          value={start}
          onChangeText={setStart}
          placeholder="Choose your starting point"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />

        <View style={styles.divider} />

        <Text style={styles.label}>End point</Text>

        <TextInput
          value={destination}
          onChangeText={setDestination}
          placeholder="Where would you like to go?"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </View>

      <View style={styles.map}>
        <Ionicons name="map-outline" size={42} color={colors.navy} />
        <Text style={styles.mapTitle}>Community map</Text>
        <Text style={styles.subtitle}>
          Map integration comes next.
        </Text>
      </View>

      <View style={styles.notice}>
        <Ionicons
          name="alert-circle-outline"
          size={22}
          color="#966114"
        />

        <View style={styles.noticeContent}>
          <Text style={styles.noticeTitle}>
            Walkway closure · Park Entrance
          </Text>
          <Text style={styles.noticeText}>
            Sample reviewed issue. Use another walkway.
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onReportPress}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.buttonText}>Report an issue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 20 },
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
  locationCard: {
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: 20,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.navy,
  },
  input: {
    fontSize: 14,
    color: colors.navy,
    minHeight: 44,
    paddingVertical: 10,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  map: {
    minHeight: 280,
    borderRadius: 24,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  mapTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.navy,
  },
  notice: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  noticeContent: { flex: 1, gap: 6 },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
  button: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: { opacity: 0.8 },
});