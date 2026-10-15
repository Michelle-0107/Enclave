import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

const menuItems = [
  'My reports',
  'Followed areas',
  'Notification preferences',
  'Help',
];

export default function AccountScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My account.</Text>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>F</Text>
        </View>

        <View style={styles.profileInfo}>
          <Text style={styles.name}>Florence</Text>
          <Text style={styles.subtitle}>
            Verified community resident
          </Text>
        </View>
      </View>

      <View style={styles.menu}>
        {menuItems.map((item, index) => (
          <View
            key={item}
            style={[
              styles.menuRow,
              index < menuItems.length - 1 && styles.divider,
            ]}
          >
            <Text style={styles.menuLabel}>{item}</Text>

            <Ionicons
              name="chevron-forward-outline"
              size={18}
              color={colors.muted}
            />
          </View>
        ))}
      </View>

      <View
        accessibilityRole="button"
        accessibilityLabel="Log out"
        accessibilityState={{ disabled: true }}
        style={styles.logoutButton}
      >
        <Ionicons
          name="log-out-outline"
          size={20}
          color={colors.navy}
        />
        <Text style={styles.logoutText}>Log out</Text>
      </View>

      <Text style={styles.demoNote}>
        Demo profile. Account actions will be connected next.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 24 },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    color: colors.navy,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lavender,
    borderRadius: 24,
    padding: 22,
    gap: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.white,
  },
  profileInfo: { flex: 1, gap: 7 },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.navy,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
  menu: {
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  logoutButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.navy,
    opacity: 0.5,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  demoNote: {
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.muted,
  },
});