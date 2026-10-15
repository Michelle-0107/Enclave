import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

export const demoNotifications: ResidentNotification[] = [
  {
    id: 'notification-1',
    title: 'Your report is in progress',
    description:
      'Work has started on your streetlight report.',
    reference: '#HP-1024 · Park Entrance',
    time: '10m',
    read: false,
    target: {
      type: 'report',
      reportId: 'HP-1024',
    },
  },
  {
    id: 'notification-2',
    title: 'Walkway closure reviewed',
    description:
      'An approved closure affects Park Entrance.',
    reference: 'Followed area · Park Entrance',
    time: '1h',
    read: false,
    target: {
      type: 'map',
    },
  },
  {
    id: 'notification-3',
    title: 'Repair verified',
    description:
      'The Lake Walk surface repair is complete.',
    reference: 'Followed area · Lake Walk',
    time: 'Yesterday',
    read: true,
    target: {
      type: 'map',
    },
  },
];

type Props = {
  notifications: ResidentNotification[];
  onNotificationPress: (
    notification: ResidentNotification,
  ) => void;
};

export default function NotificationsScreen({
  notifications,
  onNotificationPress,
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>
        STAY INFORMED
      </Text>

      <Text style={styles.title}>
        Notifications
      </Text>

      <Text style={styles.subtitle}>
        Community alerts and report progress, all in
        one place.
      </Text>

      {notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>
            You’re all caught up
          </Text>

          <Text style={styles.subtitle}>
            Updates about your reports and followed
            areas will appear here.
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
              onPress={() =>
                onNotificationPress(notification)
              }
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

      <Text style={styles.demoText}>
        Sample notifications for design preview
      </Text>
    </View>
  );
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

  demoText: {
    fontSize: 10,
    lineHeight: 18,
    color: colors.muted,
  },

  pressed: {
    opacity: 0.75,
  },
});