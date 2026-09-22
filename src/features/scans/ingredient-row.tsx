import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { layout, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import type { Ingredient } from './scan-domain';
import { scanStyles } from './scan-shared';

export function IngredientRow({
  row,
  index,
  count,
  disabled,
  canEdit,
  onChange,
  onEdit,
}: {
  row: Ingredient;
  index: number;
  count: number;
  disabled: boolean;
  canEdit: boolean;
  onChange: (operation: 'remove' | 'select' | 'up' | 'down') => void;
  onEdit: () => void;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        scanStyles.card,
        { borderColor: colors.borderSubtle, backgroundColor: colors.surface },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${row.displayName}, ingredient ${index + 1} of ${count}`}
        accessibilityState={{ checked: row.selected, disabled }}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => onChange('select')}
        style={({ pressed }) => [
          styles.selection,
          {
            borderColor: focused ? colors.focusRing : 'transparent',
            backgroundColor: pressed ? colors.actionSecondaryPressed : colors.surface,
          },
        ]}
      >
        <View style={[styles.check, { borderColor: colors.borderStrong }]}>
          {row.selected ? (
            <Check size={20} color={colors.success} accessible={false} aria-hidden />
          ) : null}
        </View>
        <View style={scanStyles.fill}>
          <Text>{row.displayName}</Text>
          <Text variant="supporting" tone="textSecondary">
            {row.selected ? 'Selected' : 'Not selected'}
          </Text>
        </View>
      </Pressable>
      <Button
        label={expanded ? 'Close options' : 'Edit or reorder'}
        variant="secondary"
        disabled={disabled}
        accessibilityLabel={`${expanded ? 'Close options for' : 'Edit or reorder'} ${row.displayName}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded ? (
        <View style={scanStyles.section}>
          <View style={scanStyles.actions}>
            <Button
              label="Rename"
              variant="secondary"
              disabled={disabled || !canEdit}
              accessibilityLabel={`Rename ${row.displayName}`}
              onPress={onEdit}
            />
            <Button
              label="Remove"
              variant="secondary"
              disabled={disabled}
              accessibilityLabel={`Remove ${row.displayName}`}
              onPress={() => onChange('remove')}
            />
          </View>
          <View style={scanStyles.actions}>
            <Button
              label="Move up"
              variant="secondary"
              disabled={disabled || index === 0}
              accessibilityLabel={`Move ${row.displayName} up`}
              onPress={() => onChange('up')}
            />
            <Button
              label="Move down"
              variant="secondary"
              disabled={disabled || index === count - 1}
              accessibilityLabel={`Move ${row.displayName} down`}
              onPress={() => onChange('down')}
            />
          </View>
          {!canEdit ? (
            <Text variant="supporting">
              Finish the name you’re entering before renaming another ingredient.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  selection: {
    minHeight: layout.minTouchTarget,
    borderWidth: 2,
    borderRadius: radii.small,
    padding: spacing.xs,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  check: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderRadius: radii.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
