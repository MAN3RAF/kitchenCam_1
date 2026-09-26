import type { ImageReader } from '@/features/capture/image-reader';

// Structural fixtures test admission, not native pixel decoding.
export const concat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((p) => [...p]));
export const be16 = (n: number) => new Uint8Array([n >>> 8, n & 255]);
export const be32 = (n: number) => new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n]);
export const le32 = (n: number) => new Uint8Array([n, n >>> 8, n >>> 16, n >>> 24]);
export const textBytes = (s: string) => new Uint8Array([...s].map((v) => v.charCodeAt(0)));
export function reader(data: Uint8Array): ImageReader {
  return { size: data.length, read: (at, length) => data.slice(at, at + length) };
}
export function exif(orientation: number) {
  return concat(
    textBytes('Exif\0\0MM'),
    be16(42),
    be32(8),
    be16(1),
    be16(0x112),
    be16(3),
    be32(1),
    be16(orientation),
    be16(0),
    be32(0),
  );
}
export const segment = (marker: number, body: Uint8Array) =>
  concat(new Uint8Array([255, marker]), be16(body.length + 2), body);
export function jpeg(width = 800, height = 600, metadata = new Uint8Array(0)) {
  return concat(
    new Uint8Array([255, 216]),
    metadata,
    segment(
      192,
      concat(
        new Uint8Array([8]),
        be16(height),
        be16(width),
        new Uint8Array([3, 1, 17, 0, 2, 17, 0, 3, 17, 0]),
      ),
    ),
    segment(218, new Uint8Array([3, 1, 0, 2, 0, 3, 0, 0, 63, 0])),
    new Uint8Array([1, 2, 255, 0, 3, 255, 217]),
  );
}
export function pngChunk(type: string, body: Uint8Array) {
  const chunk = concat(textBytes(type), body);
  let crc = 0xffffffff;
  for (const value of chunk) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return concat(be32(body.length), chunk, be32((crc ^ 0xffffffff) >>> 0));
}
export function png(width = 800, height = 600, extra = new Uint8Array(0)) {
  return concat(
    textBytes('\x89PNG\r\n\x1a\n'),
    pngChunk('IHDR', concat(be32(width), be32(height), new Uint8Array([8, 6, 0, 0, 0]))),
    extra,
    pngChunk('IDAT', new Uint8Array([1, 2, 3])),
    pngChunk('IEND', new Uint8Array(0)),
  );
}
export function webpChunk(type: string, body: Uint8Array) {
  return concat(textBytes(type), le32(body.length), body, new Uint8Array(body.length % 2));
}
export function webp(width = 800, height = 600, extra = new Uint8Array(0), lossless = false) {
  const image = lossless
    ? webpChunk('VP8L', concat(new Uint8Array([47]), le32((width - 1) | ((height - 1) << 14))))
    : webpChunk(
        'VP8 ',
        new Uint8Array([0, 0, 0, 157, 1, 42, width & 255, width >>> 8, height & 255, height >>> 8]),
      );
  const body = concat(textBytes('WEBP'), image, extra);
  return concat(textBytes('RIFF'), le32(body.length), body);
}
