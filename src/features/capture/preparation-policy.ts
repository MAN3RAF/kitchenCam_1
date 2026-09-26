import type { LocalPhoto } from './photo-session';

export const preparationLimits = {
  sourceBytes: 25 * 1024 * 1024,
  sourcePixels: 12_000_000,
  longEdge: 2048,
  shortEdge: 256,
  outputBytes: 4 * 1024 * 1024,
  metadataBytes: 64 * 1024,
} as const;
export const jpegQualities = [0.8, 0.7, 0.6] as const;
export type Dimensions = Readonly<{ width: number; height: number }>;
export type PreparedPhoto = Dimensions &
  Readonly<{
    uri: string;
    mimeType: 'image/jpeg';
    size: number;
    revision: string;
    sourceRevision: string;
    appOwned: true;
  }>;
export interface PhotoPreparation {
  admit(source: LocalPhoto): Promise<void>;
  prepare(source: LocalPhoto, revision: string, current: () => boolean): Promise<PreparedPhoto>;
  remove(photo: PreparedPhoto): Promise<void>;
}
const messages = {
  UNREADABLE: 'This photo can’t be opened. Retake it or choose another photo.',
  SOURCE_TOO_LARGE: 'This photo is too large. Choose a photo smaller than 25 MiB.',
  PIXEL_LIMIT:
    'This photo’s resolution is too high to prepare safely. Choose one up to 12 megapixels.',
  UNSUPPORTED: 'Choose a JPEG, PNG, or still WebP photo instead.',
  INVALID: 'This photo can’t be prepared. Choose another photo or enter ingredients manually.',
  DIMENSIONS: 'Choose a larger photo with a less narrow shape.',
  OUTPUT_TOO_LARGE: 'The prepared photo is still too large. Choose another photo.',
  UNAVAILABLE: 'Photo preparation isn’t available in this build. Enter ingredients manually.',
  BUSY: 'Another photo is finishing preparation. Try again shortly or enter ingredients manually.',
  CANCELLED: 'Photo preparation was cancelled.',
} as const;
export class PreparationError extends Error {
  constructor(public readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
export function checkPixels({ width, height }: Dimensions) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new PreparationError('INVALID');
  if (width * height > preparationLimits.sourcePixels) throw new PreparationError('PIXEL_LIMIT');
}
export function preparedDimensions(source: Dimensions, orientation = 1): Dimensions {
  checkPixels(source);
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8)
    throw new PreparationError('INVALID');
  const width = orientation >= 5 ? source.height : source.width;
  const height = orientation >= 5 ? source.width : source.height;
  const scale = Math.min(1, preparationLimits.longEdge / Math.max(width, height));
  const result = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (Math.min(result.width, result.height) < preparationLimits.shortEdge)
    throw new PreparationError('DIMENSIONS');
  return result;
}

/** Maps raw normalized coordinates to upright coordinates; applied once to raw decoded pixels. */
export function orientationMatrix(orientation: number): readonly number[] {
  const matrices = [
    [1, 0, 0, 1, 0, 0],
    [-1, 0, 0, 1, 1, 0],
    [-1, 0, 0, -1, 1, 1],
    [1, 0, 0, -1, 0, 1],
    [0, 1, 1, 0, 0, 0],
    [0, 1, -1, 0, 1, 0],
    [0, -1, -1, 0, 1, 1],
    [0, -1, 1, 0, 0, 1],
  ];
  const matrix = matrices[orientation - 1];
  if (!matrix) throw new PreparationError('INVALID');
  return matrix;
}
