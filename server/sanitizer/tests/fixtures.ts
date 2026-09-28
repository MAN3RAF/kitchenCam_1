import sharp from 'sharp';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type { Job } from '../contracts.ts';
sharp.cache(false);
sharp.concurrency(1);
export function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function chunk(type: string, data: Buffer) {
  const b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  b.write(type, 4, 4, 'ascii');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, -4)), b.length - 4);
  return b;
}
export function segment(marker: number, data: Buffer) {
  const h = Buffer.from([255, marker, 0, 0]);
  h.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([h, data]);
}
export function base() {
  const p = Buffer.alloc(512 * 384 * 3);
  const colors = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  for (let y = 0; y < 384; y++)
    for (let x = 0; x < 512; x++)
      for (let c = 0; c < 3; c++)
        p[(y * 512 + x) * 3 + c] = colors[(y >= 192 ? 2 : 0) + (x >= 256 ? 1 : 0)]![c]!;
  return sharp(p, { raw: { width: 512, height: 384, channels: 3 } });
}
export async function noise(width: number, height: number) {
  const p = Buffer.alloc(width * height * 3);
  let seed = 1;
  for (let i = 0; i < p.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    p[i] = seed & 255;
  }
  return sharp(p, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}
export function job(bytes: Buffer, overrides: Partial<Job> = {}): Job {
  return {
    jobId: randomUUID(),
    scanId: randomUUID(),
    leaseToken: randomUUID(),
    imageRevision: 1,
    generation: 1,
    deadline: Date.now() + 60000,
    inputId: randomUUID(),
    outputId: randomUUID(),
    inputDigest: createHash('sha256').update(bytes).digest('hex'),
    ...overrides,
  };
}
export async function corpus() {
  const jpeg = await base().jpeg().toBuffer(),
    png = await base().png().toBuffer(),
    webp = await base().webp().toBuffer();
  const list: { name: string; bytes: Buffer; accepted: boolean }[] = [
    { name: 'jpeg', bytes: jpeg, accepted: true },
    {
      name: 'progressive',
      bytes: await base().jpeg({ progressive: true }).toBuffer(),
      accepted: true,
    },
    { name: 'png', bytes: png, accepted: true },
    { name: 'webp', bytes: webp, accepted: true },
    {
      name: 'lossless-webp',
      bytes: await base().webp({ lossless: true }).toBuffer(),
      accepted: true,
    },
    { name: 'zero', bytes: Buffer.alloc(0), accepted: false },
    { name: 'random', bytes: Buffer.alloc(100, 23), accepted: false },
    {
      name: 'svg',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      accepted: false,
    },
    { name: 'gif', bytes: await base().gif().toBuffer(), accepted: false },
    { name: 'tiff', bytes: await base().tiff().toBuffer(), accepted: false },
    { name: 'over-byte-cap', bytes: Buffer.alloc(25 * 1024 * 1024 + 1), accepted: false },
  ];
  for (const [name, bytes] of [
    ['jpeg', jpeg],
    ['png', png],
    ['webp', webp],
  ] as const) {
    list.push(
      { name: `truncated-${name}`, bytes: bytes.subarray(0, -13), accepted: false },
      {
        name: `appended-${name}`,
        bytes: Buffer.concat([bytes, Buffer.from('<script>payload</script>')]),
        accepted: false,
      },
    );
  }
  const header = Buffer.from(png.subarray(16, 29));
  header.writeUInt32BE(100000, 0);
  header.writeUInt32BE(100000, 4);
  list.push(
    {
      name: 'huge-header',
      bytes: Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), png.subarray(33)]),
      accepted: false,
    },
    {
      name: 'compressed-metadata',
      bytes: Buffer.concat([
        png.subarray(0, 33),
        chunk('zTXt', Buffer.from([97, 0, 0, 120, 156])),
        png.subarray(33),
      ]),
      accepted: false,
    },
    {
      name: 'metadata-over-budget',
      bytes: Buffer.concat([
        jpeg.subarray(0, 2),
        segment(239, Buffer.alloc(40000)),
        segment(239, Buffer.alloc(40000)),
        jpeg.subarray(2),
      ]),
      accepted: false,
    },
    {
      name: 'malformed-exif',
      bytes: Buffer.concat([
        jpeg.subarray(0, 2),
        segment(225, Buffer.from('Exif\0\0invalid')),
        jpeg.subarray(2),
      ]),
      accepted: false,
    },
    {
      name: 'bad-png-pixels',
      bytes: Buffer.concat([
        png.subarray(0, 33),
        chunk('IDAT', Buffer.from('invalid pixels')),
        chunk('IEND', Buffer.alloc(0)),
      ]),
      accepted: false,
    },
    { name: 'concatenated-jpeg', bytes: Buffer.concat([jpeg, jpeg]), accepted: false },
  );
  const crc = Buffer.from(png);
  crc[crc.length - 1] = crc[crc.length - 1]! ^ 1;
  list.push({ name: 'bad-crc', bytes: crc, accepted: false });
  const sos = jpeg.indexOf(Buffer.from([255, 218])),
    start = sos + 2 + jpeg.readUInt16BE(sos + 2);
  list.push({
    name: 'truncated-jpeg-pixels',
    bytes: Buffer.concat([jpeg.subarray(0, start + 1), Buffer.from([255, 217])]),
    accepted: false,
  });
  const anim = chunk('acTL', Buffer.alloc(8));
  list.push({
    name: 'apng-marker',
    bytes: Buffer.concat([png.subarray(0, 33), anim, png.subarray(33)]),
    accepted: false,
  });
  return list;
}
