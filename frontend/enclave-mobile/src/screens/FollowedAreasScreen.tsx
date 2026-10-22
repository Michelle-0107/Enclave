import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme';

export type FollowedAreaId =
  | 'park-entrance'
  | 'lake-walk'
  | 'community-garden'
  | 'main-entrance';

export const defaultFollowedAreas: FollowedAreaId[] = [
  'park-entrance',
  'lake-walk',
];

const areas: {
  id: FollowedAreaId;
  name: string;
  description: string;
}[] = [
  {
    id: 'park-entrance',
    name: 'Park Entrance',
    description: 'Walkway and nearby facilities',
  },
  {
    id: 'lake-walk',
    name: 'Lake Walk',
    description: 'Paths around the community lake',
  },
  {
    id: 'community-garden',
    name: 'Community Garden',
    description: 'Garden and shared facilities',
  },
  {
    id: 'main-entrance',
    name: 'Main Entrance',
    description: 'Entry roads and public access',
  },
];

type Props = {
  followedAreas: FollowedAreaId[];
  onSave: (areas: FollowedAreaId[]) => void;
  onBack: () => void;
};

export default function FollowedAreasScreen({
  followedAreas,
  onSave,
  onBack,
}: Props) {
  const [selectedAreas, setSelectedAreas] =
    useState<FollowedAreaId[]>([...followedAreas]);

  function toggleArea(id: FollowedAreaId) {
    setSelectedAreas((current) =>
      current.includes(id)
        ? current.filter((areaId) => areaId !== id)
        : [...current, id],
    );
  }

  function handleSave() {
    onSave([...selectedAreas]);

    Alert.alert(
      'Followed areas saved',
      'Your followed area preferences have been saved locally.',
    );
  }

  function handleBack() {
    const hasChanges =
      selectedAreas.length !== followedAreas.length ||
      selectedAreas.some(
        (id) => !followedAreas.includes(id),
      );

    if (!hasChanges) {
      onBack();
      return;
    }

    Alert.alert(
      'Unsaved changes',
      'Leave without saving your followed areas?',
      [
        {
          text: 'Keep editing',
          style: 'cancel',
        },
        {
          text: 'Discard changes',
          style: 'destructive',
          onPress: onBack,
        },
      ],
      { cancelable: false },
    );
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={handleBack}
        hitSlop={8}
        style={styles.backButton}
      >
        <Text style={styles.backText}>
          ‹ My Account
        </Text>
      </Pressable>

      <Text style={styles.title}>
        Followed areas.
      </Text>

      <Text style={styles.subtitle}>
        Choose where you want community updates.
      </Text>

      <View style={styles.areaList}>
        {areas.map((area) => {
          const selected = selectedAreas.includes(
            area.id,
          );

          return (
            <Pressable
              key={area.id}
              accessibilityRole="checkbox"
              accessibilityLabel={area.name}
              accessibilityHint={area.description}
              accessibilityState={{
                checked: selected,
              }}
              onPress={() => toggleArea(area.id)}
              style={({ pressed }) => [
                styles.areaRow,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.areaInfo}>
                <Text style={styles.areaName}>
                  {area.name}
                </Text>

                <Text style={styles.areaDescription}>
                  {area.description}
                </Text>
              </View>

              <View style={styles.checkboxContainer}>
                <View
                  style={[
                    styles.checkbox,
                    selected &&
                      styles.checkboxSelected,
                  ]}
                >
                  {selected && (
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color={colors.white}
                    />
                  )}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={handleSave}
        style={({ pressed }) => [
          styles.saveButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.saveButtonText}>
          Save followed areas
        </Text>
      </Pressable>

      <Text style={styles.helperText}>
        Only reviewed issues and repair updates.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },

  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },

  backText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    color: colors.navy,
  },

  title: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 40,
    color: colors.navy,
  },

  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },

  areaList: {
    gap: 12,
    marginTop: 8,
  },

  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 90,
    padding: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
  },

  areaInfo: {
    flex: 1,
    gap: 4,
  },

  areaName: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
    color: colors.navy,
  },

  areaDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },

  checkboxContainer: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkboxSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.navy,
  },

  saveButton: {
    minHeight: 50,
    backgroundColor: colors.brand,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    color: colors.white,
    textAlign: 'center',
  },

  helperText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },

  pressed: {
    opacity: 0.75,
  },
});
