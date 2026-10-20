import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';

type Props = {
  onGetStarted: () => void;
  onSignIn: () => void;
};

export default function LandingScreen({
  onGetStarted,
  onSignIn,
}: Props) {
  const { width } = useWindowDimensions();

  const canvasWidth = Math.min(width, 430);
  const scale = canvasWidth / 390;

  return (
    <SafeAreaView
      style={styles.container}
      edges={['left', 'right', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View
          style={[
            styles.canvas,
            {
              width: canvasWidth,
              height: 844 * scale,
            },
          ]}
        >
          <Image
            source={require('../../assets/landing-hero.png')}
            style={{
              position: 'absolute',
              top: 112 * scale,
              left: 0,
              width: canvasWidth,
              height: 487 * scale,
            }}
            resizeMode="cover"
            accessible={false}
          />

          <Image
            source={require('../../assets/enclave-logo.png')}
            style={{
              tintColor: colors.brand,
              position: 'absolute',
              top: 86 * scale,
              left: 167 * scale,
              width: 55 * scale,
              height: 65 * scale,
            }}
            resizeMode="contain"
            accessible={false}
          />

          <Text
            style={[
              styles.brand,
              {
                top: 164 * scale,
                fontSize: 30 * scale,
                lineHeight: 40 * scale,
                letterSpacing: 9 * scale,
              },
            ]}
          >
            ENCLAVE
          </Text>

          <Text
            style={[
              styles.title,
              {
                top: 537 * scale,
                left: 33 * scale,
                width: 310 * scale,
                fontSize: 35 * scale,
                lineHeight: 42 * scale,
              },
            ]}
          >
            A Better{'\n'}
            Neighbourhood{'\n'}
            starts with us.
          </Text>

          <Text
            style={[
              styles.subtitle,
              {
                top: 678 * scale,
                left: 33 * scale,
                width: 300 * scale,
                fontSize: 15 * scale,
                lineHeight: 19 * scale,
              },
            ]}
          >
            Report issues, explore your{'\n'}
            neighbourhood and stay connected.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={onGetStarted}
            style={({ pressed }) => [
              styles.button,
              {
                top: 732 * scale,
                left: 25 * scale,
                width: 340 * scale,
                height: 54 * scale,
                borderRadius: 16 * scale,
              },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                {
                  fontSize: 15 * scale,
                },
              ]}
            >
              Get started
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Already a resident? Sign in"
            onPress={onSignIn}
            style={({ pressed }) => [
              styles.signInButton,
              {
                top: 790 * scale,
                height: 44 * scale,
              },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.signInText,
                {
                  fontSize: 15 * scale,
                },
              ]}
            >
              Already a resident?{' '}
              <Text style={styles.signInLink}>
                Sign in
              </Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  canvas: {
    position: 'relative',
    backgroundColor: colors.background,
  },

  brand: {
    position: 'absolute',
    left: 0,
    right: 0,
    fontWeight: '700',
    color: colors.brand,
    textAlign: 'center',
  },

  title: {
    position: 'absolute',
    fontWeight: '700',
    color: colors.navy,
  },

  subtitle: {
    position: 'absolute',
    color: colors.muted,
  },

  button: {
    position: 'absolute',
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonText: {
    fontWeight: '600',
    color: colors.white,
  },

  signInButton: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  signInText: {
    color: colors.muted,
    textAlign: 'center',
  },

  signInLink: {
    fontWeight: '700',
    color: colors.navy,
  },

  pressed: {
    opacity: 0.8,
  },
});