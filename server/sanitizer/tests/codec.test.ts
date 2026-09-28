import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { encode, verify, inspect } from '../codec.ts';
import { base, corpus, segment } from './fixtures.ts';

for (const fixture of await corpus())
  test(`corpus: ${fixture.name}`, async () => {
    if (fixture.accepted) {
      const output = await encode(fixture.bytes);
      await verify(output);
      assert.notDeepEqual(output, fixture.bytes);
    } else await assert.rejects(() => encode(fixture.bytes));
  });
for (let orientation = 1; orientation <= 8; orientation++)
  test(`orientation ${orientation}: canonical corners and dimensions`, async () => {
    const source = await base().withMetadata({ orientation }).jpeg().toBuffer();
    const output = await encode(source);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, orientation >= 5 ? 384 : 512);
    assert.equal(info.height, orientation >= 5 ? 512 : 384);
    const corners = [
      [20, 20],
      [info.width - 21, 20],
      [20, info.height - 21],
      [info.width - 21, info.height - 21],
    ];
    const actual = corners
      .map(([x, y]) => {
        const at = (y! * info.width + x!) * 3;
        const r = data[at]!,
          g = data[at + 1]!,
          b = data[at + 2]!;
        return r > 180 && g > 180 ? 'Y' : r > 180 ? 'R' : g > 180 ? 'G' : b > 180 ? 'B' : '?';
      })
      .join('');
    assert.equal(
      actual,
      ['RGBY', 'GRYB', 'YBGR', 'BYRG', 'RBGY', 'BRYG', 'YGBR', 'GYRB'][orientation - 1],
    );
    assert.equal(inspect(output).metadata.length, 0);
  });
for (const format of ['png', 'webp'] as const)
  test(`transparent ${format} becomes white`, async () => {
    const source = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      [format]()
      .toBuffer();
    const { data } = await sharp(await encode(source))
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(data.every((value) => value >= 254));
  });
test('real EXIF GPS/camera/time, ICC, XMP and inserted IPTC/comment/thumbnail metadata absent', async () => {
  const source = await base()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'SYNTHETIC_CAMERA', Model: 'SYNTHETIC_MODEL', DateTime: '2026:01:02 03:04:05' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '0/1 0/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '0/1 0/1 0/1',
      },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">SYNTHETIC_XMP</x:xmpmeta>')
    .jpeg()
    .toBuffer();
  const meta = await sharp(source).metadata();
  assert.ok(meta.exif);
  assert.ok(meta.icc);
  assert.ok(meta.xmp);
  // Confirm GPS IFD actually exists; no external photos or metadata are logged.
  const tiff = meta.exif.subarray(6),
    le = tiff.toString('ascii', 0, 2) === 'II';
  const u16 = (at: number) => (le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const offset = u32(4);
  const entries = Array.from({ length: u16(offset) }, (_, i) => offset + 2 + i * 12);
  const gps = entries.find((at) => u16(at) === 0x8825);
  assert.ok(gps);
  const gpsOffset = u32(gps + 8);
  const tags = Array.from({ length: u16(gpsOffset) }, (_, i) => u16(gpsOffset + 2 + i * 12));
  assert.ok([1, 2, 3, 4].every((tag) => tags.includes(tag)));
  const decorated = Buffer.concat([
    source.subarray(0, 2),
    segment(254, Buffer.from('SYNTHETIC_COMMENT')),
    segment(237, Buffer.from('Photoshop 3.0\0SYNTHETIC_IPTC')),
    segment(224, Buffer.from('JFXX\0\x10SYNTHETIC_THUMBNAIL')),
    source.subarray(2),
  ]);
  const output = await encode(decorated);
  assert.equal(inspect(output).metadata.length, 0);
  for (const key of ['exif', 'xmp', 'iptc', 'icc', 'orientation', 'comments'])
    assert.equal((await sharp(output).metadata())[key as keyof Metadata], undefined);
  assert.ok(!output.includes(Buffer.from('SYNTHETIC')));
  await verify(output);
});
test('verification rejects metadata, size, wrong dimensions and corrupted pixels', async () => {
  const plain = await base().jpeg().toBuffer();
  await assert.rejects(() => verify(plain, { width: 256, height: 256 }));
  await assert.rejects(() => verify(Buffer.alloc(4 * 1024 * 1024 + 1)));
  const metadata = Buffer.concat([
    plain.subarray(0, 2),
    segment(254, Buffer.from('private')),
    plain.subarray(2),
  ]);
  await assert.rejects(() => verify(metadata));
  await assert.rejects(() => verify(plain.subarray(0, -15)));
});
test('resize respects long edge and aspect ratio; narrow/tiny inputs reject', async () => {
  const source = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: '#808080' },
  })
    .jpeg()
    .toBuffer();
  assert.deepEqual(await verify(await encode(source)), { width: 2048, height: 1536 });
  for (const [width, height] of [
    [255, 256],
    [12000, 100],
  ]) {
    const b = await sharp({
      create: { width: width!, height: height!, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer();
    await assert.rejects(() => encode(b));
  }
});
