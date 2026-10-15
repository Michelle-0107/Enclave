import { useState, type ComponentProps } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import SignInScreen from './src/screens/SignInScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import SignUpSuccessScreen from './src/screens/SignUpSuccessScreen';

import HomeScreen from './src/screens/HomeScreen';
import MapScreen from './src/screens/MapScreen';
import ReportScreen from './src/screens/ReportScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import AccountScreen from './src/screens/AccountScreen';

import { colors } from './src/theme';

type Tab =
  | 'Home'
  | 'Map'
  | 'Report'
  | 'Notifications'
  | 'My Account';

type Screen =
  | 'signIn'
  | 'signUp'
  | 'signUpSuccess'
  | 'resident';

type IconName = ComponentProps<typeof Ionicons>['name'];

const tabs: { name: Tab; icon: IconName }[] = [
  { name: 'Home', icon: 'home-outline' },
  { name: 'Map', icon: 'map-outline' },
  { name: 'Report', icon: 'add-circle-outline' },
  { name: 'Notifications', icon: 'notifications-outline' },
  { name: 'My Account', icon: 'person-outline' },
];

function ResidentApp() {
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const insets = useSafeAreaInsets();

  function renderScreen() {
    switch (activeTab) {
      case 'Home':
        return (
          <HomeScreen
            onReportPress={() => setActiveTab('Report')}
            onNotificationsPress={() =>
              setActiveTab('Notifications')
            }
          />
        );

      case 'Map':
        return (
          <MapScreen
            onReportPress={() => setActiveTab('Report')}
          />
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
    <SafeAreaView
      style={styles.container}
      edges={['top', 'left', 'right']}
    >
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
        keyboardShouldPersistTaps="handled"
      >
        {renderScreen()}
      </ScrollView>

      <View
        style={[
          styles.tabBar,
          {
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        {tabs.map(({ name, icon }) => {
          const selected = activeTab === name;

          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={name}
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(name)}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.selectedTab,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={icon}
                size={23}
                color={
                  selected ? colors.white : colors.muted
                }
              />
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function AppFlow() {
  const [screen, setScreen] = useState<Screen>('signIn');

  switch (screen) {
    case 'signIn':
      return (
        <SignInScreen
          onDemoSignIn={() => setScreen('resident')}
          onSignUpPress={() => setScreen('signUp')}
        />
      );

    case 'signUp':
      return (
        <SignUpScreen
          onBack={() => setScreen('signIn')}
          onSignInPress={() => setScreen('signIn')}
          onRegistered={() => setScreen('signUpSuccess')}
        />
      );

    case 'signUpSuccess':
      return (
        <SignUpSuccessScreen
          onGoHome={() => setScreen('resident')}
        />
      );

    case 'resident':
      return <ResidentApp />;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppFlow />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: 16,
    paddingHorizontal: 24,
    paddingBottom: 28,
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
    paddingTop: 8,
    paddingBottom: 28,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedTab: {
    backgroundColor: colors.navy,
  },
  pressed: {
    opacity: 0.8,
  },
});