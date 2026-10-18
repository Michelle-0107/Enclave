import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';

import ReportPhotoScreen from './ReportPhotoScreen';
import ReportLocationScreen, {
  type ReportLocationDetails,
} from './ReportLocationScreen';
import ReportSuccessScreen from './ReportSuccessScreen';
import type { ResidentReport } from './MyReportsScreen';

import {
  communityIssuesApi,
  facilitiesApi,
  navigationApi,
  reportsApi,
  type CommunityIssueRecord,
  type FacilityRecord,
  type FaultKind,
  type IssueLinkResponse,
  type ReportRecord,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

type Props = {
  onGoHome: () => void;
  onViewReports: () => void;
  onReportCreated: (report: ResidentReport) => void;
  onDescriptionFocus?: () => void;
  onStepChange?: () => void;
};

type Step =
  | 'photo'
  | 'location'
  | 'success';

type Selection = {
  facility: FacilityRecord;
  faultKind: FaultKind;
  issueId?: string;
};

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  const token = data.session?.access_token;

  if (!token) {
    throw new Error(
      'Your session has expired. Please sign in again.',
    );
  }

  return token;
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = (value: number) =>
    (value * Math.PI) / 180;

  const latDelta = radians(latitudeB - latitudeA);
  const lngDelta = radians(longitudeB - longitudeA);

  const raw =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(lngDelta / 2) ** 2;

  const value = Math.min(1, Math.max(0, raw));

  return (
    6371000 *
    2 *
    Math.atan2(
      Math.sqrt(value),
      Math.sqrt(1 - value),
    )
  );
}

export default function ReportScreen({
  onGoHome,
  onViewReports,
  onReportCreated,
  onDescriptionFocus,
  onStepChange,
}: Props) {
  const [step, setStep] = useState<Step>('photo');

  const [photo, setPhoto] =
    useState<ImagePickerAsset>();

  const [details, setDetails] = useState<ReportLocationDetails>({
    description: '',
    coordinates: null,
  });

  const [selection, setSelection] =
    useState<Selection>();

  const [ticketId, setTicketId] = useState('');
  const [pendingTicket, setPendingTicket] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkOutcome, setLinkOutcome] = useState<Pick<
    IssueLinkResponse,
    'community_visible' | 'deduplicated'
  > & { reporter_count: number } | null>(null);

  const [uploadUncertain, setUploadUncertain] =
    useState(false);

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const submitLock = useRef(false);

  function goToStep(nextStep: Step) {
    setStep(nextStep);
    onStepChange?.();
  }

  function handlePhotoContinue(
    selectedPhoto: ImagePickerAsset,
  ) {
    setPhoto(selectedPhoto);
    goToStep('location');
  }

  function handleLocationChange(
    locationDetails: ReportLocationDetails,
  ) {
    setDetails(locationDetails);
  }

  async function linkTicket(
    accessToken: string,
    uploadedTicket: string,
    selected: Selection,
  ) {
    if (selected.issueId) {
      return communityIssuesApi.linkReport(
        accessToken,
        selected.issueId,
        uploadedTicket,
      );
    }

    return communityIssuesApi.createOrLink(
      accessToken,
      {
        facility_id: selected.facility.id,
        fault_kind: selected.faultKind,
        report_ticket_id: uploadedTicket,
      },
    );
  }

  async function handleSubmit(selected: Selection | undefined = selection) {
    if (submitLock.current || uploadUncertain) {
      return;
    }

    if (!photo) {
      Alert.alert(
        'Missing report details',
        'Please add a photo and location first.',
      );

      goToStep('photo');
      return;
    }

    if (!details.coordinates) {
      Alert.alert(
        'Location required',
        'Please select the actual issue location first.',
      );

      goToStep('location');
      return;
    }

    if (!selected) {
      return;
    }

    const separation = distanceMeters(
      details.coordinates.latitude,
      details.coordinates.longitude,
      selected.facility.latitude,
      selected.facility.longitude,
    );

    if (
      !Number.isFinite(separation) ||
      separation > 100
    ) {
      Alert.alert(
        'Check issue location',
        'The report location must be within 100 m of the selected facility.',
      );

      goToStep('location');
      return;
    }

    submitLock.current = true;
    setIsSubmitting(true);
    setLinkError('');

    let uploadedTicket = pendingTicket;

    try {
      const accessToken = await getAccessToken();

      if (!uploadedTicket) {
        const form = new FormData();

        form.append(
          'description',
          details.description,
        );

        form.append(
          'latitude',
          String(details.coordinates.latitude),
        );

        form.append(
          'longitude',
          String(details.coordinates.longitude),
        );

        form.append('file', {
          uri: photo.uri,
          name:
            photo.fileName ||
            `report-${Date.now()}.jpg`,
          type: photo.mimeType || 'image/jpeg',
        } as unknown as Blob);

        let response:
          Awaited<ReturnType<typeof reportsApi.submit>>;

        try {
          response = await reportsApi.submit(
            accessToken,
            form,
          );
        } catch (uploadError) {
          const status =
            uploadError &&
            typeof uploadError === 'object' &&
            'status' in uploadError
              ? uploadError.status
              : undefined;

          if (
            status === undefined ||
            status === 0 ||
            (typeof status === 'number' &&
              status >= 500)
          ) {
            setUploadUncertain(true);
          }

          throw uploadError;
        }

        uploadedTicket = response.ticket_id;

        if (!uploadedTicket) {
          setUploadUncertain(true);

          throw new Error(
            'The server did not return a ticket. Check My Reports before uploading again.',
          );
        }

        // Keep the uploaded ticket so retries only link it.
        setPendingTicket(uploadedTicket);
        setTicketId(uploadedTicket);

        const record = response.data?.[0];

        if (record) {
          onReportCreated(
            mapCreatedReport(
              record,
              photo.uri,
            ),
          );
        }
      }

      const linkResponse = await linkTicket(
        accessToken,
        uploadedTicket,
        selected,
      );

      setLinkOutcome({
        community_visible: linkResponse.community_visible,
        deduplicated: linkResponse.deduplicated,
        reporter_count: linkResponse.issue.reporter_count,
      });

      goToStep('success');
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : 'Please try again.';

      if (uploadedTicket) {
        setLinkError(message);
      } else {
        Alert.alert(
          'Unable to confirm submission',
          message,
        );
      }
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  }

  function renderStep() {
    switch (step) {
      case 'photo':
        return (
          <ReportPhotoScreen
            initialPhoto={photo}
            onBack={onGoHome}
            onContinue={handlePhotoContinue}
          />
        );

      case 'location':
        if (!photo) {
          return null;
        }

        if (pendingTicket) {
          return (
            <View style={styles.panel}>
              <Text style={styles.title}>
                Report uploaded.
              </Text>

              <Text style={styles.body}>
                Ticket: {pendingTicket}
              </Text>

              <Text style={styles.body}>
                Community issue linking has not completed.
                Retry below without uploading another photo.
              </Text>

              {!!linkError && (
                <Text style={styles.error}>
                  {linkError}
                </Text>
              )}

              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void handleSubmit()}
                style={[
                  styles.button,
                  isSubmitting && styles.disabled,
                ]}
              >
                <Text style={styles.buttonText}>
                  Retry issue linking
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={onViewReports}
                style={styles.textButton}
              >
                <Text style={styles.link}>
                  View My Reports
                </Text>
              </Pressable>
            </View>
          );
        }

        if (uploadUncertain) {
          return (
            <View style={styles.panel}>
              <Text style={styles.title}>
                Check your submission.
              </Text>

              <Text style={styles.body}>
                We could not confirm whether the upload
                completed. Check My Reports before submitting
                again to avoid a duplicate.
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={onViewReports}
                style={styles.button}
              >
                <Text style={styles.buttonText}>
                  View My Reports
                </Text>
              </Pressable>
            </View>
          );
        }

        return (
          <ReportLocationScreen
            initialDetails={details}
            onDescriptionFocus={onDescriptionFocus}
            onBack={() => goToStep('photo')}
            onDetailsChange={handleLocationChange}
          >
            <IssueSelection
              details={details}
              photoUri={photo.uri}
              initialSelection={selection}
              onSubmit={(value) => {
                setSelection(value);
                void handleSubmit(value);
              }}
            />
          </ReportLocationScreen>
        );

      case 'success':
        return (
          <ReportSuccessScreen
            ticketId={ticketId}
            communityVisible={linkOutcome?.community_visible ?? null}
            reporterCount={linkOutcome?.reporter_count ?? null}
            deduplicated={linkOutcome?.deduplicated ?? false}
            onViewReports={onViewReports}
            onGoHome={onGoHome}
          />
        );

      default:
        return null;
    }
  }

  return (
    <View style={styles.container}>
      {renderStep()}

      {isSubmitting && (
        <View
          style={styles.busyOverlay}
          accessibilityViewIsModal
        >
          <ActivityIndicator
            size="large"
            color={colors.navy}
          />

          <Text style={styles.label}>
            Submitting report and linking issue…
          </Text>
        </View>
      )}
    </View>
  );
}

type IssueSelectionProps = {
  details: ReportLocationDetails;
  photoUri: string;
  initialSelection?: Selection;
  onSubmit: (selection: Selection) => void;
};

function IssueSelection({
  details,
  photoUri,
  initialSelection,
  onSubmit,
}: IssueSelectionProps) {
  const [facilities, setFacilities] =
    useState<FacilityRecord[]>([]);

  const [issues, setIssues] =
    useState<CommunityIssueRecord[]>([]);

  const [facilityId, setFacilityId] = useState(
    initialSelection?.facility.id ?? '',
  );

  const faultKind: FaultKind = initialSelection?.faultKind ?? 'damage';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const token = await getAccessToken();
        const area = await navigationApi.getArea(token);

        const facilityItems: FacilityRecord[] = [];
        const issueItems: CommunityIssueRecord[] = [];

        let offset = 0;

        while (mounted) {
          const page = await facilitiesApi.getAll(
            token,
            {
              limit: 100,
              offset,
              bbox: area.bbox,
            },
          );

          if (!mounted) {
            return;
          }

          facilityItems.push(...page.items);

          if (!page.pagination.has_more) {
            break;
          }

          const next =
            page.pagination.offset +
            page.pagination.returned;

          if (next <= offset) {
            throw new Error(
              'Unable to load all facilities.',
            );
          }

          offset = next;
        }

        offset = 0;

        while (mounted) {
          const page = await communityIssuesApi.getAll(
            token,
            {
              limit: 100,
              offset,
              bbox: area.bbox,
            },
          );

          if (!mounted) {
            return;
          }

          issueItems.push(...page.items);

          if (!page.pagination.has_more) {
            break;
          }

          const next =
            page.pagination.offset +
            page.pagination.returned;

          if (next <= offset) {
            throw new Error(
              'Unable to load all issues.',
            );
          }

          offset = next;
        }

        if (!mounted) {
          return;
        }

        setFacilities(
          Array.from(
            new Map(
              facilityItems.map((item) => [
                item.id,
                item,
              ]),
            ).values(),
          ),
        );

        setIssues(
          issueItems.filter(
            (issue) => issue.status === 'open',
          ),
        );
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load facilities.',
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [attempt]);

  const coordinates = details.coordinates;

  const nearby = coordinates
    ? facilities
        .map((facility) => ({
          facility,
          distance: distanceMeters(
            coordinates.latitude,
            coordinates.longitude,
            facility.latitude,
            facility.longitude,
          ),
        }))
        .filter(
          (item) =>
            Number.isFinite(item.distance) &&
            item.distance <= 100,
        )
        .sort((a, b) => a.distance - b.distance)
    : [];

  const selected = nearby.find(
    (item) => item.facility.id === facilityId,
  )?.facility;

  const existingIssue = selected
    ? issues.find(
        (issue) =>
          issue.facility_id === selected.id &&
          issue.fault_kind === faultKind,
      )
    : undefined;

  const canContinue =
    !!selected && !!coordinates && !!details.description.trim() && !loading && !error;

  return (
    <View style={styles.panel}>
      <Text style={styles.sectionTitle}>Choose a facility</Text>

      <Text style={styles.body}>
        Select the facility nearest to the pin. Your report
        location must be within 100 m of the facility.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.navy} />
      ) : error ? (
        <View style={styles.panel}>
          <Text style={styles.error}>{error}</Text>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setAttempt((value) => value + 1)
            }
            style={styles.textButton}
          >
            <Text style={styles.link}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : nearby.length === 0 ? (
        <Text style={styles.body}>
          No registered facilities within 100 m of the
          report location. Go back to check the issue
          location. If the facility is missing, it needs
          to be registered before linking.
        </Text>
      ) : (
        nearby.map(({ facility, distance }) => (
          <Pressable
            key={facility.id}
            accessibilityRole="radio"
            accessibilityState={{
              checked: selected?.id === facility.id,
            }}
            onPress={() =>
              setFacilityId(facility.id)
            }
            style={[
              styles.choice,
              selected?.id === facility.id &&
                styles.selectedChoice,
            ]}
          >
            <Text style={styles.label}>
              {facility.name}
            </Text>

            <Text style={styles.body}>
              {facility.facility_type.replace(/_/g, ' ')}
              {' · '}
              {Math.round(distance)} m from report location
            </Text>
          </Pressable>
        ))
      )}

      {selected && !loading && !error && (
        <View style={styles.summary}>
          <Text style={styles.label}>Report preview</Text>
          <Image source={{ uri: photoUri }} style={styles.confirmPhoto} resizeMode="contain" />
          <Text style={styles.body}>Location: {coordinates ? `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}` : 'Not selected'}</Text>
          <Text style={styles.body}>Facility: {selected.name}</Text>
          <Text style={styles.body}>
            {existingIssue
              ? `Matching open issue: ${existingIssue.reporter_count} residents reported. Your report will be linked to this issue.`
              : 'Your report will be added to the community issue list for this facility.'}
          </Text>
        </View>
      )}

      {!details.description.trim() && (
        <Text style={styles.body}>Add a description above to continue.</Text>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={!canContinue}
        onPress={() => {
          if (!selected || !canContinue) {
            return;
          }

          onSubmit({
            facility: selected,
            faultKind,
            issueId: existingIssue?.id,
          });
        }}
        style={[
          styles.button,
          !canContinue && styles.disabled,
        ]}
      >
        <Text style={styles.buttonText}>
          Submit report
        </Text>
      </Pressable>
    </View>
  );
}

function mapCreatedReport(
  record: ReportRecord,
  photoUri: string,
): ResidentReport {
  return {
    id: record.ticket_id,
    title: record.category || 'Community report',
    location: `${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}`,
    date: record.created_at
      ? new Date(record.created_at).toLocaleDateString(
          'en-GB',
          {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          },
        )
      : 'Just now',
    status: 'Pending management review',
    description: record.description,
    category: record.category || 'Uncategorised',
    priority: record.priority || 'Not set',
    latitude: record.latitude,
    longitude: record.longitude,
    photoUri: record.image_url || photoUri,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  panel: {
    gap: 16,
  },

  title: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    color: colors.navy,
  },

  sectionTitle: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.navy,
  },

  body: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },

  label: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.navy,
  },

  choice: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    gap: 4,
    minHeight: 50,
  },

  selectedChoice: {
    borderColor: colors.navy,
    backgroundColor: '#E6F3EA',
  },

  summary: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#E6F3EA',
    gap: 6,
    marginBottom: 16,
  },

  confirmPhoto: {
    width: '100%',
    height: 170,
    borderRadius: 12,
    backgroundColor: colors.white,
  },

  button: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },

  buttonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },

  textButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  link: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: '600',
  },

  error: {
    color: '#A63E37',
    fontSize: 13,
    lineHeight: 20,
  },

  disabled: {
    opacity: 0.5,
  },

  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    zIndex: 20,
    elevation: 20,
  },
});
