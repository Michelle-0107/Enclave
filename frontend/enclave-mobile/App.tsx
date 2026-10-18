import {
  useRef,
  useState,
  type ComponentProps,
} from 'react';
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

import LandingScreen from './src/screens/LandingScreen';
import SignInScreen from './src/screens/SignInScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import SignUpSuccessScreen from './src/screens/SignUpSuccessScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';

import HomeScreen from './src/screens/HomeScreen';
import MapScreen from './src/screens/MapScreen';
import DemoMapScreen from './src/demo/DemoMapScreen';
import RouteOptionsScreen, {
  type RouteOption,
} from './src/screens/RouteOptionsScreen';
import ActiveJourneyScreen from './src/screens/ActiveJourneyScreen';

import ReportScreen from './src/screens/ReportScreen';

import NotificationsScreen, {
  type ResidentNotification,
} from './src/screens/NotificationsScreen';

import AccountScreen from './src/screens/AccountScreen';

import MyReportsScreen, {
  type ResidentReport,
} from './src/screens/MyReportsScreen';

import ReportDetailsScreen from './src/screens/ReportDetailsScreen';

import NotificationPreferencesScreen, {
  defaultNotificationPreferences,
  type NotificationPreferences,
} from './src/screens/NotificationPreferencesScreen';

import FollowedAreasScreen, {
  defaultFollowedAreas,
  type FollowedAreaId,
} from './src/screens/FollowedAreasScreen';

import HelpScreen from './src/screens/HelpScreen';

import { colors } from './src/theme';
import { clearAccessToken } from './src/lib/session';
import { supabase } from './src/lib/supabase';

type Tab =
  | 'Home'
  | 'Map'
  | 'Report'
  | 'Notifications'
  | 'My Account';

type Screen =
  | 'landing'
  | 'signIn'
  | 'signUp'
  | 'signUpSuccess'
  | 'forgotPassword'
  | 'resident';

type MapFlow =
  | { page: 'map' }
  | {
      page: 'options';
      start: string;
      destination: string;
    }
  | {
      page: 'journey';
      start: string;
      destination: string;
      route: RouteOption;
      startedAt: number;
    };

type AccountFlow =
  | { page: 'account' }
  | { page: 'reports' }
  | { page: 'preferences' }
  | { page: 'followedAreas' }
  | { page: 'help' }
  | {
      page: 'details';
      reportId: string;
    };

type IconName = ComponentProps<typeof Ionicons>['name'];

const tabs: { name: Tab; icon: IconName }[] = [
  { name: 'Home', icon: 'home-outline' },
  { name: 'Map', icon: 'map-outline' },
  { name: 'Report', icon: 'add-circle-outline' },
  { name: 'Notifications', icon: 'notifications-outline' },
  { name: 'My Account', icon: 'person-outline' },
];

function ResidentApp({
  onLogOut,
}: {
  onLogOut: () => void;
}) {
  const [activeTab, setActiveTab] =
    useState<Tab>('Home');

  const [mapFlow, setMapFlow] = useState<MapFlow>({
    page: 'map',
  });

  const [accountFlow, setAccountFlow] =
    useState<AccountFlow>({ page: 'account' });

  const [reports, setReports] =
    useState<ResidentReport[]>([]);

  const [preferences, setPreferences] =
    useState<NotificationPreferences>(
      defaultNotificationPreferences,
    );

  const [followedAreas, setFollowedAreas] =
    useState<FollowedAreaId[]>([
      ...defaultFollowedAreas,
    ]);

  const [showFacilityDemo, setShowFacilityDemo] = useState(true);

  const [mapTouchActive, setMapTouchActive] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  function scrollToTop() {
    scrollRef.current?.scrollTo({
      y: 0,
      animated: false,
    });
  }

  function changeTab(tab: Tab) {
    setActiveTab(tab);
    scrollToTop();
  }

  function openAccountPage(page: AccountFlow) {
    setAccountFlow(page);
    changeTab('My Account');
  }

  function openMyReports() {
    openAccountPage({ page: 'reports' });
  }

  function addReport(report: ResidentReport) {
    setReports((current) => [
      report,
      ...current.filter((item) => item.id !== report.id),
    ]);
  }

  function handleNotificationPress(
    notification: ResidentNotification,
  ) {
    const target = notification.target;

    if (target.type === 'report') {
      const reportExists = reports.some(
        (report) => report.id === target.reportId,
      );

      if (reportExists) {
        openAccountPage({
          page: 'details',
          reportId: target.reportId,
        });
      } else {
        openMyReports();
      }

      return;
    }

    setMapFlow({ page: 'map' });
    changeTab('Map');
  }

  function renderMapScreen() {
    if (mapFlow.page === 'map' && showFacilityDemo) {
      return <DemoMapScreen onMapTouchChange={setMapTouchActive} onShowLiveMap={() => setShowFacilityDemo(false)} onReportPress={() => changeTab('Report')} />;
    }
    switch (mapFlow.page) {
      case 'map':
        return (
          <View style={{ gap: 12 }}>
          <Pressable accessibilityRole="button" onPress={() => setShowFacilityDemo(true)} style={{ padding: 12 }}>
            <Text>Open resident demo</Text>
          </Pressable>
          <MapScreen
            onReportPress={() => changeTab('Report')}
            onChooseRoute={(start, destination) => {
              setMapFlow({
                page: 'options',
                start,
                destination,
              });
              scrollToTop();
            }}
          />
          </View>
        );

      case 'options': {
        const { start, destination } = mapFlow;

        return (
          <RouteOptionsScreen
            start={start}
            destination={destination}
            onBack={() => {
              setMapFlow({ page: 'map' });
              scrollToTop();
            }}
            onStartJourney={(route) => {
              setMapFlow({
                page: 'journey',
                start,
                destination,
                route,
                startedAt: Date.now(),
              });
              scrollToTop();
            }}
          />
        );
      }

      case 'journey': {
        const {
          start,
          destination,
          route,
          startedAt,
        } = mapFlow;

        return (
          <ActiveJourneyScreen
            route={route}
            destination={destination}
            startedAt={startedAt}
            onBack={() => {
              setMapFlow({
                page: 'options',
                start,
                destination,
              });
              scrollToTop();
            }}
            onArrived={() => {
              setMapFlow({ page: 'map' });
              scrollToTop();
            }}
            onEndJourney={() => {
              setMapFlow({ page: 'map' });
              scrollToTop();
            }}
          />
        );
      }
    }
  }

  function renderReportsList() {
    return (
      <MyReportsScreen
        reports={reports}
        onBack={() =>
          openAccountPage({ page: 'account' })
        }
        onReportPress={(report) => {
          addReport(report);
          openAccountPage({
            page: 'details',
            reportId: report.id,
          });
        }}
      />
    );
  }

  function renderAccountScreen() {
    switch (accountFlow.page) {
      case 'account':
        return (
          <AccountScreen
            onMyReportsPress={openMyReports}
            onFollowedAreasPress={() =>
              openAccountPage({ page: 'followedAreas' })
            }
            onNotificationPreferencesPress={() =>
              openAccountPage({ page: 'preferences' })
            }
            onHelpPress={() =>
              openAccountPage({ page: 'help' })
            }
            onLogOut={onLogOut}
          />
        );

      case 'reports':
        return renderReportsList();

      case 'details': {
        const report = reports.find(
          (item) => item.id === accountFlow.reportId,
        );

        if (!report) {
          return renderReportsList();
        }

        return (
          <ReportDetailsScreen
            report={report}
            onBack={openMyReports}
          />
        );
      }

      case 'preferences':
        return (
          <NotificationPreferencesScreen
            preferences={preferences}
            onChange={setPreferences}
            onBack={() =>
              openAccountPage({ page: 'account' })
            }
          />
        );

      case 'followedAreas':
        return (
          <FollowedAreasScreen
            followedAreas={followedAreas}
            onSave={setFollowedAreas}
            onBack={() =>
              openAccountPage({ page: 'account' })
            }
          />
        );

      case 'help':
        return (
          <HelpScreen
            onBack={() =>
              openAccountPage({ page: 'account' })
            }
          />
        );
    }
  }

  function renderScreen() {
    switch (activeTab) {
      case 'Home':
        return (
          <HomeScreen
            onReportPress={() => changeTab('Report')}
            onNotificationsPress={() =>
              changeTab('Notifications')
            }
          />
        );

      case 'Map':
        return renderMapScreen();

      case 'Report':
        return (
          <ReportScreen
            onGoHome={() => changeTab('Home')}
            onStepChange={scrollToTop}
            onViewReports={openMyReports}
            onReportCreated={addReport}
          />
        );

      case 'Notifications':
        return (
          <NotificationsScreen
            onNotificationPress={handleNotificationPress}
          />
        );

      case 'My Account':
        return renderAccountScreen();
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
        ref={scrollRef}
        scrollEnabled={!mapTouchActive}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {renderScreen()}
      </ScrollView>

      <View
        style={[
          styles.tabBar,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.name;

          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.name}
              accessibilityState={{ selected }}
              onPress={() => {
                if (tab.name === 'My Account') {
                  setAccountFlow({ page: 'account' });
                }

                changeTab(tab.name);
              }}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.selectedTab,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={tab.icon}
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
  const [screen, setScreen] =
    useState<Screen>('landing');

  switch (screen) {
    case 'landing':
      return (
        <LandingScreen
          onGetStarted={() => setScreen('signIn')}
          onSignIn={() => setScreen('signIn')}
        />
      );

    case 'signIn':
      return (
        <SignInScreen
          onBack={() => setScreen('landing')}
          onDemoSignIn={() => setScreen('resident')}
          onSignUpPress={() => setScreen('signUp')}
          onForgotPasswordPress={() =>
            setScreen('forgotPassword')
          }
        />
      );

    case 'forgotPassword':
      return (
        <ForgotPasswordScreen
          onBack={() => setScreen('signIn')}
        />
      );

    case 'signUp':
      return (
        <SignUpScreen
          onBack={() => setScreen('signIn')}
          onSignInPress={() => setScreen('signIn')}
          onRegistered={() =>
            setScreen('signUpSuccess')
          }
        />
      );

    case 'signUpSuccess':
      return (
        <SignUpSuccessScreen
          onGoHome={() => setScreen('resident')}
        />
      );

    case 'resident':
      return (
        <ResidentApp
          onLogOut={async () => {
            await supabase.auth.signOut();
            await clearAccessToken();
            setScreen('signIn');
          }}
        />
      );
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
