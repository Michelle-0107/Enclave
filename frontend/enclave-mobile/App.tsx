import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import MapScreen from './src/screens/MapScreen';
import ReportScreen from './src/screens/ReportScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import AccountScreen from './src/screens/AccountScreen';
import { colors } from './src/theme';

type Tab = 'Map' | 'Report' | 'Notifications' | 'My Account';

const tabs: Tab[] = [
  'Map',
  'Report',
  'Notifications',
  'My Account',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Map');

  function renderScreen() {
    switch (activeTab) {
      case 'Map':
        return (
          <MapScreen onReportPress={() => setActiveTab('Report')} />
        );
      case 'Report':
        return <ReportScreen />;
      case 'Notifications':
        return <NotificationsScreen />;
      case 'My Account':
        return <AccountScreen />;
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.brand}>ENCLAVE</Text>
        <Text style={styles.tagline}>
          Your community, connected.
        </Text>
      </View>

      <ScrollView
        key={activeTab}
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        {renderScreen()}
      </ScrollView>

      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const selected = activeTab === tab;

          return (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(tab)}
              style={[
                styles.tab,
                selected && styles.selectedTab,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  selected && styles.selectedTabText,
                ]}
              >
                {tab}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 6,
  },
  brand: {
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: 5,
    color: colors.navy,
  },
  tagline: {
    fontSize: 12,
    color: colors.muted,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  selectedTab: {
    backgroundColor: colors.navy,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textAlign: 'center',
  },
  selectedTabText: {
    color: colors.white,
  },
});