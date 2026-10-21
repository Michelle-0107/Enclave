import { useState } from 'react';
import {
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { saveAccessToken } from '../lib/session';
import { colors } from '../theme';

type Props = {
  onDemoSignIn: () => void;
  onSignUpPress: () => void;
  onForgotPasswordPress: () => void;
  onBack: () => void;
};

export default function SignInScreen({
  onDemoSignIn,
  onSignUpPress,
  onForgotPasswordPress,
  onBack,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignIn() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }

    Keyboard.dismiss();
    setError('');
    setIsLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        const message = authError.message.toLowerCase();
        if (message.includes('email not confirmed')) {
          setError('Your account is not active yet. Please confirm your email first.');
        } else if (message.includes('invalid login credentials')) {
          setError('The email or password is incorrect.');
        } else {
          setError(authError.message);
        }
        return;
      }

      if (!data.session?.access_token) {
        setError('Your account is not active yet. Please confirm your email first.');
        return;
      }

      await saveAccessToken(data.session.access_token);
      onDemoSignIn();
    } catch {
      setError('Unable to sign in right now. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to welcome"
              onPress={onBack}
              style={styles.backButton}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={colors.navy}
              />
            </Pressable>

            <Text style={styles.brand}>ENCLAVE</Text>
          </View>

          <View style={styles.heading}>
            <Text style={styles.title}>Welcome back.</Text>

            <Text style={styles.subtitle}>
              Sign in to your community.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>

              <TextInput
                accessibilityLabel="Email"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setError('');
                }}
                placeholder="Enter your email"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>

              <View style={styles.passwordField}>
                <TextInput
                  accessibilityLabel="Password"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setError('');
                  }}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={handleSignIn}
                  style={styles.passwordInput}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword ? 'Hide password' : 'Show password'
                  }
                  onPress={() => setShowPassword((value) => !value)}
                  style={styles.eyeButton}
                >
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={22}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onForgotPasswordPress}
              style={styles.forgotButton}
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>

            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={handleSignIn}
              style={({ pressed }) => [
                styles.signInButton,
                pressed && styles.pressed,
                isLoading && styles.disabled,
              ]}
              disabled={isLoading}
            >
              <Text style={styles.signInText}>{isLoading ? 'Signing in…' : 'Sign in'}</Text>
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onSignUpPress}
            style={styles.createAccountButton}
          >
            <Text style={styles.createAccountText}>
              Don’t have an account?{' '}
              <Text style={styles.link}>Create account</Text>
            </Text>
          </Pressable>

          <Text style={styles.demoText}>Use your Enclave account email and password to continue.</Text>
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
    paddingTop: 16,
    paddingBottom: 32,
    gap: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 32,
    minHeight: 44,
    justifyContent: 'center',
  },
  brand: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 26,
    letterSpacing: 4,
    color: colors.brand,
  },
  heading: {
    gap: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 42,
    color: colors.navy,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.muted,
  },
  form: {
    gap: 24,
  },
  field: {
    gap: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.white,
    fontSize: 14,
    color: colors.navy,
  },
  passwordField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    paddingLeft: 16,
    paddingRight: 6,
  },
  passwordInput: {
    flex: 1,
    minHeight: 54,
    paddingVertical: 14,
    fontSize: 14,
    color: colors.navy,
  },
  eyeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forgotButton: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
  },
  link: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 22,
    color: colors.navy,
  },
  error: {
    fontSize: 12,
    lineHeight: 19,
    color: '#A63E37',
  },
  signInButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  signInText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
  createAccountButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  createAccountText: {
    fontSize: 13,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
  },
  demoText: {
    fontSize: 11,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.6,
  },
});
