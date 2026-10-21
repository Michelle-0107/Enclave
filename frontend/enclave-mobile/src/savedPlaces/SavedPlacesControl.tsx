import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import { createSavedPlacesStore, type PlacePoint, type SavedPlace } from './store';

const store = createSavedPlacesStore(supabase);
type Props = {
  field: string;
  current: PlacePoint | null;
  onChoose: (point: SavedPlace) => void;
  onPickMapPoint?: (onPicked: (coordinate: PlacePoint['coordinate']) => void) => void;
  showHelp?: boolean;
  disabled?: boolean;
};
type Draft = PlacePoint & { id?: string };

export default function SavedPlacesControl({ field, current, onChoose, onPickMapPoint, showHelp = true, disabled = false }: Props) {
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<SavedPlace[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);
  const lock = useRef(false);
  const account = useRef<string | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (account.current === next) return;
      account.current = next;
      request.current += 1; lock.current = false;
      setVisible(false); setItems([]); setDraft(null); setError(''); setNotice(''); setBusy(false);
    });
    return () => { request.current += 1; data.subscription.unsubscribe(); };
  }, []);

  function close() {
    if (lock.current) return;
    request.current += 1; setVisible(false); setDraft(null); setError('');
  }
  async function refresh() {
    if (lock.current) return;
    const version = ++request.current;
    lock.current = true; setBusy(true); setError(''); setItems([]);
    try {
      const loaded = await store.list();
      if (request.current === version) setItems(loaded);
    } catch (failure) {
      if (request.current === version) setError(failure instanceof Error ? failure.message : 'Could not load saved places.');
    } finally {
      if (request.current === version) { lock.current = false; setBusy(false); }
    }
  }
  function open(save: boolean) {
    Keyboard.dismiss(); setNotice(''); setError('');
    setDraft(save && current ? { label: '', coordinate: [...current.coordinate] } : null);
    setVisible(true);
    if (!save) void refresh();
  }
  async function save() {
    if (!draft || lock.current) return;
    const version = ++request.current;
    lock.current = true; setBusy(true); setError('');
    try {
      await store.save(draft, draft.id);
      if (request.current === version) {
        setNotice('Saved to your account.'); setVisible(false); setDraft(null);
      }
    } catch (failure) {
      if (request.current === version) setError(failure instanceof Error ? failure.message : 'Could not save this place.');
    } finally {
      if (request.current === version) { lock.current = false; setBusy(false); }
    }
  }
  async function remove(item: SavedPlace) {
    if (lock.current) return;
    const version = ++request.current;
    lock.current = true; setBusy(true); setError('');
    try {
      await store.remove(item.id);
      if (request.current === version) setItems(previous => previous.filter(p => p.id !== item.id));
    } catch (failure) {
      if (request.current === version) setError(failure instanceof Error ? failure.message : 'Could not delete this place.');
    } finally {
      if (request.current === version) { lock.current = false; setBusy(false); }
    }
  }
  function confirmDelete(item: SavedPlace) {
    const version = request.current;
    Alert.alert('Delete saved place?', `Remove ${item.label} from your saved places?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { if (version === request.current) void remove(item); } },
    ]);
  }

  function adjustPositionOnMap() {
    if (!draft || !onPickMapPoint) return;
    const editing = { ...draft, coordinate: [...draft.coordinate] as PlacePoint['coordinate'] };
    setVisible(false);
    onPickMapPoint(coordinate => {
      setDraft({ ...editing, coordinate: [...coordinate] });
      setNotice('Map position updated. Save your changes to keep it.');
      setVisible(true);
    });
  }

  return <View style={styles.controls}>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Choose a saved place for ${field}`} disabled={disabled} onPress={() => open(false)} style={[styles.button, styles.actionButton, disabled && styles.disabled]}>
        <Text style={[styles.link, styles.actionLabel]}>Use saved place</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Save selected ${field}`} disabled={disabled || !current} onPress={() => open(true)} style={[styles.button, styles.actionButton, (disabled || !current) && styles.disabled]}>
        <Text style={[styles.link, styles.actionLabel]}>Save selected point</Text>
      </Pressable>
    </View>
    {showHelp && <Text style={styles.hint}>Save places like Home or Work once, then reuse them for either point. You can rename or adjust a saved place later.</Text>}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text> : null}
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>{draft ? (draft.id ? 'Edit saved place' : 'Save selected point') : 'Your saved places'}</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={styles.button}><Text style={styles.link}>Close</Text></Pressable>
          </View>
          <Text style={styles.hint}>Saved places are private to your account. Choose one to set your {field}.</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {draft ? <View style={styles.form}>
              <Text style={styles.name}>Place name</Text>
              <TextInput accessibilityLabel="Saved place name" value={draft.label} onChangeText={label => setDraft({ ...draft, label })} placeholder="e.g. Home, Office, Gym" maxLength={60} autoFocus editable={!busy} style={styles.input} />
              <Text style={styles.hint}>{draft.id ? 'Rename it here, or adjust its location on the map.' : 'This saves the currently selected map point.'}</Text>
              <Text style={styles.hint}>Location: {draft.coordinate[1].toFixed(6)}, {draft.coordinate[0].toFixed(6)}</Text>
              {draft.id && onPickMapPoint && <Pressable accessibilityRole="button" disabled={busy} onPress={adjustPositionOnMap} style={styles.button}><Text style={styles.link}>Adjust position on map</Text></Pressable>}
              {draft.id && current && <Pressable accessibilityRole="button" disabled={busy} onPress={() => setDraft({ ...draft, coordinate: [...current.coordinate] })} style={styles.button}><Text style={styles.link}>Use current point</Text></Pressable>}
              <Pressable accessibilityRole="button" disabled={busy || !draft.label.trim()} onPress={() => void save()} style={[styles.primary, (busy || !draft.label.trim()) && styles.disabled]}><Text style={styles.primaryText}>{draft.id ? 'Save changes' : 'Save place'}</Text></Pressable>
            </View> : <>
              {items.map(item => <View key={item.id} style={styles.item}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Use ${item.label} as ${field}`} disabled={busy} style={styles.choice} onPress={() => { onChoose(item); close(); }}>
                  <Text style={styles.name}>{item.label}</Text><Text style={styles.hint}>{item.coordinate[1].toFixed(6)}, {item.coordinate[0].toFixed(6)}</Text>
                </Pressable>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.label}`} disabled={busy} onPress={() => { setError(''); setDraft({ ...item, coordinate: [...item.coordinate] }); }} style={styles.button}><Text style={styles.link}>Edit</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.label}`} disabled={busy} onPress={() => confirmDelete(item)} style={styles.button}><Text style={styles.danger}>Delete</Text></Pressable>
                </View>
              </View>)}
              {!busy && !error && !items.length && <Text style={styles.hint}>No saved places yet. Choose a point, tap Save selected point, and give it a name such as Home or Work. You can reuse or edit it later.</Text>}
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void refresh()} style={styles.button}><Text style={styles.link}>Refresh</Text></Pressable>
            </>}
            {busy && <ActivityIndicator accessibilityLabel="Syncing saved places" color={colors.navy} />}
            {error ? <Text accessibilityRole="alert" style={styles.danger}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  controls: { gap: 6 }, actions: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'stretch', gap: 8 }, actionButton: { flex: 1, minWidth: 0, justifyContent: 'center', alignItems: 'center' }, actionLabel: { textAlign: 'center' },
  button: { paddingVertical: 12, paddingHorizontal: 10, minHeight: 44 },
  link: { color: colors.navy, fontWeight: '700' }, disabled: { opacity: 0.45 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 22, color: colors.navy, fontWeight: '700', flex: 1 },
  content: { padding: 20, gap: 16 }, form: { gap: 12 },
  item: { borderRadius: 16, backgroundColor: colors.white, padding: 12 },
  choice: { padding: 8, gap: 6 }, name: { fontWeight: '700', fontSize: 17, color: colors.navy },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: 14, borderRadius: 12, color: colors.navy },
  primary: { backgroundColor: colors.navy, borderRadius: 24, padding: 16, alignItems: 'center' },
  primaryText: { color: colors.white, fontWeight: '700' }, danger: { color: '#A63E37', lineHeight: 22 },
});
