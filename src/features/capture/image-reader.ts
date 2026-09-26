import { PreparationError } from './preparation-policy';

/** Random-access bounded reads. Never holds an entire encoded file in JS. */
export interface ImageReader {
  size: number;
  read(offset: number, length: number): Uint8Array;
}
export function bytes(reader: ImageReader, offset: number, length: number): Uint8Array {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    length > 65536 ||
    offset + length > reader.size
  )
    throw new PreparationError('INVALID');
  const result = reader.read(offset, length);
  if (result.length !== length) throw new PreparationError('UNREADABLE');
  return result;
}
export const u16 = (b: Uint8Array, at: number, little = false) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(at, little);
export const u32 = (b: Uint8Array, at: number, little = false) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, little);
export const ascii = (b: Uint8Array, at = 0, length = b.length) =>
  String.fromCharCode(...b.subarray(at, at + length));

/** Read only IFD0 orientation, never GPS, thumbnails, strings or nested metadata. */
export function exifOrientation(data: Uint8Array): number {
  const b = ascii(data, 0, 6) === 'Exif\0\0' ? data.subarray(6) : data;
  if (b.length < 8) throw new PreparationError('INVALID');
  const endian = ascii(b, 0, 2);
  if (endian !== 'II' && endian !== 'MM') throw new PreparationError('INVALID');
  const little = endian === 'II';
  if (u16(b, 2, little) !== 42) throw new PreparationError('INVALID');
  const offset = u32(b, 4, little);
  if (offset < 8 || offset + 2 > b.length) throw new PreparationError('INVALID');
  const count = u16(b, offset, little);
  if (count > 128 || offset + 2 + count * 12 + 4 > b.length) throw new PreparationError('INVALID');
  let orientation = 1;
  let found = false;
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (u16(b, at, little) !== 0x112) continue;
    if (found || u16(b, at + 2, little) !== 3 || u32(b, at + 4, little) !== 1)
      throw new PreparationError('INVALID');
    found = true;
    orientation = u16(b, at + 8, little);
    if (orientation < 1 || orientation > 8) throw new PreparationError('INVALID');
  }
  return orientation;
}
