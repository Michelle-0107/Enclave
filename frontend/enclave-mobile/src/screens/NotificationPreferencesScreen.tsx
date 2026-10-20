import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../theme';

export type NotificationPreferences = {
  reportProgress: boolean;
  informationRequests: boolean;
  followedAreaUpdates: boolean;
};

export const defaultNotificationPreferences:
  NotificationPreferences = {
    reportProgress: true,
    informationRequests: true,
    followedAreaUpdates: true,
  };

type Props = {
  preferences: NotificationPreferences;
  onChange: (
    preferences: NotificationPreferences,
  ) => void;
  onBack: () => void;
};

const settings: {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
}[] = [
  {
    key: 'reportProgress',
    title: 'Report progress',
    description: 'Updates on the issues you submit.',
  },
  {
    key: 'informationRequests',
    title: 'Requests for information',
    description:
      'When management needs more details.',
  },
  {
    key: 'followedAreaUpdates',
    title: 'Followed-area updates',
    description:
      'Reviewed issues in your selected areas.',
  },
];

export default function NotificationPreferencesScreen({
  preferences,
  onChange,
  onBack,
}: Props) {
  function toggleSetting(
    key: keyof NotificationPreferences,
  ) {
    onChange({
      ...preferences,
      [key]: !preferences[key],
    });
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        hitSlop={8}
        style={styles.backButton}
      >
        <Text style={styles.backText}>
          ‹ My Account
        </Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={styles.title}>
          Notifications.
        </Text>

        <Text style={styles.subtitle}>
          Choose the updates that matter to you.
        </Text>
      </View>

      <View>
        <Text style={styles.eyebrow}>
          IN-APP NOTIFICATIONS
        </Text>

        {settings.map((setting) => {
          const enabled = preferences[setting.key];

          return (
            <View
              key={setting.key}
              style={styles.settingRow}
            >
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>
                  {setting.title}
                </Text>

                <Text style={styles.settingDescription}>
                  {setting.description}
                </Text>
              </View>

              <Pressable
                accessibilityRole="switch"
                accessibilityLabel={setting.title}
                accessibilityState={{
                  checked: enabled,
                }}
                onPress={() =>
                  toggleSetting(setting.key)
                }
                style={({ pressed }) => [
                  styles.switchTouchTarget,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.switchTrack,
                    enabled && styles.switchTrackOn,
                  ]}
                >
                  <View
                    style={[
                      styles.switchThumb,
                      enabled && styles.switchThumbOn,
                    ]}
                  />
                </View>
              </Pressable>
            </View>
          );
        })}

        <View style={styles.deliveryInfo}>
          <Text style={styles.deliveryTitle}>
            Notifications appear inside Enclave.
          </Text>

          <Text style={styles.settingDescription}>
            Phone push notifications are not included
            in this version.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },

  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },

  backText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 24,
    color: colors.navy,
  },

  heading: {
    gap: 8,
  },

  title: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 38,
    color: colors.navy,
  },

  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },

  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    color: colors.muted,
  },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  settingText: {
    flex: 1,
    gap: 6,
  },

  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  settingDescription: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },

  switchTouchTarget: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#C7CBD2',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },

  switchTrackOn: {
    backgroundColor: colors.brand,
  },

  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
  },

  switchThumbOn: {
    alignSelf: 'flex-end',
  },

  deliveryInfo: {
    paddingTop: 24,
    gap: 8,
  },

  deliveryTitle: {
    fontSize: 13,
    lineHeight: 22,
    color: colors.muted,
  },

  pressed: {
    opacity: 0.75,
  },
});