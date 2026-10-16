import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Camera,
  Map,
  Marker,
} from '@maplibre/maplibre-react-native';

import {
  reportsApi,
  type MapIssueFeature,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

type Props = {
  onReportPress: () => void;
  onChooseRoute?: (
    start: string,
    destination: string,
  ) => void;
};

const MAP_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

// Overview derived from the pilot bounds in the backend contract.
// This is not a destination or a damaged facility.
const PILOT_CENTER: [number, number] = [
  101.731,
  3.226,
];

const PILOT_BBOX: [number, number, number, number] = [
  101.7211,
  3.2171,
  101.7409,
  3.2349,
];

function formatFacilityType(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function faultLabel(issue: MapIssueFeature): string {
  return issue.properties.fault_kind === 'obstruction'
    ? 'Obstruction'
    : 'Damage';
}

export default function MapScreen({
  onReportPress,
  onChooseRoute,
}: Props) {
  const [start, setStart] = useState('');
  const [destination, setDestination] = useState('');

  const [issues, setIssues] =
    useState<MapIssueFeature[]>([]);

  const [selectedIssueId, setSelectedIssueId] =
    useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [mapError, setMapError] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function loadIssues() {
      setIsLoading(true);
      setError('');

      try {
        const {
          data,
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!mounted) return;
        if (sessionError) throw sessionError;

        const accessToken = data.session?.access_token;

        if (!accessToken) {
          throw new Error(
            'Your session has expired. Please sign in again.',
          );
        }

        const loaded = new globalThis.Map<
          string,
          MapIssueFeature
        >();

        let offset = 0;

        while (mounted) {
          const response =
            await reportsApi.getCommunityIssues(
              accessToken,
              100,
              offset,
              PILOT_BBOX,
              false,
            );

          if (!mounted) return;

          for (const issue of response.features) {
            loaded.set(issue.id, issue);
          }

          if (!response.pagination.has_more) {
            break;
          }

          // Avoid repeating an empty or invalid page forever.
          if (response.pagination.returned <= 0) {
            throw new Error(
              'Unable to load all community issues. Please retry.',
            );
          }

          const nextOffset =
            response.pagination.offset +
            response.pagination.returned;

          if (nextOffset <= offset) {
            throw new Error(
              'Invalid pagination response. Please retry.',
            );
          }

          offset = nextOffset;
        }

        if (mounted) {
          setIssues(Array.from(loaded.values()));
        }
      } catch (loadError) {
        if (!mounted) return;

        // Do not leave stale markers presented as current data.
        setIssues([]);
        setSelectedIssueId(null);

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load community issues.',
        );
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadIssues();

    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const selectedIssue =
    issues.find((issue) => issue.id === selectedIssueId) ??
    null;

  function handleRefresh() {
    setSelectedIssueId(null);
    setIssues([]);
    setRefreshKey((value) => value + 1);
  }

  function handleChooseRoute() {
    const startingPoint = start.trim();
    const endPoint = destination.trim();

    if (!startingPoint || !endPoint) {
      Alert.alert(
        'Choose your locations',
        'Please enter a starting point and an end point.',
      );
      return;
    }

    if (!onChooseRoute) {
      Alert.alert(
        'Route setup required',
        'The route options screen is not connected yet.',
      );
      return;
    }

    // Existing page navigation only.
    // Real routing requires selected numeric coordinates
    // and the navigation API integration.
    onChooseRoute(startingPoint, endPoint);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Around your neighbourhood.
      </Text>

      <Text style={styles.subtitle}>
        Community-reported issues, at a glance.
      </Text>

      <View style={styles.endpoints}>
        <View style={styles.endpoint}>
          <Text style={styles.fieldLabel}>
            Starting point
          </Text>

          <TextInput
            accessibilityLabel="Starting point"
            value={start}
            onChangeText={setStart}
            placeholder="Choose a starting point"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="next"
            style={styles.locationInput}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.endpoint}>
          <Text style={styles.fieldLabel}>
            End point
          </Text>

          <TextInput
            accessibilityLabel="End point"
            value={destination}
            onChangeText={setDestination}
            placeholder="Choose an end point"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="done"
            style={styles.locationInput}
          />
        </View>
      </View>

      <View style={styles.mapContainer}>
        <Map
          key={mapKey}
          style={styles.map}
          mapStyle={MAP_STYLE}
          androidView="texture"
          compass
          attribution
          onDidFinishLoadingMap={() => setMapError(false)}
          onDidFailLoadingMap={() => setMapError(true)}
        >
          <Camera
            initialViewState={{
              center: PILOT_CENTER,
              zoom: 15,
            }}
          />

          {issues.map((issue) => (
            <Marker
              key={issue.id}
              id={issue.id}
              lngLat={issue.geometry.coordinates}
              onPress={() => setSelectedIssueId(issue.id)}
            >
              <View
                collapsable={false}
                accessible
                accessibilityLabel={
                  `${issue.properties.facility_name}, ` +
                  `${faultLabel(issue)}, ` +
                  `${issue.properties.reporter_count} residents reported`
                }
                style={[
                  styles.marker,
                  issue.id === selectedIssueId &&
                    styles.selectedMarker,
                ]}
              >
                <Text style={styles.markerText}>!</Text>
              </View>
            </Marker>
          ))}
        </Map>

        {mapError && (
          <View style={styles.mapErrorCard}>
            <Text style={styles.closureTitle}>
              Could not load map
            </Text>

            <Text style={styles.closureDescription}>
              Check your internet connection.
            </Text>

            <Pressable
              accessibilityRole="button"
              style={styles.textButton}
              onPress={() => {
                setMapError(false);
                setMapKey((value) => value + 1);
              }}
            >
              <Text style={styles.reportLinkText}>
                Retry map
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.mapToolbar}>
        <Text style={styles.mapCount}>
          {isLoading
            ? 'Loading community issues…'
            : error
              ? 'Community issues unavailable'
              : `${issues.length} community issue${
                  issues.length === 1 ? '' : 's'
                } in KL East`}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh community issues"
          disabled={isLoading}
          onPress={handleRefresh}
          style={({ pressed }) => [
            styles.textButton,
            (pressed || isLoading) && styles.pressed,
          ]}
        >
          <Text style={styles.reportLinkText}>
            Refresh
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.issueState}>
          <ActivityIndicator
            size="small"
            color={colors.navy}
          />

          <Text style={styles.mapHint}>
            Loading community issues…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.issueState}>
          <Text
            accessibilityRole="alert"
            style={styles.errorText}
          >
            {error}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={handleRefresh}
            style={styles.textButton}
          >
            <Text style={styles.reportLinkText}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : issues.length === 0 ? (
        <View style={styles.issueState}>
          <Text style={styles.cardTitle}>
            No community-confirmed issues in this area.
          </Text>

          <Text style={styles.mapHint}>
            Issues appear after reports from at least
            2 distinct verified residents.
          </Text>
        </View>
      ) : (
        <>
          {selectedIssue && (
            <View style={styles.selectedCard}>
              <Text style={styles.cardTitle}>
                {selectedIssue.properties.facility_name}
              </Text>

              <Text style={styles.closureDescription}>
                {formatFacilityType(
                  selectedIssue.properties.facility_type,
                )}
                {' · '}
                {faultLabel(selectedIssue)}
              </Text>

              <Text style={styles.closureDescription}>
                {selectedIssue.properties.reporter_count}
                {' residents reported · '}
                {selectedIssue.properties.status === 'open'
                  ? 'Open issue'
                  : 'Resolved issue'}
              </Text>

              <Text style={styles.closureDescription}>
                Community-reported; this does not imply
                an on-site inspection.
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedIssueId(null)}
                style={styles.textButton}
              >
                <Text style={styles.reportLinkText}>
                  Close details
                </Text>
              </Pressable>
            </View>
          )}

          {issues.map((issue) => (
            <Pressable
              key={issue.id}
              accessibilityRole="button"
              onPress={() => setSelectedIssueId(issue.id)}
              style={({ pressed }) => [
                styles.closureNotice,
                issue.id === selectedIssueId &&
                  styles.selectedNotice,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closureTitle}>
                {issue.properties.facility_name}
                {' · '}
                {faultLabel(issue)}
              </Text>

              <Text style={styles.closureDescription}>
                {issue.properties.reporter_count}
                {' residents reported · '}
                {formatFacilityType(
                  issue.properties.facility_type,
                )}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={handleChooseRoute}
        style={({ pressed }) => [
          styles.chooseButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.chooseButtonText}>
          Choose route
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onReportPress}
        style={({ pressed }) => [
          styles.reportLink,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.reportLinkText}>
          Report an issue
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  title: {
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '700',
    color: colors.navy,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  endpoints: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  endpoint: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  locationInput: {
    padding: 0,
    margin: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
    includeFontPadding: false,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  mapContainer: {
    width: '100%',
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.lavender,
  },
  map: {
    flex: 1,
  },
  marker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#A63E37',
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedMarker: {
    backgroundColor: colors.navy,
  },
  markerText: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.white,
  },
  mapErrorCard: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.white,
    gap: 6,
  },
  mapToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mapCount: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  mapHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.navy,
  },
  closureNotice: {
    backgroundColor: '#FDE8E7',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  selectedNotice: {
    borderColor: colors.navy,
  },
  closureTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#A63E37',
  },
  closureDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  selectedCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  issueState: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 18,
    gap: 8,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#A63E37',
  },
  textButton: {
    minHeight: 44,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  chooseButton: {
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooseButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.white,
  },
  reportLink: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  reportLinkText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.navy,
  },
  pressed: {
    opacity: 0.8,
  },
});