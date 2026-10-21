import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors } from '../theme';

export function SkeletonBlock({ width = '100%', height = 14, style }: { width?: number | `${number}%`; height?: number; style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.block, { width, height, opacity }, style]} />;
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return <View style={styles.card} accessibilityLabel="Loading content" accessibilityRole="progressbar">
    <SkeletonBlock width="42%" height={18} />
    {Array.from({ length: rows }, (_, index) => <SkeletonBlock key={index} width={index === rows - 1 ? '68%' : '100%'} height={12} />)}
  </View>;
}

export function SkeletonList({ rows = 3, avatar = false }: { rows?: number; avatar?: boolean }) {
  return <View accessibilityLabel="Loading content" accessibilityRole="progressbar" style={styles.list}>
    {Array.from({ length: rows }, (_, index) => <View key={index} style={styles.row}>
      {avatar && <SkeletonBlock width={54} height={54} style={{ borderRadius: 14 }} />}
      <View style={styles.copy}><SkeletonBlock width="44%" height={15} /><SkeletonBlock width="88%" height={12} /><SkeletonBlock width="62%" height={11} /></View>
    </View>)}
  </View>;
}

export function SkeletonMap() {
  return <View accessibilityLabel="Loading map" accessibilityRole="progressbar" style={styles.map}><SkeletonBlock width={42} height={42} style={styles.pin} /><SkeletonBlock width="68%" height={12} style={styles.mapLabel} /></View>;
}

const styles = StyleSheet.create({
  block: { borderRadius: 8, backgroundColor: colors.border },
  card: { padding: 18, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, gap: 14 },
  list: { gap: 0 },
  row: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  copy: { flex: 1, gap: 10 },
  map: { minHeight: 220, backgroundColor: '#E8EEF4', borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 14, overflow: 'hidden' },
  pin: { borderRadius: 22 },
  mapLabel: { alignSelf: 'center' },
});
