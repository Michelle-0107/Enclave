import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme';

type Props = {
  ticketId: string;
  onViewReports: () => void;
  onGoHome: () => void;
  communityVisible: boolean | null;
  reporterCount: number | null;
  deduplicated: boolean;
};

export default function ReportSuccessScreen({
  ticketId,
  onViewReports,
  onGoHome,
  communityVisible,
  reporterCount,
  deduplicated,
}: Props) {
  const displayTicketId = ticketId.startsWith('#')
    ? ticketId
    : `#${ticketId}`;

  return (
    <View style={styles.container}>
      <View style={styles.confirmation}>
        <View style={styles.successIcon}>
          <Ionicons
            name="checkmark"
            size={38}
            color={colors.navy}
          />
        </View>

        <Text style={styles.title}>
          Report submitted{'\n'}successfully.
        </Text>

        <Text style={styles.subtitle}>
          Thank you for helping care for your neighbourhood.
        </Text>
      </View>

      <View style={styles.ticketCard}>
        <Text style={styles.eyebrow}>TICKET ID</Text>

        <Text style={styles.ticketId}>
          {displayTicketId}
        </Text>

        <Text style={styles.status}>
          Pending management review
        </Text>

        <Text style={styles.description}>
          Your private ticket is saved. Community visibility
          depends on reports from distinct verified residents,
          not management approval.
        </Text>

        {deduplicated ? (
          <Text style={styles.communityResult}>
            You have already contributed to this community issue.
          </Text>
        ) : communityVisible ? (
          <Text style={styles.communityResult}>
            This issue is now visible on the community map.
          </Text>
        ) : reporterCount !== null ? (
          <Text style={styles.communityResult}>
            {reporterCount} resident report{reporterCount === 1 ? '' : 's'} recorded. Waiting for another resident.
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onViewReports}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            View my reports
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onGoHome}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>
            Back to home
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 32,
    paddingTop: 24,
    paddingBottom: 4,
  },

  confirmation: {
    gap: 20,
  },

  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 38,
    color: colors.navy,
  },

  subtitle: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.muted,
  },

  ticketCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },

  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    color: colors.muted,
  },

  ticketId: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28,
    color: colors.navy,
  },

  status: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 21,
    color: '#966114',
  },

  description: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },

  communityResult: {
    fontSize: 11,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 4,
  },

  actions: {
    gap: 12,
    marginTop: 32,
  },

  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.white,
    textAlign: 'center',
  },

  secondaryButton: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
    textAlign: 'center',
  },

  pressed: {
    opacity: 0.8,
  },
});
