import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock } from '../components/DataSkeleton';

export default function DemoMapSkeleton() {
  return <View accessibilityLabel="Loading route planner" accessibilityRole="progressbar" style={styles.container}>
    <SkeletonBlock width={142} height={25} style={styles.badge} />
    <View style={styles.transport}>
      {[0, 1, 2].map(item => <View key={item} style={styles.transportOption}>
        <SkeletonBlock width={18} height={18} style={styles.circle} />
        <SkeletonBlock width={item === 2 ? 52 : 38} height={10} />
      </View>)}
    </View>
    <View style={styles.info}>
      <SkeletonBlock width={17} height={17} style={styles.circle} />
      <View style={styles.infoCopy}><SkeletonBlock width="92%" height={10} /><SkeletonBlock width="62%" height={10} /></View>
    </View>
    <View style={styles.card}>
      <View style={styles.endpoint}>
        <SkeletonBlock width={86} height={9} />
        <View style={styles.input}><View style={styles.dot}><View style={styles.greenDot} /></View><SkeletonBlock width="78%" height={13} /></View>
      </View>
      <View style={styles.middle}><View style={styles.routeLine} /><SkeletonBlock width={29} height={29} style={styles.circle} /></View>
      <View style={styles.endpoint}>
        <SkeletonBlock width={102} height={9} />
        <View style={styles.input}><View style={styles.dot}><View style={styles.redDot} /></View><SkeletonBlock width="72%" height={13} /></View>
      </View>
      <View style={styles.savedRow}><SkeletonBlock width={77} height={24} style={styles.pill} /><SkeletonBlock width={78} height={24} style={styles.pill} /></View>
      <View style={styles.cta}><MaterialCommunityIcons name="navigation-variant" size={16} color="#FFFFFF" /><SkeletonBlock width={108} height={10} style={styles.whiteBlock} /></View>
    </View>
    <View style={styles.mapHeading}><View style={styles.infoCopy}><SkeletonBlock width={145} height={14} /><SkeletonBlock width={105} height={9} /></View><SkeletonBlock width={91} height={30} style={styles.pill} /></View>
    <View style={styles.map}>
      <View style={styles.mapRoadOne} /><View style={styles.mapRoadTwo} />
      <SkeletonBlock width={24} height={24} style={styles.mapPin} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 12 }, badge: { borderRadius: 6 },
  transport: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 14, backgroundColor: '#EAF0F5' },
  transportOption: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderRadius: 11, backgroundColor: '#FFFFFF' },
  circle: { borderRadius: 20 },
  info: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: '#D5E7FF', backgroundColor: '#F0F6FF' },
  infoCopy: { flex: 1, gap: 6 },
  card: { padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6EAF0', gap: 8 },
  endpoint: { gap: 6 }, input: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E0E7F0', backgroundColor: '#F7F9FC', paddingHorizontal: 10 },
  dot: { width: 16, alignItems: 'center' }, greenDot: { width: 11, height: 11, borderRadius: 7, backgroundColor: '#BDEBD9' }, redDot: { width: 11, height: 11, borderRadius: 7, backgroundColor: '#F9CFD7' },
  middle: { height: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 7 }, routeLine: { width: 2, height: 20, backgroundColor: '#D8E0EA' },
  savedRow: { flexDirection: 'row', gap: 8, paddingTop: 4 }, pill: { borderRadius: 18 },
  cta: { minHeight: 48, marginTop: 3, borderRadius: 13, backgroundColor: '#101729', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, whiteBlock: { backgroundColor: '#FFFFFF', borderRadius: 4 },
  mapHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  map: { height: 230, overflow: 'hidden', borderRadius: 16, backgroundColor: '#E8EEF4', alignItems: 'center', justifyContent: 'center' },
  mapRoadOne: { position: 'absolute', width: '130%', height: 17, backgroundColor: '#F5F3EF', transform: [{ rotate: '-18deg' }] },
  mapRoadTwo: { position: 'absolute', width: '125%', height: 12, backgroundColor: '#F5F3EF', transform: [{ rotate: '40deg' }] },
  mapPin: { borderRadius: 15, backgroundColor: '#526B8A', borderWidth: 4, borderColor: '#FFFFFF' },
});
