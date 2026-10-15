import { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';

type Props = {
  onBack: () => void;

  // Backend integration:
  // Pass an async function that requests a reset email.
  onRequestReset?: (email: string) => Promise<void>;
};

export default function ForgotPasswordScreen({
  onBack,
  onRequestReset,
}: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSendResetLink() {
    if (sending) {
      return;
    }

    const trimmedEmail = email.trim();

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    ) {
      setError('Please enter a valid email address.');
      return;
    }

    Keyboard.dismiss();
    setError('');
    setSending(true);

    try {
      if (onRequestReset) {
        await onRequestReset(trimmedEmail);
      }

      setSubmitted(true);
    } catch {
      setError(
        'Unable to request a reset link. Please try again.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={
          Platform.OS === 'ios' ? 'padding' : undefined
        }
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {submitted ? (
            <View style={styles.page}>
              <Text style={styles.brand}>
                ENCLAVE
              </Text>

              <Text style={styles.title}>
                Check your email.
              </Text>

              <Text style={styles.confirmationText}>
                If an account exists for that email,
                you’ll receive a password reset link.
              </Text>

              <Text style={styles.subtitle}>
                Open the email, choose a new password,
                then return to Enclave to sign in.
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.buttonText}>
                  Back to sign in
                </Text>
              </Pressable>

              {!onRequestReset && (
                <Text style={styles.helper}>
                  Demo only · No email has been sent.
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.page}>
              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                disabled={sending}
                hitSlop={8}
                style={styles.backButton}
              >
                <Text style={styles.backText}>
                  ‹ Sign in
                </Text>
              </Pressable>

              <View style={styles.heading}>
                <Text style={styles.title}>
                  Forgot password?
                </Text>

                <Text style={styles.subtitle}>
                  Enter your account email. We’ll send
                  a link to reset your password.
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>
                  Email
                </Text>

                <TextInput
                  accessibilityLabel="Account email"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError('');
                  }}
                  editable={!sending}
                  placeholder="Enter your account email"
                  placeholderTextColor={colors.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    void handleSendResetLink();
                  }}
                  style={[
                    styles.input,
                    error ? styles.inputError : undefined,
                  ]}
                />

                {error ? (
                  <Text
                    accessibilityRole="alert"
                    style={styles.errorText}
                  >
                    {error}
                  </Text>
                ) : null}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: sending,
                  busy: sending,
                }}
                disabled={sending}
                onPress={() => {
                  void handleSendResetLink();
                }}
                style={({ pressed }) => [
                  styles.button,
                  sending && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {sending ? (
                  <ActivityIndicator
                    color={colors.white}
                  />
                ) : (
                  <Text style={styles.buttonText}>
                    Send reset link
                  </Text>
                )}
              </Pressable>

              <Text style={styles.helper}>
                Reset your existing account instead of
                registering again.
              </Text>

              {!onRequestReset && (
                <Text style={styles.helper}>
                  UI preview · Email delivery is not
                  connected yet.
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  keyboardView: {
    flex: 1,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },

  page: {
    gap: 28,
  },

  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },

  backText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  brand: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 26,
    color: colors.navy,
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

  confirmationText: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.muted,
  },

  field: {
    gap: 10,
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },

  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: colors.navy,
  },

  inputError: {
    borderColor: '#A63E37',
  },

  errorText: {
    fontSize: 12,
    lineHeight: 19,
    color: '#A63E37',
  },

  button: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.navy,
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.white,
    textAlign: 'center',
  },

  helper: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },

  disabled: {
    opacity: 0.6,
  },

  pressed: {
    opacity: 0.8,
  },
});