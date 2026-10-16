import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { reportsApi, type ApiError, type ReportRecord } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

export type ReportStatus =
  | 'Pending management review'
  | 'In progress'
  | 'Needs information'
  | 'Resolved';

export type ResidentReport = {
  id: string;
  title: string;
  location: string;
  date: string;
  status: ReportStatus;
  description: string;
  category: string;
  priority: string;
  photoUri?: string;
};

type Filter = 'All' | 'Open' | 'Resolved';

type Props = {
  onBack: () => void;
  onReportPress: (report: ResidentReport) => void;
  reports?: ResidentReport[];
};

const filters: Filter[] = ['All', 'Open', 'Resolved'];

function getStatusColor(status: ReportStatus) {
  switch (status) {
    case 'Needs information':
      return '#A63E37';

    case 'Resolved':
      return '#2D7050';

    default:
      return '#966114';
  }
}

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

        const response = await reportsApi.getMyReports(accessToken, 50);
        if (mounted) setServerReports(response.items.map(mapReportRecord));
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
    const combined = [...reports, ...serverReports];
    return combined.filter(
      (report, index, items) =>
        items.findIndex((item) => item.id === report.id) === index,
    );
  }, [reports, serverReports]);

  const visibleReports = allReports.filter((report) => {
    if (activeFilter === 'Open') {
      return report.status !== 'Resolved';
    }

    if (activeFilter === 'Resolved') {
      return report.status === 'Resolved';
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

      <View>
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
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={colors.navy} />
            <Text style={styles.subtitle}>Loading your reports...</Text>
          </View>
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
          visibleReports.map((report) => (
            <Pressable
              key={report.id}
              accessibilityRole="button"
              accessibilityLabel={`${report.title}, ${report.status}. View report`}
              onPress={() => onReportPress(report)}
              style={({ pressed }) => [
                styles.reportRow,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.reportTitle}>
                {report.title}
              </Text>

              <Text style={styles.reportMeta}>
                #{report.id} · {report.location}
              </Text>

              <Text
                style={[
                  styles.reportStatus,
                  {
                    color: getStatusColor(report.status),
                  },
                ]}
              >
                {report.status}
              </Text>

              <Text style={styles.reportDate}>
                {report.date}
              </Text>
            </Pressable>
          ))
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
    location: `${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}`,
    date,
    status,
    description: record.description,
    category: record.category || 'Uncategorised',
    priority: record.priority || 'Not set',
    photoUri: record.image_url || undefined,
  };
}

function mapReportStatus(value: string): ReportStatus {
  switch (value.toLowerCase()) {
    case 'resolved':
      return 'Resolved';
    case 'in_progress':
    case 'in progress':
      return 'In progress';
    case 'needs_information':
    case 'needs information':
    case 'rejected':
      return 'Needs information';
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
    backgroundColor: colors.navy,
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

  reportRow: {
    paddingVertical: 24,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    paddingVertical: 32,
    gap: 8,
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
