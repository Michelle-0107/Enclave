import { useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme';

type Props = {
  initialPhoto?: ImagePicker.ImagePickerAsset;
  onBack: () => void;
  onContinue: (photo: ImagePicker.ImagePickerAsset) => void;
};

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function validatePhoto(photo: ImagePicker.ImagePickerAsset): string | null {
  if (photo.mimeType !== 'image/jpeg' && photo.mimeType !== 'image/png') {
    return 'Please choose a JPEG or PNG image.';
  }

  if (photo.fileSize === 0) {
    return 'The selected image is empty. Please choose another image.';
  }

  if (photo.fileSize && photo.fileSize > MAX_PHOTO_BYTES) {
    return 'The image must be 10 MB or smaller.';
  }

  return null;
}

export default function ReportPhotoScreen({
  initialPhoto,
  onBack,
  onContinue,
}: Props) {
  const [photo, setPhoto] = useState(initialPhoto);
  const [busy, setBusy] = useState(false);

  async function takePhoto() {
    if (busy) return;

    setBusy(true);

    try {
      const permission =
        await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Camera access needed',
          'Allow camera access to take a photo of the issue.',
          permission.canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open settings',
                  onPress: () => {
                    void Linking.openSettings().catch(() => {
                      Alert.alert(
                        'Unable to open settings',
                        'Please open your phone settings manually.'
                      );
                    });
                  },
                },
              ]
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const selected = result.assets[0];
        const error = validatePhoto(selected);
        if (error) {
          Alert.alert('Unsupported image', error);
        } else {
          setPhoto(selected);
        }
      }
    } catch {
      Alert.alert(
        'Unable to open camera',
        'Please try again or choose a photo from your gallery.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto() {
    if (busy) return;

    setBusy(true);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const selected = result.assets[0];
        const error = validatePhoto(selected);
        if (error) {
          Alert.alert('Unsupported image', error);
        } else {
          setPhoto(selected);
        }
      }
    } catch {
      Alert.alert(
        'Unable to open gallery',
        'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.navigation}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.step}>STEP 01 OF 03</Text>
      </View>

      <View style={styles.introduction}>
        <Text style={styles.title}>Add a photo.</Text>

        <Text style={styles.subtitle}>
          Show us what needs attention.
        </Text>
      </View>

      <View style={styles.photoArea}>
        {photo ? (
          <Image
            source={{ uri: photo.uri }}
            accessibilityLabel="Selected issue photo"
            style={styles.photo}
            resizeMode="cover"
          />
        ) : (
          <>
            <Ionicons
              name="camera-outline"
              size={36}
              color={colors.navy}
            />

            <Text style={styles.subtitle}>
              Take a photo or choose from gallery
            </Text>
          </>
        )}
      </View>

      <Pressable
        onPress={takePhoto}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        style={({ pressed }) => [
          styles.primaryButton,
          busy && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryText}>
          {photo ? 'Retake photo' : 'Take photo'}
        </Text>
      </Pressable>

      <Pressable
        onPress={choosePhoto}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        style={({ pressed }) => [
          styles.secondaryButton,
          busy && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.secondaryText}>
          Choose from gallery
        </Text>
      </Pressable>

      <Text style={styles.helper}>
        Keep the issue clear in the frame. Avoid including
        faces or private information.
      </Text>

      <Pressable
        onPress={() => {
          if (!photo) return;
          const error = validatePhoto(photo);
          if (error) {
            Alert.alert('Unsupported image', error);
            return;
          }
          onContinue(photo);
        }}
        disabled={!photo || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !photo || busy }}
        style={({ pressed }) => [
          styles.primaryButton,
          styles.continueButton,
          (!photo || busy) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 20,
  },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  step: {
    fontSize: 10,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.muted,
  },
  introduction: {
    gap: 8,
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
    textAlign: 'left',
  },
  photoArea: {
    height: 220,
    borderRadius: 24,
    backgroundColor: colors.lavender,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.white,
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.navy,
  },
  helper: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
  continueButton: {
    marginTop: 24,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.8,
  },
});
