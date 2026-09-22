import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '@/components/feedback';
import { useConnectivity } from '@/hooks/use-connectivity';
import { layout, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

export function Screen({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const connectivity = useConnectivity();
  const gutter = width >= layout.widePhone ? spacing.xl : spacing.lg;
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scroll}
    >
      <View
        style={[
          styles.content,
          {
            paddingLeft: Math.max(gutter, insets.left),
            paddingRight: Math.max(gutter, insets.right),
            paddingBottom: spacing.xxl + insets.bottom,
          },
        ]}
      >
        {connectivity === 'offline' ? <OfflineBanner /> : null}
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.xxl,
    flexGrow: 1,
  },
});
