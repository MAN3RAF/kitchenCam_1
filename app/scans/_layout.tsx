import { Stack } from 'expo-router';
import { PhotoProvider } from '@/features/capture/photo-provider';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/theme/use-theme';

export { RouteErrorBoundary as ErrorBoundary } from '@/navigation/route-error-boundary';
export default function ScanLayout() {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <PhotoProvider>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          contentStyle: { backgroundColor: colors.background },
          animation: reducedMotion ? 'none' : 'default',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Ingredients' }} />
        <Stack.Screen name="camera" options={{ title: 'Camera' }} />
        <Stack.Screen name="gallery" options={{ title: 'Photo Library' }} />
        <Stack.Screen name="preview" options={{ title: 'Preview' }} />
        <Stack.Screen name="manual" options={{ title: 'Add ingredients' }} />
        <Stack.Screen name="[id]/index" options={{ title: 'Your ingredients' }} />
        <Stack.Screen name="[id]/confirm" options={{ title: 'Review selection' }} />
        <Stack.Screen name="[id]/ready" options={{ title: 'Confirmed ingredients' }} />
      </Stack>
    </PhotoProvider>
  );
}
