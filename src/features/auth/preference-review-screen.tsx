import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import {
  getPendingPreferenceReview,
  resolvePreferenceReview,
  type PreferenceMergeReview,
} from '@/features/auth/preference-merge-service';
import { spacing } from '@/theme/tokens';

function describe(measurement: 'metric' | 'us', servings: number, notifications: boolean) {
  return `${measurement === 'metric' ? 'Metric' : 'US'} units, ${servings} default servings, notifications ${notifications ? 'on' : 'off'}`;
}

export function PreferenceReviewScreen() {
  const [review, setReview] = useState<PreferenceMergeReview | null>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const pendingReview = await getPendingPreferenceReview();
      setReview(pendingReview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Preferences could not be loaded.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getPendingPreferenceReview()
      .then((pendingReview) => {
        if (active) setReview(pendingReview);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Preferences could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <Screen>
        <ErrorState
          title="Preferences unavailable"
          message={error}
          retry={() => {
            setError(undefined);
            void load();
          }}
        />
      </Screen>
    );
  }
  if (review === undefined) {
    return (
      <Screen>
        <LoadingState label="Loading merged preferences" />
      </Screen>
    );
  }
  if (review === null) {
    return (
      <Screen>
        <EmptyState
          title="Preferences are up to date"
          message="There are no guest preferences waiting for review."
          action={{ label: 'Return to profile', onPress: () => router.replace('/profile') }}
        />
      </Screen>
    );
  }

  const resolve = async (useGuestValues: boolean) => {
    setSubmitting(true);
    setError(undefined);
    try {
      await resolvePreferenceReview(review.id, useGuestValues);
      router.replace('/profile');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Preferences could not be updated.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="heading" accessibilityRole="header">
          Review preferences
        </Text>
        <Text tone="textSecondary">
          Your account settings were kept. Choose whether to replace them with the guest settings.
        </Text>
        <View style={styles.option}>
          <Text variant="subheading">Account settings</Text>
          <Text>
            {describe(
              review.currentMeasurementSystem,
              review.currentDefaultServings,
              review.currentNotificationsEnabled,
            )}
          </Text>
          <Button
            label="Keep account settings"
            disabled={submitting}
            onPress={() => void resolve(false)}
          />
        </View>
        <View style={styles.option}>
          <Text variant="subheading">Guest settings</Text>
          <Text>
            {describe(
              review.guestMeasurementSystem,
              review.guestDefaultServings,
              review.guestNotificationsEnabled,
            )}
          </Text>
          <Button
            label="Use guest settings"
            variant="secondary"
            disabled={submitting}
            onPress={() => void resolve(true)}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  option: { gap: spacing.md },
});
