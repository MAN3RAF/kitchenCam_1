import type { PropsWithChildren } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ConnectivityProvider } from '@/hooks/use-connectivity';
import { AuthProvider } from '@/features/auth/auth-provider';
import '@/config/public-env';
import { useTheme } from '@/theme/use-theme';

export function AppProviders({ children }: PropsWithChildren) {
  const { colors, isDark } = useTheme();
  const base = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.actionPrimary,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.borderSubtle,
      notification: colors.danger,
    },
  };
  return (
    <ThemeProvider value={navigationTheme}>
      <ConnectivityProvider>
        <AuthProvider>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          {children}
        </AuthProvider>
      </ConnectivityProvider>
    </ThemeProvider>
  );
}
