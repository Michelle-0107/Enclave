import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { reportsApi, type ApiError, type ReportHistoryEvent } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import type {
  ResidentReport,
  ReportStatus,
} from './MyReportsScreen';

export type ReportProgressItem = {
  id: string;
  title: string;
  description: string;
  tone?: 'normal' | 'orange' | 'red' | 'green';
};

type Props = {
  report: ResidentReport;
  onBack: () => void;
};

const tones = {
  normal: colors.navy,
  orange: '#966114',
  red: '#A63E37',
  green: '#2D7050',
};

function getStatusStyle(status: ReportStatus) {
  if (status === 'Resolved') {
    return {
      text: '#2D7050',
      background: '#E5F3EA',
    };
  }

  if (status === 'Needs information') {
    return {
      text: '#A63E37',
      background: '#FBE9E7',
    };
  }

  return {
    text: '#966114',
    background: '#FFF0D9',
  };
}

export default function ReportDetailsScreen({
  report,
  onBack,
}: Props) {
  const statusStyle = getStatusStyle(report.status);
  const [progressItems, setProgressItems] = useState<ReportProgressItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadHistory() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
        const history = await reportsApi.getReportHistory(accessToken, report.id);
        if (mounted) {
          setProgressItems([
            {
              id: 'submitted',
              title: 'Submitted',
              description: `${report.date} · Report received.`,
              tone: 'normal',
            },
            ...history.items.map(mapHistoryEvent),
          ]);
        }
      } catch (loadError) {
        if (!mounted) return;
        const apiError = loadError as ApiError;
        setError(apiError.message || 'Unable to load report history.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadHistory();
    return () => {
      mounted = false;
    };
  }, [report.date, report.id]);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        hitSlop={8}
        style={styles.backButton}
      >
        <Text style={styles.backText}>
          ‹ My reports
        </Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={styles.title}>
          {report.title}
        </Text>

        <Text style={styles.meta}>
          #{report.id} · Submitted {report.date}
        </Text>
      </View>

      <View
        style={[
          styles.status,
          {
            backgroundColor: statusStyle.background,
          },
        ]}
      >
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: statusStyle.text,
            },
          ]}
        />

        <Text
          style={[
            styles.statusText,
            {
              color: statusStyle.text,
            },
          ]}
        >
          {report.status}
        </Text>
      </View>

      <View style={styles.issueDetails}>
        <Text style={styles.location}>
          {report.location}
        </Text>

        <Text style={styles.description}>
          {report.description}
        </Text>

        <Text style={styles.meta}>
          Category: {report.category} · Priority:{' '}
          {report.priority}
        </Text>
      </View>

      <View style={styles.photoContainer}>
        {report.photoUri ? (
          <Image
            source={{ uri: report.photoUri }}
            style={styles.photo}
            accessibilityLabel="Submitted report photo"
          />
        ) : (
          <Text style={styles.photoPlaceholder}>No photo available</Text>
        )}
      </View>

      <View style={styles.progress}>
        <Text style={styles.sectionTitle}>
          Progress
        </Text>

        {isLoading ? (
          <View style={styles.progressLoading}>
            <ActivityIndicator size="small" color={colors.navy} />
            <Text style={styles.meta}>Loading report history...</Text>
          </View>
        ) : error ? (
          <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
        ) : progressItems.length > 0 ? (
          progressItems.map((item) => (
            <View
              key={item.id}
              style={styles.progressItem}
            >
              <Text
                style={[
                  styles.progressTitle,
                  {
                    color: tones[item.tone ?? 'normal'],
                  },
                ]}
              >
                {item.title}
              </Text>

              <Text style={styles.meta}>
                {item.description}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.meta}>
            Progress updates will appear here.
          </Text>
        )}
      </View>

    </View>
  );
}

function mapHistoryEvent(event: ReportHistoryEvent): ReportProgressItem {
  const tone: ReportProgressItem['tone'] = event.to_status === 'rejected'
    ? 'red'
    : event.to_status === 'resolved'
      ? 'green'
      : 'orange';
  return {
    id: String(event.id),
    title: event.to_status.replaceAll('_', ' '),
    description: `${new Date(event.created_at).toLocaleDateString('en-GB')} · ${event.note}`,
    tone,
  };
}

const styles = StyleSheet.create({
  container: {
    gap: 22,
  },

  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },

  backText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  heading: {
    gap: 8,
  },

  title: {
    fontSize: 27,
    fontWeight: '700',
    lineHeight: 35,
    color: colors.navy,
  },

  meta: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },

  status: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    maxWidth: '100%',
  },

  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  statusText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22,
  },

  issueDetails: {
    gap: 10,
  },

  location: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  description: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },

  photoContainer: {
    height: 110,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photo: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },

  photoPlaceholder: {
    fontSize: 12,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },

  progress: {
    gap: 14,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  progressItem: {
    gap: 3,
  },

  progressTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
  },

  progressLoading: {
    gap: 8,
    alignItems: 'flex-start',
  },

  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#A63E37',
  },
});
