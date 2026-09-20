import { AuthFlowError, mapAuthError } from '@/features/auth/auth-errors';
import { getBackendClient } from '@/services/backend/client';

export type PreferenceMergeReview = Readonly<{
  id: string;
  guestMeasurementSystem: 'metric' | 'us';
  guestDefaultServings: number;
  guestNotificationsEnabled: boolean;
  currentMeasurementSystem: 'metric' | 'us';
  currentDefaultServings: number;
  currentNotificationsEnabled: boolean;
}>;

export async function getPendingPreferenceReview(): Promise<PreferenceMergeReview | null> {
  const client = getBackendClient();
  if (!client) throw new AuthFlowError('AUTH_UNAVAILABLE', 'Account settings are unavailable.');
  const [reviewResult, preferencesResult] = await Promise.all([
    client
      .from('preference_merge_reviews')
      .select('id,guest_measurement_system,guest_default_servings,guest_notifications_enabled')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('user_preferences')
      .select('measurement_system,default_servings,notifications_enabled')
      .single(),
  ]);
  if (reviewResult.error) throw mapAuthError(reviewResult.error);
  if (!reviewResult.data) return null;
  if (preferencesResult.error || !preferencesResult.data) {
    throw mapAuthError(preferencesResult.error);
  }
  return {
    id: reviewResult.data.id as string,
    guestMeasurementSystem: reviewResult.data.guest_measurement_system as 'metric' | 'us',
    guestDefaultServings: reviewResult.data.guest_default_servings as number,
    guestNotificationsEnabled: reviewResult.data.guest_notifications_enabled as boolean,
    currentMeasurementSystem: preferencesResult.data.measurement_system as 'metric' | 'us',
    currentDefaultServings: preferencesResult.data.default_servings as number,
    currentNotificationsEnabled: preferencesResult.data.notifications_enabled as boolean,
  };
}

export async function resolvePreferenceReview(reviewId: string, useGuestValues: boolean) {
  const client = getBackendClient();
  if (!client) throw new AuthFlowError('AUTH_UNAVAILABLE', 'Account settings are unavailable.');
  const { error } = await client.rpc('resolve_preference_merge', {
    p_review_id: reviewId,
    p_use_guest_values: useGuestValues,
  });
  if (error) throw mapAuthError(error);
}
