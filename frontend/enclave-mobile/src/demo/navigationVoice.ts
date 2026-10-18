import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type Speech = Pick<typeof import('expo-speech'), 'speak' | 'stop'>;
export function voiceAvailable() {
  return Platform.OS === 'web' || Boolean(requireOptionalNativeModule('ExpoSpeech'));
}

// Load only after the native-module check: older installed APKs must still open
// visual guidance, even though their binary does not contain ExpoSpeech yet.
export function createNavigationVoice(load: () => Promise<Speech> = () => import('expo-speech')) {
  let generation = 0, speech: Speech | undefined, lastKey = '';
  return {
    async say(key: string, text: string, onError: () => void) {
      if (key === lastKey) return;
      lastKey = key;
      const request = ++generation;
      try {
        speech ??= await load();
        if (request !== generation) return;
        await speech.stop();
        if (request !== generation) return;
        speech.speak(text, { language: 'en', rate: .95, onError: () => { if (request === generation) onError(); } });
      } catch { if (request === generation) onError(); }
    },
    stop() { generation++; lastKey = ''; void speech?.stop().catch(() => {}); },
  };
}

export function turnAnnouncement(text: string, distance: number) {
  const phase = distance <= 10 ? 'now' : distance <= 25 ? 'near' : distance <= 60 ? 'approach' : 'ahead';
  return { phase, text: phase === 'now' ? `Now. ${text}` : `In ${Math.round(distance / 5) * 5} meters. ${text}` };
}
