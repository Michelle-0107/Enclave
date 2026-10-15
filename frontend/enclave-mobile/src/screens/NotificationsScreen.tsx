import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

const initialNotifications = [
  {
    id: '1',
    title: 'Your report is in progress',
    message: 'Work has started on your streetlight report.',
    reference: '#HP-1024 · Park Entrance',
    time: '10 min ago',
    unread: true,
  },
  {
    id: '2',
    title: 'Walkway closure reviewed',
    message: 'A reviewed closure affects Park Entrance.',
    reference: 'Community update',
    time: '1 hour ago',
    unread: true,
  },
  {
    id: '3',
    title: 'Repair verified',
    message: 'The Lake Walk surface repair is complete.',
    reference: 'Community update',
    time: 'Yesterday',
    unread: false,
  },
];

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState(
    initialNotifications
  );

  function markAllRead() {
    setNotifications((items) =>
      items.map((item) => ({ ...item, unread: false }))
    );
  }

  function markRead(id: string) {
    setNotifications((items) =>
      items.map((item) =>
        item.id === id ? { ...item, unread: false } : item
      )
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notifications.</Text>

      <View style={styles.headingRow}>
        <Text style={styles.subtitle}>Your community, connected.</Text>

        <Pressable
          onPress={markAllRead}
          accessibilityRole="button"
          hitSlop={10}
        >
          <Text style={styles.link}>Mark all read</Text>
        </Pressable>
      </View>

      <Text style={styles.demoLabel}>SAMPLE UPDATES</Text>

      <View>
        {notifications.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => markRead(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${item.unread ? 'Unread. ' : ''}${item.title}`}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>E</Text>
            </View>

            <View style={styles.body}>
              <View style={styles.rowHeading}>
                <Text style={styles.notificationTitle}>
                  {item.title}
                </Text>

                {item.unread && <View style={styles.unreadDot} />}
              </View>

              <Text style={styles.message}>{item.message}</Text>
              <Text style={styles.reference}>{item.reference}</Text>
              <Text style={styles.time}>{item.time}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 20 },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    color: colors.navy,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
  },
  link: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.navy,
  },
  demoLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.muted,
  },
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.white,
  },
  body: { flex: 1, gap: 7 },
  rowHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.navy,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.navy,
  },
  message: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
  reference: {
    fontSize: 11,
    color: colors.muted,
  },
  time: {
    fontSize: 10,
    color: colors.muted,
  },
  pressed: { opacity: 0.7 },
});