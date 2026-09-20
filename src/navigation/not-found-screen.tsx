import { useRouter } from 'expo-router';
import { EmptyState } from '@/components/feedback';
import { Screen } from '@/components/screen';

export function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        title="Page not found"
        message="This page isn't available."
        action={{ label: 'Go home', onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
