import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../theme';

type Props = {
  onBack: () => void;
};

const questions = [
  {
    question: 'How do I report an issue?',
    answer:
      'Open Report, add a photo, confirm the location and description, then review and submit.',
  },
  {
    question: 'What happens after submission?',
    answer:
      'Management reviews your report. You can follow its progress in My reports.',
  },
  {
    question: 'Can I change an AI suggestion?',
    answer:
      'Yes. Check the suggested category and priority before you submit.',
  },
  {
    question: 'When is a report resolved?',
    answer:
      'After maintenance is completed and management verifies the repair.',
  },
];

export default function HelpScreen({
  onBack,
}: Props) {
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
          How can we help?
        </Text>

        <Text style={styles.subtitle}>
          A quick guide to using Enclave.
        </Text>
      </View>

      <View>
        {questions.map((item) => (
          <View
            key={item.question}
            style={styles.questionRow}
          >
            <Text style={styles.question}>
              {item.question}
            </Text>

            <Text style={styles.answer}>
              {item.answer}
            </Text>
          </View>
        ))}
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

  questionRow: {
    paddingVertical: 18,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  question: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  answer: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
});