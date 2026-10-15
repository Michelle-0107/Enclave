import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';

type Props = {
  onBack: () => void;
  onSignInPress: () => void;
  onRegistered: () => void;
};

export default function SignUpScreen({
  onBack,
  onSignInPress,
  onRegistered,
}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [codeRequested, setCodeRequested] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (seconds <= 0) return;

    const timer = setTimeout(() => {
      setSeconds((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [seconds]);

  function changeEmail(value: string) {
    setEmail(value);
    setCode('');
    setCodeRequested(false);
    setSeconds(0);
    setError('');
  }

  function requestCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid registered email.');
      return;
    }

    // UI demo only. No email is sent.
    setError('');
    setCode('');
    setCodeRequested(true);
    setSeconds(60);
  }

  function createAccount() {
    if (!name.trim() || !email.trim() || !password || !code.trim()) {
      setError('Please complete all fields.');
      return;
    }

    if (!codeRequested) {
      setError('Please request your resident code first.');
      return;
    }

    // UI demo only. The backend will validate the real code.
    if (code.trim() !== '123456') {
      setError('Incorrect code. Please try again.');
      return;
    }

    setError('');
    onRegistered();
  }

  const requestLabel =
    seconds > 0
      ? `Resend in ${Math.floor(seconds / 60)
          .toString()
          .padStart(2, '0')}:${(seconds % 60)
          .toString()
          .padStart(2, '0')}`
      : codeRequested
        ? 'Resend code'
        : 'Request code';

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={12}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={colors.navy}
              />
            </Pressable>

            <Text style={styles.brand}>ENCLAVE</Text>
          </View>

          <View style={styles.introduction}>
            <Text style={styles.title}>Join your Enclave.</Text>

            <Text style={styles.subtitle}>
              Create your verified resident account.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Full name</Text>

              <TextInput
                value={name}
                onChangeText={setName}
                accessibilityLabel="Full name"
                placeholder="Enter your full name"
                placeholderTextColor={colors.muted}
                autoComplete="name"
                autoCapitalize="words"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Registered email</Text>

              <TextInput
                value={email}
                onChangeText={changeEmail}
                accessibilityLabel="Registered email"
                placeholder="Enter your registered email."
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>

              <View style={styles.passwordField}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  accessibilityLabel="Password"
                  placeholder="Create a password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  style={styles.passwordInput}
                />

                <Pressable
                  onPress={() => setShowPassword((value) => !value)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword ? 'Hide password' : 'Show password'
                  }
                  style={styles.eyeButton}
                >
                  <Ionicons
                    name={
                      showPassword ? 'eye-off-outline' : 'eye-outline'
                    }
                    size={20}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Resident code</Text>

              <TextInput
                value={code}
                onChangeText={(value) => {
                  setCode(value);
                  setError('');
                }}
                accessibilityLabel="Resident code"
                placeholder="Enter your resident code"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />

              <Pressable
                onPress={requestCode}
                disabled={seconds > 0}
                accessibilityRole="button"
                accessibilityState={{ disabled: seconds > 0 }}
                style={styles.requestButton}
              >
                <Text
                  style={[
                    styles.requestText,
                    seconds > 0 && styles.mutedText,
                  ]}
                >
                  {requestLabel}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.helper}>
              {codeRequested
                ? 'Demo code: 123456. No email has been sent.'
                : 'Register your email with Management before requesting a code.'}
            </Text>

            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}

            <Pressable
              onPress={createAccount}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonText}>Create account</Text>
            </Pressable>

            <Text style={styles.footerNote}>
              One account per verified resident. Your code expires
              after 24 hours.
            </Text>

            <Pressable
              onPress={onSignInPress}
              accessibilityRole="button"
              style={styles.signInLink}
            >
              <Text style={styles.subtitle}>
                Already have an account?{' '}
                <Text style={styles.bold}>Sign in</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  brand: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 5,
    color: colors.navy,
  },
  introduction: {
    marginTop: 32,
    gap: 10,
  },
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
  form: {
    marginTop: 28,
    gap: 18,
  },
  field: { gap: 10 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  input: {
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    color: colors.navy,
    fontSize: 14,
  },
  passwordField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  passwordInput: {
    flex: 1,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: colors.navy,
  },
  eyeButton: {
    width: 48,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestButton: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  requestText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.navy,
  },
  mutedText: { color: colors.muted },
  helper: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
  error: {
    fontSize: 12,
    lineHeight: 19,
    color: '#A63E37',
  },
  button: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
  footerNote: {
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.muted,
  },
  signInLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bold: {
    fontWeight: '600',
    color: colors.navy,
  },
  pressed: { opacity: 0.8 },
});