import { preparationLimits } from './preparation-policy';

/** Choose an enumerated native still size that the existing source policy can admit. */
export function captureSize(sizes: readonly string[]): string | undefined {
  let selected: string | undefined;
  let selectedPixels = 0;
  for (const size of sizes) {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const pixels = width * height;
    if (
      Number.isSafeInteger(pixels) &&
      Math.min(width, height) >= preparationLimits.shortEdge &&
      pixels <= preparationLimits.sourcePixels &&
      pixels > selectedPixels
    ) {
      selected = size;
      selectedPixels = pixels;
    }
  }
  return selected;
}
