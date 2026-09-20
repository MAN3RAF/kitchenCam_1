import { useRouter } from 'expo-router';
import Camera from 'lucide-react-native/icons/camera';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Screen>
      <View style={styles.section}>
        <Text variant="title" accessibilityRole="header" aria-level={2}>
          Your kitchen
        </Text>
        <Button
          label="Scan ingredients"
          disabled
          icon={<Camera size={24} color={colors.textDisabled} accessible={false} aria-hidden />}
          accessibilityHint="Ingredient scanning is not available in this build."
        />
        <Text tone="textSecondary">{"Ingredient scanning isn't available in this build."}</Text>
      </View>
      <View style={[styles.section, styles.sectionBorder, { borderColor: colors.divider }]}>
        <Text variant="subheading" accessibilityRole="header" aria-level={2}>
          Recipes
        </Text>
        <Button
          label="Browse recipes"
          variant="secondary"
          onPress={() => router.navigate('/recipes')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.lg },
  sectionBorder: { borderTopWidth: 1, paddingTop: spacing.xl },
});
