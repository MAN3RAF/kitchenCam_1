import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Text } from '@/components/text';
import { layout, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export function TextField({ label, error, style, ...props }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text variant="supporting">{label}</Text>
      <TextInput
        {...props}
        allowFontScaling
        accessibilityLabel={props.accessibilityLabel ?? label}
        aria-invalid={Boolean(error)}
        placeholderTextColor={colors.textDisabled}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.borderStrong,
            color: colors.textPrimary,
          },
          style,
        ]}
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  input: {
    minHeight: layout.minTouchTarget,
    borderWidth: 1,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    lineHeight: 24,
  },
});
