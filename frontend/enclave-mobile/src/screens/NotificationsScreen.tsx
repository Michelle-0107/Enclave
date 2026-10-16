import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { notificationsApi, type ApiError, type NotificationRecord } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

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
        type: 'map';
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
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.navy} />
          <Text style={styles.subtitle}>Loading your updates...</Text>
        </View>
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
        <View>
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
                onNotificationPress(notification);
              }}
              style={({ pressed }) => [
                styles.notificationRow,
                pressed && styles.pressed,
              ]}
            >
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
                      !notification.read &&
                        styles.unreadTitle,
                    ]}
                  >
                    {notification.title}
                  </Text>

                  {!notification.read && (
                    <View style={styles.unreadDot} />
                  )}
                </View>

                <Text style={styles.description}>
                  {notification.description}
                </Text>

                <Text style={styles.meta}>
                  {notification.reference}
                </Text>

                <Text style={styles.meta}>
                  {notification.time}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

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
    // related_report_id is an internal numeric database ID, not a ticket_id.
    // Keep the broadcast non-navigable until the backend exposes a safe ticket mapping.
    target: { type: 'map' },
  };
}

async function markNotificationRead(notification: ResidentNotification) {
  const notificationId = Number(notification.id);
  if (!Number.isInteger(notificationId)) return;
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return;
  try {
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

  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 20,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    paddingVertical: 32,
    gap: 10,
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
