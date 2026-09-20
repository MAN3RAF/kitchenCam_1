import { Text as NativeText, type TextProps } from 'react-native';
import { typography, type ColorToken } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

type Props = TextProps & { variant?: keyof typeof typography; tone?: ColorToken };

export function Text({ variant = 'body', tone = 'textPrimary', style, ...props }: Props) {
  const { colors } = useTheme();
  return (
    <NativeText
      {...props}
      allowFontScaling
      style={[typography[variant], { color: colors[tone], letterSpacing: 0 }, style]}
    />
  );
}
