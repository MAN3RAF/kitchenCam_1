import { EmptyState } from '@/components/feedback';
import { Screen } from '@/components/screen';

export function SavedScreen() {
  return (
    <Screen>
      <EmptyState
        title="Saved recipes aren't available yet"
        message="Saving recipes isn't available in this build."
      />
    </Screen>
  );
}
