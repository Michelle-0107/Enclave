import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme';

type Props = {
  onMyReportsPress: () => void;
  onFollowedAreasPress: () => void;
  onNotificationPreferencesPress: () => void;
  onHelpPress: () => void;
  onLogOut: () => void;
};

export default function AccountScreen({
  onMyReportsPress,
  onFollowedAreasPress,
  onNotificationPreferencesPress,
  onHelpPress,
  onLogOut,
}: Props) {
  const menuItems = [
    {
      label: 'My reports',
      onPress: onMyReportsPress,
    },
    {
      label: 'Followed areas',
      onPress: onFollowedAreasPress,
    },
    {
      label: 'Notification preferences',
      onPress: onNotificationPreferencesPress,
    },
    {
      label: 'Help',
      onPress: onHelpPress,
    },
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>
        YOUR ENCLAVE
      </Text>

      <Text style={styles.title}>
        My account.
      </Text>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>F</Text>
        </View>

        <View style={styles.profileInfo}>
          <Text style={styles.name}>Florence</Text>

          <Text style={styles.subtitle}>
            Resident
          </Text>

          <Text style={styles.previewText}>
            Demo profile
          </Text>
        </View>
      </View>

      <View style={styles.menu}>
        {menuItems.map((item, index) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.menuRow,
              index < menuItems.length - 1 &&
                styles.divider,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.menuLabel}>
              {item.label}
            </Text>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.muted}
            />
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onLogOut}
        style={({ pressed }) => [
          styles.logoutButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name="log-out-outline"
          size={20}
          color={colors.navy}
        />

        <Text style={styles.logoutText}>
          Log out
        </Text>
      </Pressable>

      <Text style={styles.previewText}>
        Demo session · Authentication is not connected yet.
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

  previewText: {
    fontSize: 11,
    lineHeight: 18,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 20,
    minHeight: 60,
  },

  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.navy,
  },

  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },

  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.navy,
  },

  pressed: {
    opacity: 0.75,
  },
});