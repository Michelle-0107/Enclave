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

type Props = {
  onGoHome: () => void;
  onStepChange?: () => void;
};

type Step = 'photo' | 'location' | 'review' | 'success';

export default function ReportScreen({
  onGoHome,
  onStepChange,
}: Props) {
  const [step, setStep] = useState<Step>('photo');

  const [photo, setPhoto] = useState<
    ImagePickerAsset | undefined
  >();

  const [details, setDetails] = useState<
    ReportLocationDetails | undefined
  >();

  const [review, setReview] = useState<
    ReportReviewData | undefined
  >();

  const [ticketId, setTicketId] = useState('');

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

  function handleSubmit(reviewData: ReportReviewData) {
    if (!photo || !details) {
      Alert.alert(
        'Missing report details',
        'Please add a photo and location first.',
      );

      goToStep(!photo ? 'photo' : 'location');
      return;
    }

    setReview(reviewData);

    // Frontend demo only.
    // Backend will return the real ticket ID later.
    setTicketId(
      `DEMO-${Date.now().toString().slice(-6)}`,
    );

    goToStep('success');
  }

  function handleViewReports() {
    Alert.alert(
      'My reports',
      'The report list will be connected next.',
    );
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
            isDemo
            onViewReports={handleViewReports}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});