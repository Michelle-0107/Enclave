import { useState } from 'react';
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
  onDemoSignIn: () => void;
  onSignUpPress: () => void;
};

export default function SignInScreen({ onDemoSignIn, onSignUpPress, }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  function handleSignIn() {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setError('');
    onDemoSignIn();
  }

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
          <Text style={styles.brand}>ENCLAVE</Text>

          <View style={styles.introduction}>
            <Text style={styles.title}>Welcome back.</Text>
            <Text style={styles.subtitle}>
              Sign in to your resident account.
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
                placeholder="Enter your registered email"
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
                    name={
                      showPassword ? 'eye-off-outline' : 'eye-outline'
                    }
                    size={20}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
            </View>

            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={handleSignIn}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonText}>Sign in</Text>
            </Pressable>

            <Text style={styles.demoNote}>
              UI preview only. Enter any email and password to
              preview the resident home.
            </Text>
            <Pressable
                onPress={onSignUpPress}
                accessibilityRole="button"
                style={{
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
  <Text style={styles.subtitle}>
    Don’t have an account?{' '}
    <Text style={{ color: colors.navy, fontWeight: '600' }}>
      Create account
    </Text>
  </Text>
</Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  brand: {
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 5,
    color: colors.navy,
  },
  introduction: {
    marginTop: 64,
    gap: 12,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    color: colors.navy,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
  form: {
    marginTop: 36,
    gap: 24,
  },
  field: {
    gap: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  input: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: colors.navy,
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
  pressed: {
    opacity: 0.8,
  },
  demoNote: {
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.muted,
  },
});