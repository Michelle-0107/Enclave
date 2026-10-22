import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { accountPhotoApi, ApiError } from '../lib/api';
import { colors } from '../theme';
function PasswordField({ label, value, onChange, disabled, current = false }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; current?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={styles.inputRow}><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete={current ? 'current-password' : 'new-password'} style={styles.input} /><Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} accessibilityState={{ checked: visible }} onPress={() => setVisible(!visible)} style={styles.eye}><Ionicons name={visible ? 'eye-outline' : 'eye-off-outline'} size={22} color={colors.muted} /></Pressable></View></View>;
}
export default function AccountSettings({ onAvatarChange }: { onAvatarChange: (url: string) => void }) {
  const [panel, setPanel] = useState<'password' | 'photo' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const profile = await accountPhotoApi.get(data.session.access_token);
      if (live && profile.avatar_url?.startsWith('https://')) onAvatarChange(profile.avatar_url);
    })().catch(() => { /* Optional until photo storage is connected. */ });
    return () => { live = false; };
  }, [onAvatarChange]);
  function close() { if (busy) return; setPanel(null); setCurrent(''); setNext(''); setConfirm(''); setPhoto(null); setError(''); }
  async function choosePhoto() {
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled) return;
      const file = result.assets[0];
      if ((file.fileSize ?? 0) > 5 * 1024 * 1024 || (file.mimeType && !['image/jpeg', 'image/png'].includes(file.mimeType))) { setError('Choose a JPG or PNG photo smaller than 5 MB.'); return; }
      setPhoto(file);
    } catch { setError('Unable to open your photos. Please try again.'); }
  }
  async function save() {
    if (busy) return; setError(''); setBusy(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error('Please sign in again.');
      if (panel === 'password') {
        if (!current) throw new Error('Enter your current password.');
        if (next.length < 8) throw new Error('Use at least 8 characters.');
        if (next !== confirm) throw new Error('The new passwords do not match.');
        if (next === current) throw new Error('Choose a different password.');
        if (!data.session.user.email) throw new Error('Please sign in again.');
        const { error: authError } = await supabase.auth.signInWithPassword({ email: data.session.user.email, password: current });
        if (authError) throw new Error('Your current password could not be verified. Please try again.');
        const { error: updateError } = await supabase.auth.updateUser({ password: next, current_password: current });
        if (updateError) throw updateError;
        setSuccess('Your password has been changed.');
      } else {
        if (!photo) throw new Error('Choose a photo first.');
        const body = new FormData();
        if (Platform.OS === 'web') {
          const response = await fetch(photo.uri); const blob = await response.blob(); body.append('photo', blob, photo.fileName || 'avatar.jpg');
        } else {
          body.append('photo', { uri: photo.uri, name: photo.fileName || 'avatar.jpg', type: photo.mimeType || 'image/jpeg' } as unknown as Blob);
        }
        const result = await accountPhotoApi.upload(data.session.access_token, body);
        if (!result.avatar_url?.startsWith('https://')) throw new Error('The server did not return a valid photo URL.');
        onAvatarChange(result.avatar_url); setSuccess('Your profile photo has been updated.');
      }
      setPanel(null); setPhoto(null); setCurrent(''); setNext(''); setConfirm('');
    } catch (reason) {
      setError(reason instanceof ApiError && [404, 405, 501].includes(reason.status) ? 'Photo upload is not available yet. Please try again later.' : reason instanceof Error ? reason.message : 'Unable to save. Please try again.');
    } finally { setBusy(false); }
  }
  return <View style={styles.field}>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" style={styles.outline} onPress={() => { setSuccess(''); setPanel('photo'); }}><Ionicons name="camera-outline" size={20} color={colors.brand} /><Text style={styles.actionText}>Change photo</Text></Pressable>
      <Pressable accessibilityRole="button" style={styles.outline} onPress={() => { setSuccess(''); setPanel('password'); }}><Ionicons name="key-outline" size={20} color={colors.brand} /><Text style={styles.actionText}>Change password</Text></Pressable>
    </View>
    {!!success && <Text accessibilityLiveRegion="polite" style={styles.success}>{success}</Text>}
    <Modal visible={panel !== null} transparent animationType="fade" onRequestClose={() => undefined}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.dialog} accessibilityViewIsModal><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
          <Text accessibilityRole="header" style={styles.title}>{panel === 'password' ? 'Change password' : 'Change profile photo'}</Text>
          <Text style={styles.hint}>{panel === 'password' ? 'Confirm your current password and choose a new one with at least 8 characters.' : 'Choose a JPG or PNG photo, up to 5 MB.'}</Text>
          {panel === 'password' ? <><PasswordField label="Current password" value={current} onChange={setCurrent} disabled={busy} current /><PasswordField label="New password" value={next} onChange={setNext} disabled={busy} /><PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} disabled={busy} /></> : <>
            {photo && <Image source={{ uri: photo.uri }} accessibilityLabel="Profile photo preview" style={styles.preview} />}
            <Pressable accessibilityRole="button" style={styles.outline} onPress={() => void choosePhoto()} disabled={busy}><Text style={styles.actionText}>{photo ? 'Choose another photo' : 'Choose photo'}</Text></Pressable>
          </>}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" disabled={busy || (panel === 'photo' && !photo)} onPress={() => void save()} style={[styles.primary, (busy || (panel === 'photo' && !photo)) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>Save changes</Text>}</Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={styles.outline}><Text style={styles.actionText}>Cancel</Text></Pressable>
        </ScrollView></View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  field: { gap: 10 }, actions: { gap: 10 }, label: { color: colors.navy, fontSize: 14, fontWeight: '600' },
  outline: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  actionText: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(32,44,70,0.35)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 440, maxHeight: '90%', borderRadius: 24, backgroundColor: colors.background, overflow: 'hidden' },
  modalContent: { padding: 22, gap: 16 }, title: { color: colors.navy, fontSize: 24, fontWeight: '700' }, hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.white },
  input: { flex: 1, minHeight: 54, color: colors.navy, paddingHorizontal: 14, fontSize: 14 }, eye: { width: 48, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 52, padding: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand, borderRadius: 16 }, primaryText: { fontSize: 14, fontWeight: '600', color: colors.white },
  preview: { width: 112, height: 112, borderRadius: 56, alignSelf: 'center' }, error: { fontSize: 13, lineHeight: 20, color: '#A13832' }, success: { fontSize: 13, lineHeight: 20, color: '#216E71', backgroundColor: '#DFF3F2', borderRadius: 12, padding: 12 },
});
