import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

export const demoReports: ResidentReport[] = [
  {
    id: 'HP-1024',
    title: 'Streetlight malfunction',
    location: 'Park Entrance',
    date: '14 Oct 2026',
    status: 'In progress',
    description:
      'The streetlight near the park entrance is not working at night.',
    category: 'Streetlight',
    priority: 'High',
  },
  {
    id: 'HP-1025',
    title: 'Damaged kerb ramp',
    location: 'Maple Road',
    date: '13 Oct 2026',
    status: 'Needs information',
    description:
      'The kerb ramp is cracked and uneven.',
    category: 'Accessibility',
    priority: 'High',
  },
  {
    id: 'HP-1012',
    title: 'Broken park bench',
    location: 'Central Park',
    date: '10 Oct 2026',
    status: 'Resolved',
    description:
      'The park bench has a damaged seat.',
    category: 'Facility',
    priority: 'Medium',
  },
];

type Filter = 'All' | 'Open' | 'Resolved';

type Props = {
  onBack: () => void;
  onReportPress: (report: ResidentReport) => void;
  reports?: ResidentReport[];
  isDemo?: boolean;
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
  reports = demoReports,
  isDemo = true,
}: Props) {
  const [activeFilter, setActiveFilter] =
    useState<Filter>('All');

  const visibleReports = reports.filter((report) => {
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

        {visibleReports.length === 0 ? (
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

        {isDemo && (
          <Text style={styles.demoText}>
            Sample reports for design preview
          </Text>
        )}
      </View>
    </View>
  );
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

  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
    color: colors.navy,
  },

  demoText: {
    marginTop: 8,
    fontSize: 10,
    lineHeight: 18,
    color: colors.muted,
  },

  pressed: {
    opacity: 0.75,
  },
});