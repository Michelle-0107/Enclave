import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';

type Props = {
  onGoHome: () => void;
};

export default function SignUpSuccessScreen({
  onGoHome,
}: Props) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>ENCLAVE</Text>

        <View style={styles.introduction}>
          <View style={styles.iconCircle}>
            <Ionicons
              name="mail-outline"
              size={32}
              color={colors.navy}
            />
          </View>

          <Text style={styles.title}>
            Account created{'\n'}successfully.
          </Text>

          <Text style={styles.subtitle}>
            Your email is verified and your resident account
            is ready.
          </Text>
        </View>

        <View style={styles.details}>
          <Text style={styles.body}>
            Your account is linked to your resident record.
          </Text>

          <Text style={styles.body}>
            Your registration code has been used and is no
            longer valid.
          </Text>

          <Text style={styles.body}>
            You're ready to explore your Enclave.
          </Text>
        </View>

        <View style={styles.status}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Account active</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={onGoHome}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonText}>Go to home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 28,
  },
  brand: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 5,
    color: colors.navy,
  },
  introduction: {
    marginTop: 36,
    gap: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    color: colors.navy,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 23,
    color: colors.muted,
  },
  details: {
    gap: 18,
  },
  body: {
    fontSize: 14,
    lineHeight: 23,
    color: colors.navy,
  },
  status: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#E6F3EA',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2D7050',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D7050',
  },
  button: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
  pressed: {
    opacity: 0.8,
  },
});