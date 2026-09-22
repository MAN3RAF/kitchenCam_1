import { Stack } from 'expo-router';
import { AppProviders } from '@/lib/app-providers';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export { RouteErrorBoundary as ErrorBoundary } from '@/navigation/route-error-boundary';

export default function RootLayout() {
  const reducedMotion = useReducedMotion();
  return (
    <AppProviders>
      <Stack screenOptions={{ animation: reducedMotion ? 'none' : 'default' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="scans" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" options={{ title: 'Page not found' }} />
      </Stack>
    </AppProviders>
  );
}
