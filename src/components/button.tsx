import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { Text } from '@/components/text';
import { layout, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary';
  icon?: ReactNode;
};

export function Button({
  label,
  variant = 'primary',
  icon,
  disabled,
  onFocus,
  onBlur,
  ...props
}: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...props}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? label}
      accessibilityState={{ ...props.accessibilityState, disabled: Boolean(disabled) }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: focused ? colors.focusRing : 'transparent',
          backgroundColor: disabled
            ? colors.actionSecondary
            : variant === 'primary'
              ? pressed
                ? colors.actionPrimaryPressed
                : colors.actionPrimary
              : pressed
                ? colors.actionSecondaryPressed
                : colors.actionSecondary,
        },
      ]}
    >
      {icon ? (
        <View
          accessible={false}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {icon}
        </View>
      ) : null}
      <Text
        style={styles.label}
        tone={disabled ? 'textDisabled' : variant === 'primary' ? 'textOnAction' : 'textPrimary'}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    borderWidth: 2,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: { flexShrink: 1, textAlign: 'center', fontWeight: '600' },
});
