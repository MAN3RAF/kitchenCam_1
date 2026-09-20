import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ErrorState, LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-provider';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function MagicLinkCallbackScreen() {
  const parameters = useLocalSearchParams<{
    code?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
  }>();
  const { completeMagicLink } = useAuth();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void completeMagicLink({
      code: first(parameters.code),
      tokenHash: first(parameters.token_hash),
      type: first(parameters.type),
    })
      .then((result) => {
        if (active) {
          router.replace(result.preferenceReviewRequired ? '/review-preferences' : '/profile');
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'The link could not be verified.');
      });
    return () => {
      active = false;
    };
  }, [completeMagicLink, parameters.code, parameters.token_hash, parameters.type]);

  return (
    <Screen>
      {error ? (
        <ErrorState
          title="Sign-in link unavailable"
          message={error}
          retry={() => router.replace('/sign-in')}
        />
      ) : (
        <LoadingState label="Completing sign in" />
      )}
    </Screen>
  );
}
