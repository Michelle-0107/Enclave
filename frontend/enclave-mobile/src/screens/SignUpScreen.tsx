import { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { registrationApi, type ApiError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { saveAccessToken } from '../lib/session';
import { colors } from '../theme';

type Props = { onBack: () => void; onSignInPress: () => void; onRegistered: () => void };

function createIdempotencyKey(): string {
  return `signup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function SignUpScreen({ onBack, onSignInPress, onRegistered }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [residentCode, setResidentCode] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  async function requestCode() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid registered email.');
      return;
    }
    Keyboard.dismiss();
    setError('');
    setIsRequestingCode(true);
    try {
      const result = await registrationApi.requestOtp({ email: normalizedEmail });
      setChallengeId(result.challenge_id);
      setIdempotencyKey('');
      setResidentCode('');
      setSeconds(60);
    } catch (requestError) {
      setError((requestError as ApiError).message || 'Unable to request a code.');
    } finally {
      setIsRequestingCode(false);
    }
  }

  async function createAccount() {
    if (!challengeId) {
      setError('Please request a verification code first.');
      return;
    }
    if (!/^[0-9]{6}$/.test(residentCode.trim())) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    Keyboard.dismiss();
    setError('');
    setIsCreatingAccount(true);
    try {
      const requestKey = idempotencyKey || createIdempotencyKey();
      setIdempotencyKey(requestKey);
      const result = await registrationApi.verifyAndSignup({ challenge_id: challengeId, otp: residentCode.trim(), password }, requestKey);
      await supabase.auth.setSession({ access_token: result.session.access_token, refresh_token: result.session.refresh_token });
      await saveAccessToken(result.session.access_token);
      onRegistered();
    } catch (requestError) {
      setError((requestError as ApiError).message || 'Unable to create your account.');
    } finally {
      setIsCreatingAccount(false);
    }
  }

  const requestLabel = seconds > 0
    ? `Resend in ${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
    : challengeId ? 'Resend code' : 'Request code';

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={12}>
              <Ionicons name="chevron-back" size={24} color={colors.navy} />
            </Pressable>
            <Text style={styles.brand}>ENCLAVE</Text>
          </View>
          <View style={styles.introduction}>
            <Text style={styles.title}>Join your Enclave.</Text>
            <Text style={styles.subtitle}>Create your verified resident account.</Text>
          </View>
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Full name</Text>
              <TextInput value={name} onChangeText={(value) => { setName(value); setError(''); }} accessibilityLabel="Full name" placeholder="Enter your full name" placeholderTextColor={colors.muted} autoComplete="name" autoCapitalize="words" style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Registered email</Text>
              <TextInput value={email} onChangeText={(value) => { setEmail(value); setChallengeId(''); setIdempotencyKey(''); setSeconds(0); setError(''); }} accessibilityLabel="Registered email" placeholder="Enter your registered email." placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordField}>
                <TextInput value={password} onChangeText={(value) => { setPassword(value); setError(''); }} accessibilityLabel="Password" placeholder="Create a password" placeholderTextColor={colors.muted} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" style={styles.passwordInput} />
                <Pressable onPress={() => setShowPassword((value) => !value)} accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} style={styles.eyeButton}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
                </Pressable>
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Resident code</Text>
              <TextInput value={residentCode} onChangeText={(value) => { setResidentCode(value.replace(/\D/g, '').slice(0, 6)); setError(''); }} accessibilityLabel="Resident code" placeholder="Enter your resident code" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={6} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              <Pressable onPress={requestCode} disabled={seconds > 0 || isRequestingCode} accessibilityRole="button" accessibilityState={{ disabled: seconds > 0 || isRequestingCode }} style={styles.requestButton}>
                <Text style={[styles.requestText, (seconds > 0 || isRequestingCode) && styles.mutedText]}>{isRequestingCode ? 'Requesting…' : requestLabel}</Text>
              </Pressable>
            </View>
            <Text style={styles.helper}>{challengeId ? 'Code sent to your registered email. Valid for 5 minutes.' : 'A resident code will be sent to your registered email.'}</Text>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable onPress={createAccount} disabled={isCreatingAccount} accessibilityRole="button" accessibilityState={{ disabled: isCreatingAccount }} style={({ pressed }) => [styles.button, pressed && styles.pressed, isCreatingAccount && styles.disabled]}>
              <Text style={styles.buttonText}>{isCreatingAccount ? 'Creating account…' : 'Create account'}</Text>
            </Pressable>
            <Pressable onPress={onSignInPress} accessibilityRole="button" style={styles.signInLink}>
              <Text style={styles.subtitle}>Already have an account? <Text style={styles.bold}>Sign in</Text></Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 20 }, brand: { fontSize: 21, fontWeight: '700', letterSpacing: 5, color: colors.brand },
  introduction: { marginTop: 32, gap: 10 }, title: { fontSize: 30, lineHeight: 38, fontWeight: '700', color: colors.navy }, subtitle: { fontSize: 14, lineHeight: 22, color: colors.muted },
  form: { marginTop: 28, gap: 18 }, field: { gap: 10 }, label: { fontSize: 14, fontWeight: '600', color: colors.navy },
  input: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, color: colors.navy, fontSize: 14 },
  passwordField: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: 'hidden' }, passwordInput: { flex: 1, minHeight: 54, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, color: colors.navy }, eyeButton: { width: 48, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  requestButton: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, requestText: { fontSize: 12, fontWeight: '600', color: colors.navy }, mutedText: { color: colors.muted }, helper: { fontSize: 12, lineHeight: 19, color: colors.muted }, error: { fontSize: 12, lineHeight: 19, color: '#A63E37' },
  button: { minHeight: 54, borderRadius: 16, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontSize: 15, fontWeight: '600', color: colors.white }, signInLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, bold: { fontWeight: '600', color: colors.navy }, pressed: { opacity: 0.8 }, disabled: { opacity: 0.6 },
});
