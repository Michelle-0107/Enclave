import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type Props = {
  onReportPress: () => void;
};

export default function MapScreen({ onReportPress }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>YOUR COMMUNITY</Text>

      <Text style={styles.title}>
        Around your{'\n'}neighbourhood.
      </Text>

      <Text style={styles.subtitle}>
        Stay informed about reviewed issues nearby.
      </Text>

      <View style={styles.mapPlaceholder}>
        <Text style={styles.mapTitle}>Community map</Text>
        <Text style={styles.subtitle}>
          Map integration comes next.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Community conditions</Text>
        <Text style={styles.subtitle}>
          Issues reviewed by management will appear here.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onReportPress}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>Report an issue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 20,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.muted,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.navy,
    lineHeight: 42,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
  mapPlaceholder: {
    minHeight: 260,
    backgroundColor: colors.lavender,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.navy,
  },
  button: {
    backgroundColor: colors.navy,
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
});