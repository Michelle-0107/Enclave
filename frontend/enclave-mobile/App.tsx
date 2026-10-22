import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  KeyboardAvoidingView,
  Image,
  Platform,
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
import type { MapEndpoints } from './src/screens/MapScreen';
import MapScreen from './src/navigation/LiveAreaMapScreen';
import DemoMapScreen from './src/demo/ServiceAreaDemoScreen';
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
import EnclaveLoading from './src/components/EnclaveLoading';
import { clearAccessToken } from './src/lib/session';
import { accountPhotoApi } from './src/lib/api';
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
      points: MapEndpoints;
    }
  | {
      page: 'journey';
      start: string;
      destination: string;
      points: MapEndpoints;
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
  { name: 'Report', icon: 'document-text-outline' },
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

  const [avatarUrl, setAvatarUrl] = useState('');

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
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let mounted = true;

    async function loadProfilePhoto() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const accessToken = data.session?.access_token;
        if (!accessToken) return;

        const profile = await accountPhotoApi.get(accessToken);
        if (mounted && profile.avatar_url?.startsWith('https://')) {
          setAvatarUrl(profile.avatar_url);
        }
      } catch {
        // The profile photo is optional; keep the resident icon when unavailable.
      }
    }

    void loadProfilePhoto();
    return () => {
      mounted = false;
    };
  }, []);

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
    if (target.type === 'announcement') return;

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

    openMyReports();
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
            onMapTouchChange={setMapTouchActive}
            onReportPress={() => changeTab('Report')}
            onChooseRoute={(start, destination, points) => {
              setMapFlow({
                page: 'options',
                start,
                destination,
                points,
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
            onMapTouchChange={setMapTouchActive}
            start={start}
            destination={destination}
            navigationArea={mapFlow.points.area}
            initialOrigin={mapFlow.points.origin}
            initialDestination={mapFlow.points.destination}
            onBack={() => {
              setMapFlow({ page: 'map' });
              scrollToTop();
            }}
            onStartJourney={(route, points, names) => {
              setMapFlow({
                page: 'journey',
                start: names.start,
                destination: names.destination,
                route,
                points,
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
                points: mapFlow.points,
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
            avatarUrl={avatarUrl}
            onAvatarChange={setAvatarUrl}
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
            onMapTouchChange={setMapTouchActive}
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
            onMapPress={() => changeTab('Map')}
            onMyReportsPress={openMyReports}
          />
        );

      case 'Map':
        return renderMapScreen();

      case 'Report':
        return (
          <ReportScreen
            onMapTouchChange={setMapTouchActive}
            onGoHome={() => changeTab('Home')}
            onStepChange={scrollToTop}
            onDescriptionFocus={() => {
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
            }}
            onViewReports={openMyReports}
            onReportCreated={addReport}
            onSubmittingChange={setReportSubmitting}
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <SafeAreaView
      style={styles.container}
      edges={['top', 'left', 'right']}
    >
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandCopy}>
            <Text style={styles.brand}>ENCLAVE</Text>
            <Text style={styles.tagline}>Your community, connected.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="My profile"
            disabled={reportSubmitting}
            onPress={() => openAccountPage({ page: 'account' })} style={styles.profileButton}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} accessibilityLabel="Your profile photo" style={styles.profilePhoto} />
            ) : (
              <Ionicons name="person-outline" size={20} color={colors.brand} />
            )}
          </Pressable>
        </View>
      </View>

      {activeTab === 'My Account' && accountFlow.page === 'details' && (
        <View style={styles.detailsBackBar}>
          <Pressable
            accessibilityRole="button"
            onPress={openMyReports}
            hitSlop={8}
            style={styles.detailsBackButton}
          >
            <Text style={styles.detailsBackText}>‹ My reports</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.screenArea}>
        <ScrollView
          ref={scrollRef}
          scrollEnabled={!mapTouchActive && !reportSubmitting}
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            activeTab === 'Report' && styles.fillContent,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          {renderScreen()}
        </ScrollView>
        {activeTab === 'Report' && reportSubmitting && (
          <View style={styles.reportLoadingOverlay}>
            <EnclaveLoading message="Submitting report and linking issue..." />
          </View>
        )}
      </View>

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
              accessibilityLabel={tab.name === 'Report' ? 'Create a report' : tab.name}
              accessibilityState={{ selected }}
              disabled={reportSubmitting}
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
              {tab.name === 'Report' ? (
                <View style={styles.reportTabIcon}>
                  <Ionicons
                    name="document-text-outline"
                    size={23}
                    color={selected ? colors.white : colors.muted}
                  />
                  <Ionicons
                    name="add-circle-outline"
                    size={13}
                    color={selected ? colors.white : colors.muted}
                    style={[
                      styles.reportTabAdd,
                      { backgroundColor: selected ? colors.navy : colors.white },
                    ]}
                  />
                </View>
              ) : (
                <Ionicons
                  name={tab.icon}
                  size={23}
                  color={selected ? colors.white : colors.muted}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
    </KeyboardAvoidingView>
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
    paddingBottom: 18,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandCopy: { gap: 5 },
  profileButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2F7', overflow: 'hidden' },
  profilePhoto: { width: 42, height: 42, borderRadius: 21 },
  detailsBackBar: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    backgroundColor: colors.background,
    zIndex: 2,
  },
  detailsBackButton: {
    minHeight: 40,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  detailsBackText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  brand: {
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: 5,
    color: colors.brand,
  },
  tagline: {
    fontSize: 12,
    color: colors.muted,
  },
  scroll: {
    flex: 1,
  },
  screenArea: {
    flex: 1,
  },
  reportLoadingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    elevation: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 28,
  },
  fillContent: {
    flexGrow: 1,
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
    backgroundColor: colors.brand,
  },
  reportTabIcon: {
    width: 25,
    height: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportTabAdd: {
    position: 'absolute',
    right: -3,
    bottom: -1,
    borderRadius: 8,
  },
  pressed: {
    opacity: 0.8,
  },
});
