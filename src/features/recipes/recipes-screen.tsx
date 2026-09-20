import { EmptyState } from '@/components/feedback';
import { Screen } from '@/components/screen';

export function RecipesScreen() {
  return (
    <Screen>
      <EmptyState
        title="Recipes aren't available yet"
        message="Recipe browsing isn't available in this build."
      />
    </Screen>
  );
}
