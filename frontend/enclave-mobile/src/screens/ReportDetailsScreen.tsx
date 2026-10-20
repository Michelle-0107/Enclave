import { NativeMap as Map } from '../navigation/NativeMap';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Camera, Marker } from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';

import { reportsApi, type ApiError, type ReportHistoryEvent, type ReportRecord } from '../lib/api';
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
  onMapTouchChange?: (active: boolean) => void;
};

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const tones = {
  normal: colors.navy,
  orange: '#966114',
  red: '#A63E37',
  green: '#2D7050',
};

function getStatusStyle(status: ReportStatus) {
  if (status === 'Repair verified / resolved') {
    return {
      text: '#2D7050',
      background: '#E5F3EA',
    };
  }

  if (status === 'Rejected') {
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
  onMapTouchChange,
}: Props) {
  const [currentReport, setCurrentReport] = useState(report);
  const statusStyle = getStatusStyle(currentReport.status);
  const [progressItems, setProgressItems] = useState<ReportProgressItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [photoExpanded, setPhotoExpanded] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadHistory() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
        const [latest, history] = await Promise.all([
          reportsApi.getReport(accessToken, report.id),
          reportsApi.getReportHistory(accessToken, report.id),
        ]);
        if (mounted) {
          setCurrentReport(mapReportRecord(latest));
          setProgressItems([
            {
              id: 'submitted',
              title: 'Submitted',
              description: `${mapReportRecord(latest).date} · Report received.`,
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
  }, [report.id]);

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>REPORT DETAILS</Text>
        <Text style={styles.title}>{currentReport.title}</Text>
        <Text style={styles.meta}>#{currentReport.id}  ·  Submitted {currentReport.date}</Text>
        <View style={[styles.status, { backgroundColor: statusStyle.background }]}>
          <View style={[styles.statusDot, { backgroundColor: statusStyle.text }]} />
          <Text style={[styles.statusText, { color: statusStyle.text }]}>{currentReport.status}</Text>
        </View>
      </View>

      <View style={styles.photoContainer}>
        {currentReport.photoUri ? (
          <>
            <Image source={{ uri: currentReport.photoUri }} style={styles.photo} resizeMode="contain" accessibilityLabel="Submitted report photo" />
            <Pressable accessibilityRole="button" onPress={() => setPhotoExpanded(true)} style={styles.expandButton}>
              <Ionicons name="expand-outline" size={18} color={colors.white} />
              <Text style={styles.expandText}>Expand photo</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.photoPlaceholder}>No photo available</Text>
        )}
      </View>

      <View style={styles.detailsCard}>
        <View style={styles.cardHeadingRow}>
          <View style={styles.cardIcon}><Ionicons name="document-text-outline" size={19} color={colors.navy} /></View>
          <Text style={styles.cardTitle}>Report details</Text>
        </View>
        <View style={styles.detailRow}>
          <View style={styles.detailIcon}><Ionicons name="grid-outline" size={16} color={colors.muted} /></View>
          <View style={styles.detailCopy}><Text style={styles.detailLabel}>Category</Text><Text style={styles.detailValue}>{currentReport.category}</Text></View>
        </View>
        <View style={styles.detailRow}>
          <View style={styles.detailIcon}><Ionicons name="flag-outline" size={16} color={colors.muted} /></View>
          <View style={styles.detailCopy}><Text style={styles.detailLabel}>Priority</Text><Text style={styles.detailValue}>{currentReport.priority}</Text></View>
        </View>
        <View style={styles.descriptionBlock}>
          <Text style={styles.detailLabel}>Description</Text>
          <Text style={styles.description}>{currentReport.description || 'No description provided.'}</Text>
        </View>
      </View>

      <View style={styles.issueDetails}>
        {Number.isFinite(currentReport.latitude) && Number.isFinite(currentReport.longitude) ? (
          <>
            <View style={styles.sectionHeader}>
              <View><Text style={styles.sectionTitle}>Issue location</Text><Text style={styles.sectionSubtitle}>Map preview of the reported spot</Text></View>
              <Ionicons name="location" size={20} color={colors.navy} />
            </View>
            <View
              style={styles.mapContainer}
              onTouchStart={() => onMapTouchChange?.(true)}
              onTouchEnd={() => onMapTouchChange?.(false)}
              onTouchCancel={() => onMapTouchChange?.(false)}
            >
              <Map style={styles.map} mapStyle={MAP_STYLE} compass attribution>
                <Camera
                  initialViewState={{
                    center: [currentReport.longitude!, currentReport.latitude!],
                    zoom: 16,
                  }}
                />
                <Marker id="report-location" lngLat={[currentReport.longitude!, currentReport.latitude!]}>
                  <View collapsable={false} style={styles.mapPin} accessibilityLabel="Reported issue location">
                    <Text style={styles.mapPinText}>!</Text>
                  </View>
                </Marker>
              </Map>
            </View>
            <View style={styles.coordinateRow}><Ionicons name="navigate-outline" size={16} color={colors.muted} /><Text style={styles.location}>{currentReport.location}</Text></View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${currentReport.latitude},${currentReport.longitude}`;
                void Linking.openURL(url).catch(() => Alert.alert('Unable to open maps', 'Please open your maps app and search for the report coordinates.'));
              }}
              style={styles.navigationButton}
            >
              <Text style={styles.navigationButtonText}>Open navigation map</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.location}>{currentReport.location}</Text>
        )}

      </View>

      <Modal visible={photoExpanded} transparent animationType="fade" onRequestClose={() => setPhotoExpanded(false)} statusBarTranslucent>
        <View style={styles.photoModal}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close expanded photo" onPress={() => setPhotoExpanded(false)} style={styles.closePhotoButton}>
            <Ionicons name="close" size={28} color={colors.white} />
          </Pressable>
          {!!currentReport.photoUri && <Image source={{ uri: currentReport.photoUri }} style={styles.expandedPhoto} resizeMode="contain" accessibilityLabel="Expanded report photo" />}
        </View>
      </Modal>

      <View style={styles.progress}>
        <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>Progress</Text><Text style={styles.sectionSubtitle}>Updates on your report</Text></View><View style={styles.progressIcon}><Ionicons name="time-outline" size={19} color={colors.navy} /></View></View>

        {isLoading ? (
          <View style={styles.progressLoading}>
            <ActivityIndicator size="small" color={colors.navy} />
            <Text style={styles.meta}>Loading report history...</Text>
          </View>
        ) : error ? (
          <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
        ) : progressItems.length > 0 ? (
          progressItems.map((item) => (
            <View key={item.id} style={styles.progressItem}>
              <View style={styles.timelineRail}><View style={[styles.timelineDot, { backgroundColor: tones[item.tone ?? 'normal'] }]} /></View>
              <View style={styles.progressCopy}>
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

function mapReportRecord(record: ReportRecord): ResidentReport {
  const status = record.status === 'resolved'
    ? 'Repair verified / resolved'
    : record.status === 'approved'
      ? 'Approved for maintenance'
      : record.status === 'rejected'
        ? 'Rejected'
        : record.status === 'in_progress'
          ? 'Repair in progress'
          : 'Pending management review';
  return {
    id: record.ticket_id,
    title: record.category || 'Community report',
    location: record.location_name?.trim() || 'Selected map point',
    date: record.created_at
      ? new Date(record.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Date unavailable',
    status,
    description: record.description,
    category: record.category || 'Uncategorised',
    priority: record.priority || 'Not set',
    latitude: record.latitude,
    longitude: record.longitude,
    photoUri: record.image_url || undefined,
  };
}

const styles = StyleSheet.create({
  container: {
    gap: 18,
    paddingBottom: 12,
  },

  heading: {
    gap: 9,
  },

  eyebrow: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  title: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 33,
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
    borderRadius: 18,
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
    gap: 11,
  },

  detailsCard: {
    gap: 16,
    padding: 18,
    borderRadius: 22,
    backgroundColor: colors.lavender,
  },

  cardHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },

  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },

  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.navy,
  },

  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailCopy: { flex: 1, gap: 3 },
  detailIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  detailLabel: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  detailValue: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  descriptionBlock: { gap: 7, paddingTop: 13, borderTopWidth: 1, borderTopColor: 'rgba(32,44,70,0.1)' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionSubtitle: { marginTop: 2, color: colors.muted, fontSize: 12, lineHeight: 18 },

  mapContainer: {
    height: 225,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.lavender,
  },

  map: {
    flex: 1,
  },

  mapPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },

  mapPinText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
  },

  navigationButton: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
  },

  navigationButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },

  location: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    color: colors.muted,
  },

  coordinateRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },

  description: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },

  photoContainer: {
    height: 250,
    backgroundColor: colors.lavender,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photo: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.lavender,
  },

  expandButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    minHeight: 38,
    borderRadius: 20,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(32, 44, 70, 0.9)',
  },

  expandText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },

  photoModal: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
  },

  expandedPhoto: {
    width: '100%',
    height: '100%',
  },

  closePhotoButton: {
    position: 'absolute',
    zIndex: 1,
    top: 44,
    right: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(32, 44, 70, 0.75)',
  },

  photoPlaceholder: {
    fontSize: 12,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },

  progress: {
    gap: 15,
    padding: 18,
    borderRadius: 22,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
    color: colors.navy,
  },

  progressItem: {
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
  },

  timelineRail: { width: 14, alignItems: 'center', paddingTop: 5 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.white },
  progressCopy: { flex: 1, gap: 3, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  progressIcon: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },

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
