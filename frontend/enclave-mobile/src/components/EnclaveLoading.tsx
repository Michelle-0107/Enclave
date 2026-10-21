import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../theme';

type Props = {
  message: string;
};

export default function EnclaveLoading({ message }: Props) {
  return (
    <View
      style={styles.container}
      accessibilityViewIsModal
      accessibilityRole="progressbar"
      accessibilityLabel={message}
    >
      <Image
        source={require('../../assets/enclave_icon.png')}
        style={styles.logo}
        resizeMode="contain"
        accessible={false}
      />
      <Text style={styles.brand}>ENCLAVE</Text>
      <ActivityIndicator
        size="large"
        color={colors.brand}
        accessibilityLabel={message}
      />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: 24,
    backgroundColor: colors.background,
  },
  logo: {
    width: 64,
    height: 64,
  },
  brand: {
    marginTop: -8,
    color: colors.brand,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 5,
  },
  message: {
    color: colors.navy,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'center',
  },
});
