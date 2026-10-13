import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export default function ReportScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>MAKE A DIFFERENCE</Text>

      <Text style={styles.title}>Report an issue.</Text>

      <Text style={styles.subtitle}>
        Help keep your neighbourhood comfortable and safe.
      </Text>

      <View style={[styles.card, styles.photoCard]}>
        <Text style={styles.step}>STEP 01</Text>
        <Text style={styles.cardTitle}>Add a photo</Text>
        <Text style={styles.subtitle}>
          Take a photo or choose one from your gallery.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.step}>STEP 02</Text>
        <Text style={styles.cardTitle}>Location & description</Text>
        <Text style={styles.subtitle}>
          Tell us where the issue is and what happened.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.step}>STEP 03</Text>
        <Text style={styles.cardTitle}>Review & submit</Text>
        <Text style={styles.subtitle}>
          Review and edit AI suggestions before submitting
          your report to management.
        </Text>
      </View>

      <Text style={styles.helper}>
        Photo selection and report submission will be connected
        in the next stage.
      </Text>
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
    lineHeight: 42,
    color: colors.navy,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 22,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoCard: {
    backgroundColor: colors.peach,
  },
  step: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.muted,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: colors.navy,
  },
  helper: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
});