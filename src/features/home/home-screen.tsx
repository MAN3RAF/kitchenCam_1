import { useRouter } from 'expo-router';
import ListPlus from 'lucide-react-native/icons/list-plus';
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
          label="Add ingredients"
          onPress={() => router.push('/scans')}
          icon={<ListPlus size={24} color={colors.textOnAction} accessible={false} aria-hidden />}
          accessibilityHint="Start or resume a saved ingredient list."
        />
        <Text tone="textSecondary">
          Start with what you have. Add ingredients by hand and save your selection.
        </Text>
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
