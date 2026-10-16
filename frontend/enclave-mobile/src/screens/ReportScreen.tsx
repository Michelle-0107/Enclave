import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';

import ReportPhotoScreen from './ReportPhotoScreen';
import ReportLocationScreen, {
  type ReportLocationDetails,
} from './ReportLocationScreen';
import ReportReviewScreen, {
  type ReportReviewData,
} from './ReportReviewScreen';
import ReportSuccessScreen from './ReportSuccessScreen';
import type { ResidentReport } from './MyReportsScreen';
import { reportsApi, type ReportRecord } from '../lib/api';
import { supabase } from '../lib/supabase';

type Props = {
  onGoHome: () => void;
  onViewReports: () => void;
  onReportCreated: (report: ResidentReport) => void;
  onStepChange?: () => void;
};

type Step = 'photo' | 'location' | 'review' | 'success';

export default function ReportScreen({
  onGoHome,
  onViewReports,
  onReportCreated,
  onStepChange,
}: Props) {
  const [step, setStep] = useState<Step>('photo');

  const [photo, setPhoto] =
    useState<ImagePickerAsset | undefined>();

  const [details, setDetails] =
    useState<ReportLocationDetails | undefined>();

  const [review, setReview] =
    useState<ReportReviewData | undefined>();

  const [ticketId, setTicketId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  function handleLocationContinue(
    locationDetails: ReportLocationDetails,
  ) {
    setDetails(locationDetails);
    goToStep('review');
  }

  async function handleSubmit(reviewData: ReportReviewData) {
    if (!photo || !details) {
      Alert.alert(
        'Missing report details',
        'Please add a photo and location first.',
      );

      goToStep(!photo ? 'photo' : 'location');
      return;
    }

    if (!details.coordinates) {
      Alert.alert(
        'Location required',
        'Use your current location before submitting this report.',
      );
      goToStep('location');
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('Your session has expired. Please sign in again.');

      const form = new FormData();
      form.append('description', details.description);
      form.append('latitude', String(details.coordinates.latitude));
      form.append('longitude', String(details.coordinates.longitude));
      form.append('file', {
        uri: photo.uri,
        name: photo.fileName || `report-${Date.now()}.jpg`,
        type: photo.mimeType || 'image/jpeg',
      } as unknown as Blob);

      const response = await reportsApi.submit(accessToken, form);
      const record = response.data[0];
      if (!record) throw new Error('The report was submitted without a record response.');

      const report = mapCreatedReport(record, details.location, photo.uri);
      onReportCreated(report);
      setReview(reviewData);
      setTicketId(report.id);
      goToStep('success');
    } catch (submitError) {
      Alert.alert(
        'Unable to submit report',
        submitError instanceof Error ? submitError.message : 'Please try again.',
      );
    } finally {
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
        return (
          <ReportLocationScreen
            initialDetails={details}
            onBack={() => goToStep('photo')}
            onContinue={handleLocationContinue}
          />
        );

      case 'review':
        if (!photo || !details) {
          return null;
        }

        return (
          <ReportReviewScreen
            photo={photo}
            details={details}
            initialReview={review}
            onBack={() => goToStep('location')}
            onSubmit={handleSubmit}
          />
        );

      case 'success':
        return (
          <ReportSuccessScreen
            ticketId={ticketId}
            onViewReports={onViewReports}
            onGoHome={onGoHome}
          />
        );
    }
  }

  return (
    <View style={styles.container}>
      {renderStep()}
    </View>
  );
}

function mapCreatedReport(
  record: ReportRecord,
  location: string,
  photoUri: string,
): ResidentReport {
  return {
    id: record.ticket_id,
    title: record.category || 'Community report',
    location,
    date: record.created_at
      ? new Date(record.created_at).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : 'Just now',
    status: 'Pending management review',
    description: record.description,
    category: record.category || 'Uncategorised',
    priority: record.priority || 'Not set',
    photoUri: record.image_url || photoUri,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
