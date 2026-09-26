import { ascii, bytes, exifOrientation, u16, u32, type ImageReader } from './image-reader';
import {
  checkPixels,
  PreparationError,
  preparationLimits,
  type Dimensions,
} from './preparation-policy';

export type ImageInfo = Dimensions & {
  format: 'jpeg' | 'png' | 'webp';
  orientation: number;
  metadata: { start: number; end: number }[];
};
const invalid = (): never => {
  throw new PreparationError('INVALID');
};
const unsupported = (): never => {
  throw new PreparationError('UNSUPPORTED');
};

export function inspectImage(reader: ImageReader, hint?: string): ImageInfo {
  if (!reader.size) throw new PreparationError('UNREADABLE');
  if (reader.size > preparationLimits.sourceBytes) throw new PreparationError('SOURCE_TOO_LARGE');
  const header = bytes(reader, 0, 12);
  const info =
    header[0] === 255 && header[1] === 216
      ? jpeg(reader)
      : ascii(header, 0, 8) === '\x89PNG\r\n\x1a\n'
        ? png(reader)
        : ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 4) === 'WEBP'
          ? webp(reader)
          : unsupported();
  if (hint && hint !== `image/${info.format}`) unsupported();
  checkPixels(info);
  return info;
}
function jpeg(reader: ImageReader): ImageInfo {
  let cursor = 2,
    scans = 0,
    count = 0,
    budget = 0,
    orientation = 1;
  let dimensions: Dimensions | undefined;
  let exif = false;
  const metadata: ImageInfo['metadata'] = [];
  // Entropy scan uses bounded blocks, not a native call per byte.
  let block: Uint8Array = new Uint8Array(0),
    blockAt = -1;
  const byte = (at: number): number => {
    if (at < 0 || at >= reader.size) return invalid();
    if (at < blockAt || at >= blockAt + block.length) {
      blockAt = at;
      block = bytes(reader, at, Math.min(16384, reader.size - at));
    }
    return block[at - blockAt]!;
  };
  while (cursor < reader.size && ++count <= 8192) {
    const start = cursor;
    if (byte(cursor++) !== 255) invalid();
    while (byte(cursor) === 255) cursor++;
    const marker = byte(cursor++);
    if (marker === 217) {
      if (cursor !== reader.size || !dimensions || !scans) invalid();
      return { ...dimensions!, format: 'jpeg', orientation, metadata };
    }
    if (marker === 0 || marker === 216 || (marker >= 208 && marker <= 215)) invalid();
    const length = u16(bytes(reader, cursor, 2), 0);
    if (length < 2 || cursor + length > reader.size) invalid();
    if ((marker >= 224 && marker <= 239) || marker === 254) {
      budget += length;
      if (budget > preparationLimits.metadataBytes) invalid();
      metadata.push({ start, end: cursor + length });
      if (marker === 225 && length >= 8 && ascii(bytes(reader, cursor + 2, 6)) === 'Exif\0\0') {
        if (exif) invalid();
        exif = true;
        orientation = exifOrientation(bytes(reader, cursor + 2, length - 2));
      }
    }
    if ([192, 193, 194].includes(marker)) {
      if (dimensions || length < 8) invalid();
      const frame = bytes(reader, cursor + 2, length - 2);
      if (frame[0] !== 8 || ![1, 3].includes(frame[5]!) || length !== 8 + frame[5]! * 3)
        unsupported();
      dimensions = { width: u16(frame, 3), height: u16(frame, 1) };
      checkPixels(dimensions);
    } else if (marker >= 192 && marker <= 207 && ![196].includes(marker)) unsupported();
    cursor += length;
    if (marker === 218) {
      if (!dimensions) invalid();
      scans++;
      while (cursor < reader.size) {
        if (byte(cursor) !== 255) {
          cursor++;
          continue;
        }
        const next = byte(cursor + 1);
        if (next === 0 || (next >= 208 && next <= 215)) {
          cursor += 2;
          continue;
        }
        break;
      }
    }
  }
  return invalid();
}
function png(reader: ImageReader): ImageInfo {
  let cursor = 8,
    count = 0,
    budget = 0,
    orientation = 1;
  let dimensions: Dimensions | undefined,
    data = false,
    exif = false;
  const allowed = [
    'IHDR',
    'PLTE',
    'IDAT',
    'IEND',
    'tRNS',
    'sRGB',
    'gAMA',
    'cHRM',
    'pHYs',
    'bKGD',
    'tIME',
    'tEXt',
    'eXIf',
  ];
  while (cursor + 12 <= reader.size && ++count <= 8192) {
    const head = bytes(reader, cursor, 8),
      length = u32(head, 0),
      type = ascii(head, 4, 4);
    const end = cursor + length + 12;
    if (end > reader.size) invalid();
    if (!allowed.includes(type)) unsupported(); // Includes animation and compressed metadata.
    if (type !== 'IDAT') budget += length;
    if (budget > preparationLimits.metadataBytes) invalid();
    if (!dimensions && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (dimensions || length !== 13) invalid();
      const header = bytes(reader, cursor + 8, 13);
      dimensions = { width: u32(header, 0), height: u32(header, 4) };
      checkPixels(dimensions);
      if (header[10] !== 0 || header[11] !== 0 || header[12]! > 1) unsupported();
    }
    if (type === 'eXIf') {
      if (exif) invalid();
      exif = true;
      orientation = exifOrientation(bytes(reader, cursor + 8, length));
    }
    // Validate CRC without retaining compressed pixels or expanding metadata.
    let crc = 0xffffffff;
    for (let at = cursor + 4; at < end - 4;) {
      const part = bytes(reader, at, Math.min(16384, end - 4 - at));
      for (const value of part) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      at += part.length;
    }
    if ((crc ^ 0xffffffff) >>> 0 !== u32(bytes(reader, end - 4, 4), 0)) invalid();
    if (type === 'IDAT') data = true;
    if (type === 'IEND') {
      if (length || end !== reader.size || !data || !dimensions) invalid();
      return { ...dimensions!, format: 'png', orientation, metadata: [] };
    }
    cursor = end;
  }
  return invalid();
}
function webp(reader: ImageReader): ImageInfo {
  if (u32(bytes(reader, 4, 4), 0, true) + 8 !== reader.size) invalid();
  let cursor = 12,
    count = 0,
    budget = 0,
    orientation = 1,
    exif = false;
  let dimensions: Dimensions | undefined, canvas: Dimensions | undefined;
  while (cursor + 8 <= reader.size && ++count <= 128) {
    const head = bytes(reader, cursor, 8),
      type = ascii(head, 0, 4),
      length = u32(head, 4, true);
    const end = cursor + 8 + length + (length % 2);
    if (end > reader.size) invalid();
    if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'EXIF', 'XMP ', 'ICCP'].includes(type)) unsupported();
    const b = bytes(reader, cursor + 8, Math.min(length, 10));
    if (type === 'VP8X') {
      if (canvas || cursor !== 12 || length !== 10 || b[0]! & 2) unsupported();
      const n24 = (at: number) => 1 + b[at]! + b[at + 1]! * 256 + b[at + 2]! * 65536;
      canvas = { width: n24(4), height: n24(7) };
      checkPixels(canvas);
    }
    if (type === 'VP8 ' || type === 'VP8L') {
      if (dimensions) invalid();
      if (type === 'VP8 ') {
        if (length < 10 || b[0]! & 1 || b[3] !== 157 || b[4] !== 1 || b[5] !== 42) invalid();
        dimensions = { width: u16(b, 6, true) & 16383, height: u16(b, 8, true) & 16383 };
      } else {
        if (length < 5 || b[0] !== 47 || b[4]! >> 5 !== 0) invalid();
        const bits = u32(b, 1, true);
        dimensions = { width: 1 + (bits & 16383), height: 1 + ((bits >>> 14) & 16383) };
      }
      checkPixels(dimensions);
    }
    if (['EXIF', 'XMP ', 'ICCP'].includes(type)) {
      budget += length;
      if (budget > preparationLimits.metadataBytes) invalid();
      if (type === 'EXIF') {
        if (exif) invalid();
        exif = true;
        orientation = exifOrientation(bytes(reader, cursor + 8, length));
      }
    }
    cursor = end;
  }
  if (
    cursor !== reader.size ||
    !dimensions ||
    (canvas && (canvas.width !== dimensions.width || canvas.height !== dimensions.height))
  )
    invalid();
  return { ...dimensions!, format: 'webp', orientation, metadata: [] };
}
