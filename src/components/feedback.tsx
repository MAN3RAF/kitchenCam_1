import { ActivityIndicator, StyleSheet, View } from 'react-native';
import AlertCircle from 'lucide-react-native/icons/circle-alert';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

type MessageProps = { title: string; message: string };
type Action = { label: string; onPress: () => void };

export function EmptyState({ title, message, action }: MessageProps & { action?: Action }) {
  return (
    <View style={styles.state}>
      <Text variant="subheading" accessibilityRole="header" aria-level={2}>
        {title}
      </Text>
      <Text tone="textSecondary">{message}</Text>
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" /> : null}
    </View>
  );
}

export function LoadingState({ label }: { label: string }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <View
      style={styles.state}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
    >
      {!reducedMotion ? (
        <ActivityIndicator color={colors.actionPrimary} accessible={false} />
      ) : null}
      <Text>{label}</Text>
    </View>
  );
}

export function ErrorState({ title, message, retry }: MessageProps & { retry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.state}>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={styles.state}
      >
        <AlertCircle color={colors.danger} size={24} accessible={false} aria-hidden />
        <Text variant="subheading" accessibilityRole="header" aria-level={2}>
          {title}
        </Text>
        <Text selectable>{message}</Text>
      </View>
      {retry ? <Button label="Try again" onPress={retry} /> : null}
    </View>
  );
}

export function OfflineBanner() {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.banner, { backgroundColor: colors.warningSurface }]}
      accessibilityLiveRegion="polite"
    >
      <WifiOff color={colors.warning} size={20} accessible={false} aria-hidden />
      <Text style={styles.bannerText} tone="warning">
        {"You're offline. Check your connection."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  state: { gap: spacing.lg, alignItems: 'stretch' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  bannerText: { flex: 1 },
});
