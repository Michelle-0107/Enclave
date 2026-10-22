import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { notificationsApi, type ApiError, type NotificationRecord } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { SkeletonList } from '../components/DataSkeleton';

export type ResidentNotification = {
  id: string;
  title: string;
  description: string;
  reference: string;
  time: string;
  read: boolean;
  target:
    | {
        type: 'report';
        reportId: string;
      }
    | {
        type: 'reports';
      }
    | {
        type: 'announcement';
      };
};

type Props = {
  onNotificationPress: (
    notification: ResidentNotification,
  ) => void;
};

export default function NotificationsScreen({
  onNotificationPress,
}: Props) {
  const [notifications, setNotifications] = useState<ResidentNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedNotification, setSelectedNotification] = useState<ResidentNotification | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadNotifications() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
        const response = await notificationsApi.getAll(accessToken, 50);
        if (mounted) setNotifications(response.items.map(mapNotification));
      } catch (loadError) {
        if (!mounted) return;
        const apiError = loadError as ApiError;
        setError(apiError.message || 'Unable to load your notifications.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadNotifications();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>
        STAY INFORMED
      </Text>

      <Text style={styles.title}>
        Notifications
      </Text>

      <Text style={styles.subtitle}>
        Management announcements and community alerts,
        all in one place.
      </Text>

      {isLoading ? (
        <SkeletonList rows={4} avatar />
      ) : error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
      ) : notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>
            You’re all caught up
          </Text>

          <Text style={styles.subtitle}>
            Published announcements from management will
            appear here.
          </Text>
        </View>
      ) : (
        <View style={styles.notificationList}>
          {notifications.map((notification) => (
            <Pressable
              key={notification.id}
              accessibilityRole="button"
              accessibilityLabel={
                `${notification.read ? '' : 'Unread. '}` +
                notification.title
              }
              onPress={() => {
                setNotifications((current) => current.map((item) =>
                  item.id === notification.id ? { ...item, read: true } : item,
                ));
                void markNotificationRead(notification);
                setSelectedNotification({ ...notification, read: true });
              }}
              style={({ pressed }) => [
                styles.notificationCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.notificationMain}>
                <View style={styles.avatar}>
                  <Image
                    source={require('../../assets/enclave-logo.png')}
                    style={styles.logo}
                    resizeMode="contain"
                    accessible={false}
                  />
                </View>

                <View style={styles.notificationContent}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[
                        styles.notificationTitle,
                        !notification.read && styles.unreadTitle,
                      ]}
                    >
                      {notification.title}
                    </Text>
                    {!notification.read && <View style={styles.unreadDot} />}
                  </View>

                  <Text style={styles.description}>
                    {notification.description}
                  </Text>

                  <Text style={styles.meta}>
                    {notification.reference} · {notification.time}
                  </Text>
                </View>
              </View>
              <View style={styles.cardDivider} />
              <Text style={styles.cardAction}>View details →</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={selectedNotification !== null} transparent animationType="fade"
        onRequestClose={() => undefined}>
        <View style={styles.detailOverlay}>
          <View style={styles.detailCard}>
            {selectedNotification && <>
              <View style={styles.detailHeader}>
                <Text accessibilityRole="header" style={styles.detailTitle}>{selectedNotification.title}</Text>
              </View>
              <Text style={styles.detailMeta}>{selectedNotification.time} · {selectedNotification.reference}</Text>
              <ScrollView style={styles.detailBody} contentContainerStyle={styles.detailContent}>
                <Text selectable style={styles.detailMessage}>{selectedNotification.description}</Text>
              </ScrollView>
              {selectedNotification.target.type !== 'announcement' && <Pressable accessibilityRole="button"
                onPress={() => { setSelectedNotification(null); onNotificationPress(selectedNotification); }}
                style={styles.reportButton}>
                <Text style={styles.reportButtonText}>View my reports</Text>
              </Pressable>}
              <Pressable accessibilityRole="button" onPress={() => setSelectedNotification(null)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </>}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function mapNotification(notification: NotificationRecord): ResidentNotification {
  return {
    id: String(notification.id),
    title: notification.title,
    description: notification.message,
    reference: notification.related_report_id
      ? `Related report #${notification.related_report_id}`
      : 'Management announcement',
    time: formatRelativeTime(notification.created_at),
    read: notification.is_read,
    // The internal numeric related_report_id cannot be used as a public ticket_id.
    // Open the resident's report list only when they explicitly request it.
    target: notification.related_report_id != null ? { type: 'reports' } : { type: 'announcement' },
  };
}

async function markNotificationRead(notification: ResidentNotification) {
  const notificationId = Number(notification.id);
  if (!Number.isInteger(notificationId)) return;
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;
    await notificationsApi.markRead(accessToken, notificationId);
  } catch {
    // The local state remains useful if a read receipt cannot be saved.
  }
}

function formatRelativeTime(value: string | null): string {
  if (!value) return 'Date unavailable';
  const age = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(age / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const styles = StyleSheet.create({
  detailOverlay: { flex: 1, backgroundColor: '#00000077', justifyContent: 'center', alignItems: 'center', padding: 20 },
  detailCard: { width: '100%', maxWidth: 560, maxHeight: '85%', backgroundColor: colors.white, borderRadius: 20, padding: 20, gap: 12 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailMeta: { fontSize: 13, lineHeight: 20, color: colors.muted },
  detailBody: { flexGrow: 0, flexShrink: 1 },
  detailContent: { paddingBottom: 4 },
  detailTitle: { flex: 1, fontSize: 22, lineHeight: 30, color: colors.navy, fontWeight: '700' },
  detailMessage: { fontSize: 16, lineHeight: 25, color: colors.navy },
  reportButton: { minHeight: 48, borderRadius: 16, backgroundColor: colors.brand, padding: 14, alignItems: 'center', justifyContent: 'center' },
  reportButtonText: { color: colors.white, fontWeight: '700' },
  cancelButton: { minHeight: 48, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: colors.navy, fontWeight: '700' },
  container: {
    gap: 20,
  },

  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
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

  notificationList: {
    gap: 12,
  },

  notificationCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },

  notificationMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
  },

  cardAction: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.navy,
  },

  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },

  logo: {
    tintColor: colors.brand,
    width: 22,
    height: 26,
  },

  notificationContent: {
    flex: 1,
    gap: 8,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  notificationTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    color: colors.navy,
  },

  unreadTitle: {
    fontWeight: '600',
  },

  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.navy,
  },

  description: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },

  meta: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
  },

  emptyState: {
    padding: 20,
    gap: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
  },

  emptyTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: colors.navy,
  },

  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#A63E37',
  },

  pressed: {
    opacity: 0.75,
  },
});
