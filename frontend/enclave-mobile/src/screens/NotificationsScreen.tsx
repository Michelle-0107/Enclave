import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export default function NotificationsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>STAY INFORMED</Text>

      <Text style={styles.title}>Your updates.</Text>

      <Text style={styles.subtitle}>
        Community alerts and report progress, all in one place.
      </Text>

      <View style={styles.emptyCard}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>✉</Text>
        </View>

        <Text style={styles.cardTitle}>You're all caught up</Text>

        <Text style={styles.emptyText}>
          Updates about your reports and followed areas
          will appear here.
        </Text>
      </View>
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
  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: 24,
    paddingVertical: 44,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 28,
    color: colors.navy,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: colors.navy,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
  },
});