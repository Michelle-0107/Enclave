import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { reportsApi, type ApiError, type ReportRecord } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors, reportStatusTone } from '../theme';
import { SkeletonList } from '../components/DataSkeleton';

export type ReportStatus =
  | 'Pending management review'
  | 'Approved for maintenance'
  | 'Rejected'
  | 'Repair in progress'
  | 'Repair verified / resolved';

export type ResidentReport = {
  id: string;
  title: string;
  location: string;
  date: string;
  status: ReportStatus;
  description: string;
  category: string;
  priority: string;
  latitude?: number;
  longitude?: number;
  photoUri?: string;
};

type Filter = 'All' | 'Open' | 'Resolved';

type Props = {
  onBack: () => void;
  onReportPress: (report: ResidentReport) => void;
  reports?: ResidentReport[];
};

const filters: Filter[] = ['All', 'Open', 'Resolved'];

export default function MyReportsScreen({
  onBack,
  onReportPress,
  reports = [],
}: Props) {
  const [activeFilter, setActiveFilter] =
    useState<Filter>('All');
  const [serverReports, setServerReports] = useState<ResidentReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadReports() {
      setIsLoading(true);
      setError('');

      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const accessToken = data.session?.access_token;
        if (!accessToken) {
          throw new Error('Your session has expired. Please sign in again.');
        }

        const loaded: ResidentReport[] = [];
        let offset = 0;
        const limit = 20;

        while (mounted) {
          const response = await reportsApi.getMyReports(accessToken, limit, offset);
          loaded.push(...response.items.map(mapReportRecord));

          if (response.items.length < limit) break;
          const nextOffset = offset + response.items.length;
          if (nextOffset <= offset) throw new Error('Invalid report pagination response.');
          offset = nextOffset;
        }

        if (mounted) {
          setServerReports(loaded.filter((report, index, items) =>
            items.findIndex((item) => item.id === report.id) === index,
          ));
        }
      } catch (loadError) {
        if (!mounted) return;
        const apiError = loadError as ApiError;
        setError(apiError.message || 'Unable to load your reports.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadReports();
    return () => {
      mounted = false;
    };
  }, []);

  const allReports = useMemo(() => {
    const combined = [...serverReports, ...reports];
    return combined.filter(
      (report, index, items) =>
        items.findIndex((item) => item.id === report.id) === index,
    );
  }, [reports, serverReports]);

  const visibleReports = allReports.filter((report) => {
    if (activeFilter === 'Open') {
      return report.status !== 'Repair verified / resolved' && report.status !== 'Rejected';
    }

    if (activeFilter === 'Resolved') {
      return report.status === 'Repair verified / resolved';
    }

    return true;
  });

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        hitSlop={8}
        style={styles.backButton}
      >
        <Text style={styles.backText}>
          ‹ My Account
        </Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={styles.title}>My reports.</Text>

        <Text style={styles.subtitle}>
          Track the issues you have reported.
        </Text>
      </View>

      <View style={styles.reportsSection}>
        <View style={styles.filters}>
          {filters.map((filter) => {
            const selected = activeFilter === filter;

            return (
              <Pressable
                key={filter}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setActiveFilter(filter)}
                style={({ pressed }) => [
                  styles.filter,
                  selected && styles.selectedFilter,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    selected && styles.selectedFilterText,
                  ]}
                >
                  {filter}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isLoading ? (
          <SkeletonList rows={4} />
        ) : error ? (
          <View style={styles.emptyState}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          </View>
        ) : visibleReports.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {activeFilter === 'Resolved'
                ? 'No resolved reports yet.'
                : activeFilter === 'Open'
                  ? 'No open reports.'
                  : 'No reports yet.'}
            </Text>

            <Text style={styles.subtitle}>
              Your reports will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.reportList}>
            {visibleReports.map((report) => (
              <Pressable
                key={report.id}
                accessibilityRole="button"
                accessibilityLabel={`${report.title}, ${report.status}. View report`}
                onPress={() => onReportPress(report)}
                style={({ pressed }) => [
                  styles.reportCard,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.reportStatus,
                    {
                      color: reportStatusTone(report.status).text,
                      backgroundColor: reportStatusTone(report.status).background,
                      alignSelf: 'flex-start',
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 8,
                    },
                  ]}
                >
                  {report.status}
                </Text>

                <Text style={styles.reportTitle}>
                  {report.title}
                </Text>

                <Text style={styles.reportMeta}>
                  #{report.id} · {report.location}
                </Text>

                <Text style={styles.reportDate}>
                  {report.date}
                </Text>
                <View style={styles.cardDivider} />
                <Text style={styles.cardAction}>View report →</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function mapReportRecord(record: ReportRecord): ResidentReport {
  const status = mapReportStatus(record.status);
  const date = record.created_at
    ? new Date(record.created_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Date unavailable';

  return {
    id: record.ticket_id,
    title: record.category || 'Community report',
    location: record.location_name?.trim() || 'Selected map point',
    date,
    status,
    description: record.description,
    category: record.category || 'Uncategorised',
    priority: record.priority || 'Not set',
    latitude: record.latitude,
    longitude: record.longitude,
    photoUri: record.image_url || undefined,
  };
}

function mapReportStatus(value: string): ReportStatus {
  switch (value.toLowerCase()) {
    case 'resolved':
      return 'Repair verified / resolved';
    case 'approved':
      return 'Approved for maintenance';
    case 'in_progress':
    case 'in progress':
      return 'Repair in progress';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Pending management review';
  }
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },

  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },

  backText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 24,
    color: colors.navy,
  },

  heading: {
    gap: 8,
  },

  title: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 38,
    color: colors.navy,
  },

  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },

  filters: {
    flexDirection: 'row',
    gap: 8,
  },

  reportsSection: {
    gap: 14,
  },

  reportList: {
    gap: 12,
  },

  filter: {
    flex: 1,
    maxWidth: 96,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },

  selectedFilter: {
    backgroundColor: colors.brand,
  },

  filterText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 20,
    color: colors.navy,
  },

  selectedFilterText: {
    color: colors.white,
  },

  reportCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },

  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: 2,
  },

  cardAction: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.navy,
  },

  reportTitle: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  reportMeta: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },

  reportStatus: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },

  reportDate: {
    fontSize: 11,
    lineHeight: 18,
    color: colors.muted,
  },

  emptyState: {
    padding: 20,
    gap: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
  },

  loadingState: {
    paddingVertical: 32,
    gap: 12,
    alignItems: 'center',
  },

  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#A63E37',
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
    color: colors.navy,
  },

  pressed: {
    opacity: 0.75,
  },
});
