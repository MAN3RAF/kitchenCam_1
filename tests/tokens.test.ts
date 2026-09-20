import { colors } from '@/theme/tokens';

function luminance(hex: string) {
  const channels = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

test.each(['light', 'dark'] as const)(
  '%s theme meets AA for normal text and meaningful controls',
  (theme) => {
    const palette = colors[theme];
    for (const surface of ['background', 'surface', 'surfaceRaised'] as const) {
      for (const text of ['textPrimary', 'textSecondary', 'link'] as const) {
        expect(contrast(palette[text], palette[surface])).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(palette.focusRing, palette[surface])).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.borderStrong, palette[surface])).toBeGreaterThanOrEqual(3);
    }
    for (const action of ['actionPrimary', 'actionPrimaryPressed'] as const) {
      expect(contrast(palette.textOnAction, palette[action])).toBeGreaterThanOrEqual(4.5);
    }
    for (const status of ['success', 'warning', 'danger', 'info'] as const) {
      expect(contrast(palette[status], palette[`${status}Surface`])).toBeGreaterThanOrEqual(4.5);
    }
  },
);
