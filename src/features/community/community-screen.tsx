import { EmptyState } from '@/components/feedback';
import { Screen } from '@/components/screen';

export function CommunityScreen() {
  return (
    <Screen>
      <EmptyState
        title="Community isn't available yet"
        message="Ratings and reviews aren't available in this build."
      />
    </Screen>
  );
}
