import { useEffect, useState } from 'react';
import {
  Image,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AccountSettings from '../components/AccountSettings';
import { Ionicons } from '@expo/vector-icons';

import { residencyApi, type ApiError, type ResidencyRecord } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { SkeletonBlock, SkeletonCard } from '../components/DataSkeleton';

type Props = {
  avatarUrl: string;
  onAvatarChange: (url: string) => void;
  onMyReportsPress: () => void;
  onFollowedAreasPress: () => void;
  onNotificationPreferencesPress: () => void;
  onHelpPress: () => void;
  onLogOut: () => void;
};

export default function AccountScreen({
  avatarUrl,
  onAvatarChange,
  onMyReportsPress,
  onFollowedAreasPress,
  onNotificationPreferencesPress,
  onHelpPress,
  onLogOut,
}: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [residency, setResidency] = useState<ResidencyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  function confirmLogOut() {
    Alert.alert(
      'Confirm log out',
      'Are you sure you want to log out of your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: onLogOut },
      ],
      { cancelable: false },
    );
  }

  useEffect(() => {
    let mounted = true;

    async function loadAccountRecord() {
      setIsLoading(true);
      setError('');

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        const session = sessionData.session;
        if (!session?.access_token) {
          throw new Error('Your session has expired. Please sign in again.');
        }

        const record = await residencyApi.getMyResidency(session.access_token);
        if (mounted) {
          setEmail(session.user.email ?? null);
          setResidency(record);
        }
      } catch (loadError) {
        if (!mounted) return;
        const message = loadError as ApiError;
        if (message.status === 404) {
          setError('Your account is not linked to a resident record yet.');
        } else if (message.status === 401) {
          setError('Your session has expired. Please sign in again.');
        } else {
          setError(message.message || 'Unable to load your account record.');
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadAccountRecord();
    return () => {
      mounted = false;
    };
  }, []);

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
        {isLoading ? (
          <View style={{ flex: 1, gap: 12, paddingVertical: 8 }}><SkeletonBlock width="58%" height={18} /><SkeletonBlock width="74%" height={13} /><SkeletonBlock width="34%" height={12} /></View>
        ) : residency ? (
          <>
            <View style={styles.avatar}>
              {avatarUrl ? <Image source={{ uri: avatarUrl }} accessibilityLabel="Your profile photo" style={{ width: 60, height: 60, borderRadius: 30 }} /> : <Text style={styles.avatarText}>
                {(residency.full_name?.trim().charAt(0) || 'R').toUpperCase()}
              </Text>}
            </View>

            <View style={styles.profileInfo}>
              <Text style={styles.name}>{residency.full_name || 'Resident'}</Text>
              <Text style={styles.subtitle}>{email ?? 'Resident account'}</Text>
              <Text style={styles.recordText}>Unit {residency.unit_number}</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, residency.status === 'active' && styles.activeDot]} />
                <Text style={styles.statusText}>{residency.status === 'active' ? 'Active resident' : 'Inactive resident'}</Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.errorText}>{error || 'No resident record found.'}</Text>
        )}
      </View>

      <AccountSettings onAvatarChange={onAvatarChange} />

      {!isLoading && residency ? (
        <View style={styles.detailsCard}>
          <Text style={styles.detailsTitle}>Resident record</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Resident ID</Text>
            <Text style={styles.detailValue}>{residency.resident_id}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Verified</Text>
            <Text style={styles.detailValue}>{formatVerifiedDate(residency.verified_at)}</Text>
          </View>
        </View>
      ) : null}

      {isLoading ? <SkeletonCard rows={2} /> : null}

      {!isLoading && error && residency === null ? (
        <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
      ) : null}

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
        onPress={confirmLogOut}
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

    </View>
  );
}

function formatVerifiedDate(value: string | null): string {
  if (!value) return 'Not verified';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Verified';
  return date.toLocaleDateString();
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

  recordText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#A63E37',
  },

  activeDot: {
    backgroundColor: '#4D8A5B',
  },

  statusText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },

  detailsCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 14,
  },

  detailsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.navy,
  },

  detailRow: {
    gap: 4,
  },

  detailLabel: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
  },

  detailValue: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.navy,
  },

  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#A63E37',
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
