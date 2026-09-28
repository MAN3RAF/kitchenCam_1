export const limits = Object.freeze({
  inputBytes: 25 * 1024 * 1024,
  pixels: 12_000_000,
  metadataBytes: 65536,
  outputBytes: 4 * 1024 * 1024,
  longEdge: 2048,
  shortEdge: 256,
  wallMs: 5000,
  memoryMiB: 192,
  cpuSeconds: 4,
  pids: 32,
});
export type Category =
  | 'UNSUPPORTED_FORMAT'
  | 'MALFORMED_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'UNREADABLE'
  | 'PATH_INVALID'
  | 'DECODE_FAILURE'
  | 'TIMEOUT'
  | 'RESOURCE_LIMIT'
  | 'STALE_REVISION'
  | 'CANCELLED'
  | 'OUTPUT_VERIFICATION'
  | 'INTERNAL'
  | 'BUSY';
export class Failure extends Error {
  readonly category: Category;
  constructor(category: Category) {
    super(category);
    this.category = category;
  }
}
export function fail(category: Category): never {
  throw new Failure(category);
}
export type Dimensions = { width: number; height: number };
export function checkPixels({ width, height }: Dimensions) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) fail('MALFORMED_IMAGE');
  if (width * height > limits.pixels) fail('IMAGE_TOO_LARGE');
}
export function dimensions(info: Dimensions, orientation: number): Dimensions {
  checkPixels(info);
  const w = orientation >= 5 ? info.height : info.width;
  const h = orientation >= 5 ? info.width : info.height;
  const scale = Math.min(1, limits.longEdge / Math.max(w, h));
  const result = { width: Math.round(w * scale), height: Math.round(h * scale) };
  if (Math.min(result.width, result.height) < limits.shortEdge) fail('IMAGE_TOO_LARGE');
  return result;
}
export const version = 'phase-f-v1';
