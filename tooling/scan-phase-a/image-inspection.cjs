const { Buffer } = require('node:buffer');

class ImageFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code = 'IMAGE_INVALID') => {
  throw new ImageFailure(code);
};
const metadataLimit = 64 * 1024;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectJpeg(bytes) {
  let cursor = 2;
  let metadata = 0;
  let dimensions;
  let scans = 0;
  while (cursor < bytes.length) {
    if (bytes[cursor++] !== 0xff) fail();
    while (bytes[cursor] === 0xff) cursor++;
    const marker = bytes[cursor++];
    if (marker === 0xd9) {
      if (cursor !== bytes.length) fail('APPENDED_PAYLOAD');
      if (!dimensions || scans === 0) fail();
      return { format: 'jpeg', ...dimensions, metadataBytes: metadata };
    }
    if (
      marker === undefined ||
      marker === 0xd8 ||
      marker === 0x00 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      fail();
    if (cursor + 2 > bytes.length) fail();
    const length = bytes.readUInt16BE(cursor);
    if (length < 2 || cursor + length > bytes.length) fail();
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) metadata += length;
    if (metadata > metadataLimit) fail('METADATA_LIMIT');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (dimensions || length < 8) fail();
      dimensions = {
        height: bytes.readUInt16BE(cursor + 3),
        width: bytes.readUInt16BE(cursor + 5),
      };
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      fail('UNSUPPORTED_ENCODING');
    cursor += length;
    if (marker === 0xda) {
      scans++;
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) {
          cursor++;
          continue;
        }
        const next = bytes[cursor + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          cursor += 2;
          continue;
        }
        break;
      }
    }
  }
  fail();
}

function inspectPng(bytes) {
  let cursor = 8;
  let metadata = 0;
  let dimensions;
  let dataSeen = false;
  let count = 0;
  const allowed = new Set([
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
  ]);
  while (cursor + 12 <= bytes.length) {
    if (++count > 8192) fail('STRUCTURE_LIMIT');
    const length = bytes.readUInt32BE(cursor);
    const end = cursor + length + 12;
    if (end > bytes.length) fail();
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) fail('ANIMATION_UNSUPPORTED');
    if (!allowed.has(type)) fail('UNSUPPORTED_CHUNK');
    if (type !== 'IDAT') metadata += length;
    if (metadata > metadataLimit) fail('METADATA_LIMIT');
    if (crc32(bytes.subarray(cursor + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      fail('CRC_INVALID');
    if (!dimensions && type !== 'IHDR') fail();
    if (type === 'IHDR') {
      if (dimensions || length !== 13) fail();
      dimensions = {
        width: bytes.readUInt32BE(cursor + 8),
        height: bytes.readUInt32BE(cursor + 12),
      };
    }
    if (type === 'IDAT') dataSeen = true;
    if (type === 'IEND') {
      if (end !== bytes.length) fail('APPENDED_PAYLOAD');
      if (length !== 0 || !dataSeen) fail();
      return { format: 'png', ...dimensions, metadataBytes: metadata };
    }
    cursor = end;
  }
  fail();
}

function inspectWebp(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('CONTAINER_LENGTH');
  let cursor = 12;
  let metadata = 0;
  let dataSeen = false;
  let count = 0;
  while (cursor + 8 <= bytes.length) {
    if (++count > 128) fail('STRUCTURE_LIMIT');
    const type = bytes.toString('ascii', cursor, cursor + 4);
    const length = bytes.readUInt32LE(cursor + 4);
    const end = cursor + 8 + length + (length % 2);
    if (end > bytes.length) fail();
    if (['ANIM', 'ANMF'].includes(type) || (type === 'VP8X' && bytes[cursor + 8] & 2))
      fail('ANIMATION_UNSUPPORTED');
    if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'EXIF', 'XMP ', 'ICCP'].includes(type))
      fail('UNSUPPORTED_CHUNK');
    if (['EXIF', 'XMP ', 'ICCP'].includes(type)) metadata += length;
    if (metadata > metadataLimit) fail('METADATA_LIMIT');
    if (['VP8 ', 'VP8L'].includes(type)) {
      if (dataSeen) fail();
      dataSeen = true;
    }
    cursor = end;
  }
  if (cursor !== bytes.length || !dataSeen) fail();
  return { format: 'webp', metadataBytes: metadata };
}

function inspect(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) fail();
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return inspectPng(bytes);
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return inspectWebp(bytes);
  fail('FORMAT_UNSUPPORTED');
}

module.exports = { inspect, crc32, ImageFailure };
