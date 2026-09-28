import sharp from 'sharp';
import { inspectImage } from './inspection.ts';
import { dimensions, fail, limits } from './policy.ts';
import type { Dimensions } from './policy.ts';

sharp.cache(false);
sharp.concurrency(1);
const options = {
  failOn: 'warning',
  limitInputPixels: limits.pixels,
  limitInputChannels: 4,
  unlimited: false,
  sequentialRead: true,
} as const;
export function inspect(bytes: Buffer) {
  return inspectImage({
    size: bytes.length,
    read: (offset, length) => bytes.subarray(offset, offset + length),
  });
}
export async function encode(bytes: Buffer) {
  const header = inspect(bytes);
  const expected = dimensions(header, header.orientation);
  const meta = await sharp(bytes, options).metadata();
  if (
    meta.format !== header.format ||
    meta.width !== header.width ||
    meta.height !== header.height ||
    (meta.pages ?? 1) !== 1 ||
    (meta.orientation ?? 1) !== header.orientation
  )
    fail('MALFORMED_IMAGE');
  // Full decode precedes resize so truncated trailing pixels cannot be hidden by shrink-on-load.
  // A fresh raw-pixel input severs source metadata from the JPEG encoder.
  const raw = await sharp(bytes, options)
    .autoOrient()
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .timeout({ seconds: 3 })
    .toBuffer({ resolveWithObject: true });
  const oriented =
    header.orientation >= 5 ? { width: header.height, height: header.width } : header;
  if (
    raw.info.width !== oriented.width ||
    raw.info.height !== oriented.height ||
    raw.info.channels !== 3
  )
    fail('DECODE_FAILURE');
  const encoded = await sharp(raw.data, {
    raw: { width: raw.info.width, height: raw.info.height, channels: 3 },
  })
    .resize(expected.width, expected.height, { fit: 'fill', withoutEnlargement: true })
    .jpeg({ quality: 80, chromaSubsampling: '4:2:0', progressive: false })
    .timeout({ seconds: 3 })
    .toBuffer();
  // Even encoder-generated APP/COM blocks are removed. Pixel data are newly encoded above.
  const metadata = inspect(encoded).metadata;
  const segments: Buffer[] = [];
  let cursor = 0;
  for (const range of metadata) {
    segments.push(encoded.subarray(cursor, range.start));
    cursor = range.end;
  }
  segments.push(encoded.subarray(cursor));
  const output = Buffer.concat(segments);
  await verify(output, expected);
  return output;
}
export async function verify(bytes: Buffer, expected?: Dimensions) {
  if (!bytes.length || bytes.length > limits.outputBytes) fail('OUTPUT_VERIFICATION');
  const info = inspect(bytes);
  if (
    info.format !== 'jpeg' ||
    info.metadata.length ||
    info.orientation !== 1 ||
    Math.min(info.width, info.height) < limits.shortEdge ||
    Math.max(info.width, info.height) > limits.longEdge ||
    (expected && (info.width !== expected.width || info.height !== expected.height))
  )
    fail('OUTPUT_VERIFICATION');
  const meta = await sharp(bytes, options).metadata();
  if (
    meta.format !== 'jpeg' ||
    ['exif', 'xmp', 'iptc', 'icc', 'orientation', 'comments'].some((key) => key in meta)
  )
    fail('OUTPUT_VERIFICATION');
  const decoded = await sharp(bytes, options)
    .raw()
    .timeout({ seconds: 3 })
    .toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== info.width ||
    decoded.info.height !== info.height ||
    decoded.info.channels !== 3
  )
    fail('OUTPUT_VERIFICATION');
  return { width: info.width, height: info.height };
}
