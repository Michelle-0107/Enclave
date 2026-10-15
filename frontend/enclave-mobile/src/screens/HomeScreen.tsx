import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type Props = {
  onReportPress: () => void;
  onNotificationsPress: () => void;
};

export default function HomeScreen({
  onReportPress,
  onNotificationsPress,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.introduction}>
        <Text style={styles.title}>Hi, Florence.</Text>
        <Text style={styles.subtitle}>Your community.</Text>
      </View>

      <View style={styles.reportCard}>
        <Text style={styles.cardTitle}>
          How’s your{'\n'}neighbourhood today?
        </Text>

        <Text style={styles.description}>
          Spot an issue? Help your community take care of it.
        </Text>

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

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Latest update</Text>

        <Pressable
          accessibilityRole="button"
          onPress={onNotificationsPress}
          hitSlop={12}
        >
          <Text style={styles.link}>View all</Text>
        </Pressable>
      </View>

      <View style={styles.updateCard}>
        <Text style={styles.eyebrow}>SAMPLE UPDATE</Text>

        <Text style={styles.updateTitle}>
          Park entrance repairs completed
        </Text>

        <Text style={styles.description}>
          The reported pathway issue has been resolved.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
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
    color: colors.muted,
  },
  reportCard: {
    backgroundColor: '#F1D9CE',
    borderRadius: 24,
    padding: 24,
    gap: 16,
  },
  cardTitle: {
    fontSize: 23,
    lineHeight: 31,
    fontWeight: '700',
    color: colors.navy,
  },
  description: {
    fontSize: 13,
    lineHeight: 21,
    color: colors.muted,
  },
  button: {
    backgroundColor: colors.navy,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  pressed: {
    opacity: 0.8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.navy,
  },
  link: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.navy,
  },
  updateCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.muted,
  },
  updateTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.navy,
  },
});