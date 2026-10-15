import { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';

import { colors } from '../theme';
import type { ReportLocationDetails } from './ReportLocationScreen';

export type ReportReviewData = {
  category: string;
  priority: string;
};

type Props = {
  photo: ImagePickerAsset;
  details: ReportLocationDetails;
  initialReview?: ReportReviewData;
  onBack: () => void;
  onSubmit: (review: ReportReviewData) => void;
};

const categories = [
  'Accessibility',
  'Streetlight',
  'Water accumulation',
  'Facility',
  'Other',
];

const priorities = ['Low', 'Medium', 'High'];

export default function ReportReviewScreen({
  photo,
  details,
  initialReview,
  onBack,
  onSubmit,
}: Props) {
  const [category, setCategory] = useState(
    initialReview?.category ?? 'Accessibility',
  );

  const [priority, setPriority] = useState(
    initialReview?.priority ?? 'High',
  );

  const [openField, setOpenField] = useState<
    'category' | 'priority' | null
  >(null);

  const options =
    openField === 'category' ? categories : priorities;

  const selectedValue =
    openField === 'category' ? category : priority;

  function selectOption(value: string) {
    if (openField === 'category') {
      setCategory(value);
    } else if (openField === 'priority') {
      setPriority(value);
    }

    setOpenField(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.stepHeader}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          hitSlop={12}
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={colors.navy}
          />

          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Text style={styles.stepText}>
          STEP 03 OF 03
        </Text>
      </View>

      <View style={styles.heading}>
        <Text style={styles.title}>
          Review your report.
        </Text>

        <Text style={styles.subtitle}>
          Check the details before sending to management.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.eyebrow}>
          REPORT DETAILS
        </Text>

        <Text style={styles.location}>
          {details.location}
        </Text>

        <Text style={styles.subtitle}>
          {details.description}
        </Text>

        <Image
          source={{ uri: photo.uri }}
          style={styles.photo}
          accessibilityLabel="Photo of the reported issue"
        />
      </View>

      <View style={styles.aiNote}>
        <Text style={styles.aiTitle}>
          AI suggestions · review required
        </Text>

        <Text style={styles.noteText}>
          You can edit these suggestions. Management makes
          the final assessment.
        </Text>

        <Text style={styles.demoText}>
          Demo suggestions — AI is not connected yet.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Category</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Category: ${category}. Change category`}
          onPress={() => setOpenField('category')}
          style={styles.select}
        >
          <Text style={styles.selectText}>
            {category}
          </Text>

          <Ionicons
            name="chevron-down"
            size={18}
            color={colors.muted}
          />
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>
          Suggested priority
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Priority: ${priority}. Change priority`}
          onPress={() => setOpenField('priority')}
          style={styles.select}
        >
          <Text style={styles.selectText}>
            {priority}
          </Text>

          <Ionicons
            name="chevron-down"
            size={18}
            color={colors.muted}
          />
        </Pressable>
      </View>

      <Text style={styles.noteText}>
        If AI is unavailable, complete these details manually.
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => onSubmit({ category, priority })}
        style={({ pressed }) => [
          styles.submitButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.submitText}>
          Submit report
        </Text>
      </Pressable>

      <Modal
        visible={openField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenField(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close selection"
            onPress={() => setOpenField(null)}
            style={styles.modalBackdrop}
          />

          <View
            accessibilityViewIsModal
            style={styles.modalCard}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {openField === 'category'
                  ? 'Choose category'
                  : 'Choose priority'}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={12}
                onPress={() => setOpenField(null)}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={colors.navy}
                />
              </Pressable>
            </View>

            {options.map((option) => {
              const selected = option === selectedValue;

              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selected,
                  }}
                  onPress={() => selectOption(option)}
                  style={styles.option}
                >
                  <Text style={styles.selectText}>
                    {option}
                  </Text>

                  <Ionicons
                    name={
                      selected
                        ? 'radio-button-on'
                        : 'radio-button-off'
                    }
                    size={22}
                    color={
                      selected
                        ? colors.navy
                        : colors.muted
                    }
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },

  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
  },

  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },

  stepText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.muted,
  },

  heading: {
    gap: 10,
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

  summaryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },

  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    letterSpacing: 1,
    color: colors.muted,
  },

  location: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    color: colors.navy,
  },

  photo: {
    width: '100%',
    height: 150,
    borderRadius: 12,
    resizeMode: 'cover',
    marginTop: 4,
  },

  aiNote: {
    backgroundColor: colors.lavender,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },

  aiTitle: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    color: colors.navy,
  },

  noteText: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },

  demoText: {
    fontSize: 11,
    lineHeight: 18,
    color: colors.muted,
  },

  field: {
    gap: 8,
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  select: {
    minHeight: 54,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  selectText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    color: colors.navy,
  },

  submitButton: {
    minHeight: 54,
    backgroundColor: colors.navy,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  submitText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },

  pressed: {
    opacity: 0.8,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    padding: 24,
  },

  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },

  modalCard: {
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 20,
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 12,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.navy,
  },

  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});