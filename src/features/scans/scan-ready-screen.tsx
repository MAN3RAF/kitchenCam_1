import { router } from 'expo-router';
import { View } from 'react-native';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useTheme } from '@/theme/use-theme';
import type { ManualScan } from './scan-domain';
import { IngredientSummary, LoadedScan, ScanAccountGate, scanStyles } from './scan-shared';

export function ReadyIngredients({ scan }: { scan: ManualScan }) {
  const { colors } = useTheme();
  return (
    <Screen>
      {scan.state === 'confirmed' && scan.confirmedIngredients ? (
        <>
          <View
            style={[
              scanStyles.card,
              { backgroundColor: colors.successSurface, borderColor: colors.success },
            ]}
          >
            <CircleCheck size={32} color={colors.success} accessible={false} aria-hidden />
            <Text variant="title" accessibilityRole="header">
              Ingredients confirmed
            </Text>
            <Text>Your selection is saved. Come back whenever you’re ready to edit it.</Text>
          </View>
          <Text variant="subheading" accessibilityRole="header">
            Your confirmed ingredients
          </Text>
          <IngredientSummary rows={scan.confirmedIngredients} />
          <Text tone="textSecondary">Recipe suggestions are coming later.</Text>
        </>
      ) : (
        <>
          <Text variant="title" accessibilityRole="header">
            Your list needs confirmation
          </Text>
          <Text>This list has been edited. Review and confirm your selection again.</Text>
        </>
      )}
      <Button
        label="Edit ingredients"
        variant="secondary"
        onPress={() => router.replace(`/scans/${scan.id}`)}
      />
      <Button label="Done" onPress={() => router.replace('/')} />
    </Screen>
  );
}
export function ScanReadyScreen({ id }: { id: string }) {
  return (
    <ScanAccountGate>
      {(session) => (
        <LoadedScan id={id} session={session}>
          {(scan) => <ReadyIngredients scan={scan} />}
        </LoadedScan>
      )}
    </ScanAccountGate>
  );
}
