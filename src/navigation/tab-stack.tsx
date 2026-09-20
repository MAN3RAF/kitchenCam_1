import { Stack } from 'expo-router';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/theme/use-theme';

export function TabStack({ title }: { title: string }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
        animation: reducedMotion ? 'none' : 'default',
      }}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
