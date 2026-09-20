import type { ErrorBoundaryProps } from 'expo-router';
import { ErrorState } from '@/components/feedback';
import { Screen } from '@/components/screen';

export function RouteErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <Screen>
      <ErrorState
        title="This screen couldn't open"
        message="Try opening this screen again."
        retry={() => {
          void retry();
        }}
      />
    </Screen>
  );
}
