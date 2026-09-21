const sharp = require('sharp');
const { inspect, ImageFailure } = require('./image-inspection.cjs');

sharp.cache(false);
sharp.concurrency(1);
const reject = (code) => {
  throw new ImageFailure(code);
};

async function sanitize(bytes, { mime, mode = 'sanitize' }) {
  const source = ['prepare-reference', 'prepare-candidate-24mp'].includes(mode);
  if (!source && mode !== 'sanitize') reject('MODE_INVALID');
  const maxBytes = (source ? 25 : 4) * 1024 * 1024;
  const maxPixels = source
    ? mode === 'prepare-candidate-24mp'
      ? 24_000_000
      : 12_000_000
    : 2048 * 2048;
  if (bytes.length > maxBytes) reject('BYTE_LIMIT');
  const header = inspect(bytes);
  if (mime !== `image/${header.format === 'jpeg' ? 'jpeg' : header.format}`)
    reject('MIME_MISMATCH');
  const bounds = (width, height) => {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 256 ||
      height < 256 ||
      width * height > maxPixels ||
      (!source && Math.max(width, height) > 2048)
    )
      reject('DIMENSION_LIMIT');
  };
  if (header.width !== undefined) bounds(header.width, header.height);
  const options = {
    failOn: 'warning',
    limitInputPixels: maxPixels,
    limitInputChannels: 4,
    unlimited: false,
    sequentialRead: true,
  };
  const metadata = await sharp(bytes, options).metadata();
  if (metadata.format !== header.format || (metadata.pages ?? 1) !== 1) reject('FORMAT_MISMATCH');
  bounds(metadata.width, metadata.height);
  // Full bounded decode before creating output, so metadata-only success cannot approve input.
  const pixels = await sharp(bytes, options)
    .autoOrient()
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .timeout({ seconds: 3 })
    .toBuffer({ resolveWithObject: true });
  const output = await sharp(pixels.data, {
    raw: { width: pixels.info.width, height: pixels.info.height, channels: pixels.info.channels },
  })
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .timeout({ seconds: 3 })
    .toBuffer();
  if (output.length > 4 * 1024 * 1024) reject('OUTPUT_BYTE_LIMIT');
  const verified = inspect(output);
  if (
    verified.format !== 'jpeg' ||
    verified.width < 256 ||
    verified.height < 256 ||
    verified.width > 2048 ||
    verified.height > 2048
  )
    reject('OUTPUT_INVALID');
  const outputMetadata = await sharp(output, options).metadata();
  if (
    ['exif', 'xmp', 'iptc', 'icc', 'orientation'].some((key) => outputMetadata[key] !== undefined)
  )
    reject('OUTPUT_METADATA');
  await sharp(output, options).raw().toBuffer();
  return {
    output,
    width: verified.width,
    height: verified.height,
    inputHadExif: Boolean(metadata.exif),
    metadataAbsent: true,
  };
}

module.exports = { sanitize };
