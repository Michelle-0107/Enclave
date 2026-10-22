import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { reportsApi, residencyApi, type ApiError, type ReportRecord } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors, reportStatusTone } from '../theme';
import { SkeletonCard } from '../components/DataSkeleton';

type Props = {
  onReportPress: () => void;
  onMapPress: () => void;
  onMyReportsPress: () => void;
};

export default function HomeScreen({
  onReportPress,
  onMapPress,
  onMyReportsPress,
}: Props) {
  const [name, setName] = useState('Resident');
  const [latestReport, setLatestReport] = useState<ReportRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadHomeData() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error('Your session has expired. Please sign in again.');

        const [residency, reports] = await Promise.all([
          residencyApi.getMyResidency(accessToken),
          reportsApi.getMyReports(accessToken, 1),
        ]);

        if (!mounted) return;
        setName(residency.full_name?.trim() || 'Resident');
        setLatestReport(reports.items[0] ?? null);
      } catch (loadError) {
        if (!mounted) return;
        const apiError = loadError as ApiError;
        setError(apiError.message || 'Unable to load your community data.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadHomeData();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.introduction}>
        <Text style={styles.title}>Hi, {name}.</Text>
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

      <View style={styles.quickSection}>
        <Text style={styles.sectionTitle}>Quick access</Text>
        <View style={styles.quickRow}>
          <Pressable accessibilityRole="button" onPress={onMapPress} style={({ pressed }) => [styles.quickTile, pressed && styles.pressed]}>
            <Ionicons name="map-outline" size={24} color={colors.navy} />
            <Text style={styles.quickLabel}>Plan route</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onMyReportsPress} style={({ pressed }) => [styles.quickTile, pressed && styles.pressed]}>
            <Ionicons name="document-text-outline" size={24} color={colors.navy} />
            <Text style={styles.quickLabel}>My reports</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Latest update</Text>

        <Pressable
          accessibilityRole="button"
          onPress={onMyReportsPress}
          hitSlop={12}
        >
          <Text style={styles.link}>View all</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <SkeletonCard rows={3} />
      ) : error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
      ) : latestReport ? (
        <Pressable accessibilityRole="button" accessibilityLabel="View your report updates" onPress={onMyReportsPress} style={({ pressed }) => [styles.updateCard, pressed && styles.pressed]}>
          <Text style={[styles.eyebrow, { color: reportStatusTone(latestReport.status).text, backgroundColor: reportStatusTone(latestReport.status).background, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }]}>{latestReport.status.replace(/_/g, ' ').toUpperCase()}</Text>
          <Text numberOfLines={1} style={styles.updateTitle}>
            {latestReport.category || 'Community report'}
          </Text>
          <Text numberOfLines={2} style={styles.description}>{latestReport.description}</Text>
          <View style={styles.divider} />
          <Text style={styles.link}>View report updates →</Text>
        </Pressable>
      ) : (
        <View style={styles.updateCard}>
          <Text style={styles.updateTitle}>No report updates yet.</Text>
          <Text style={styles.description}>Your submitted reports will appear here.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  quickSection: { gap: 14 },
  quickRow: { flexDirection: 'row', gap: 12 },
  quickTile: { flex: 1, minHeight: 100, padding: 18, gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.white },
  quickLabel: { fontSize: 14, fontWeight: '600', color: colors.navy },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
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
    backgroundColor: colors.brand,
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
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#A63E37',
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
