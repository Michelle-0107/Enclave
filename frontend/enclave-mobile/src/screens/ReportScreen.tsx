import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

export default function ReportScreen() {
  const [description, setDescription] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Report an issue.</Text>

      <Text style={styles.subtitle}>
        Help us take care of your neighbourhood.
      </Text>

      <Text style={styles.step}>STEP 01 / 03</Text>
      <Text style={styles.sectionTitle}>What did you notice?</Text>

      <View style={styles.photoArea}>
        <Ionicons
          name="camera-outline"
          size={36}
          color={colors.navy}
        />

        <Text style={styles.photoTitle}>Add a photo</Text>

        <Text style={styles.photoHint}>
          Camera and photo selection will be connected next.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Tell us what happened..."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          style={styles.description}
          maxLength={500}
        />

        <Text style={styles.counter}>
          {description.length}/500
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        disabled
        style={styles.disabledButton}
      >
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>

      <Text style={styles.hint}>
        Continue will be enabled when photo selection is connected.
      </Text>
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
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
  step: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.muted,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  photoArea: {
    minHeight: 220,
    borderRadius: 24,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  photoTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.navy,
  },
  photoHint: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    color: colors.muted,
  },
  field: { gap: 10 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  description: {
    minHeight: 130,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    fontSize: 14,
    lineHeight: 22,
    color: colors.navy,
  },
  counter: {
    fontSize: 11,
    textAlign: 'right',
    color: colors.muted,
  },
  disabledButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.navy,
    opacity: 0.45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.muted,
  },
});