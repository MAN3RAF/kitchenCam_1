import { Stack } from 'expo-router';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/theme/use-theme';

export default function AuthLayout() {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
        presentation: 'modal',
        animation: reducedMotion ? 'none' : 'default',
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="verify" options={{ title: 'Verify email' }} />
      <Stack.Screen name="callback" options={{ title: 'Completing sign in' }} />
      <Stack.Screen name="review-preferences" options={{ title: 'Review preferences' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
    </Stack>
  );
}
