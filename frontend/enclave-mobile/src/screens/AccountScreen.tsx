import { StyleSheet, Text, View } from 'react-native';
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
      <Text style={styles.eyebrow}>YOUR ENCLAVE</Text>

      <Text style={styles.title}>My account.</Text>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>E</Text>
        </View>

        <View style={styles.profileInfo}>
          <Text style={styles.name}>Resident</Text>
          <Text style={styles.subtitle}>
            Sign-in will be connected later.
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
            <Text style={styles.comingSoon}>Coming next</Text>
          </View>
        ))}
      </View>
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
    letterSpacing: 2,
    color: colors.muted,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 42,
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
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '600',
    color: colors.white,
  },
  profileInfo: {
    flex: 1,
    gap: 6,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.navy,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
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
    paddingVertical: 20,
    gap: 6,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.navy,
  },
  comingSoon: {
    fontSize: 12,
    color: colors.muted,
  },
});