import { useColorScheme } from 'react-native';
import { colors, type ThemeColors } from '@/theme/tokens';

export function useTheme(): { colors: ThemeColors; isDark: boolean } {
  const isDark = useColorScheme() === 'dark';
  return { colors: isDark ? colors.dark : colors.light, isDark };
}
