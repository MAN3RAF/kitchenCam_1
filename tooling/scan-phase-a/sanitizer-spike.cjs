const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir, cpus, arch, platform } = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { crc32 } = require('./image-inspection.cjs');

function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 4, 'ascii');
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4);
  return result;
}

function noise(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 1;
  for (let i = 0; i < pixels.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    pixels[i] = seed & 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

async function fixtures() {
  const pixels = Buffer.alloc(512 * 384 * 3);
  const colors = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  for (let y = 0; y < 384; y++)
    for (let x = 0; x < 512; x++) {
      const color = colors[(y >= 192 ? 2 : 0) + (x >= 256 ? 1 : 0)];
      for (let channel = 0; channel < 3; channel++)
        pixels[(y * 512 + x) * 3 + channel] = color[channel];
    }
  const base = () => sharp(pixels, { raw: { width: 512, height: 384, channels: 3 } });
  const jpeg = await base().jpeg().toBuffer();
  const png = await base().png().toBuffer();
  const webp = await base().webp().toBuffer();
  const result = [
    { name: 'valid-jpeg', bytes: jpeg, mime: 'image/jpeg', expected: 'accepted' },
    {
      name: 'valid-progressive-jpeg',
      bytes: await base().jpeg({ progressive: true }).toBuffer(),
      mime: 'image/jpeg',
      expected: 'accepted',
    },
    { name: 'valid-png', bytes: png, mime: 'image/png', expected: 'accepted' },
    { name: 'valid-static-webp', bytes: webp, mime: 'image/webp', expected: 'accepted' },
  ];
  for (let orientation = 1; orientation <= 8; orientation++)
    result.push({
      name: `orientation-${orientation}`,
      bytes: await base().withMetadata({ orientation }).jpeg().toBuffer(),
      mime: 'image/jpeg',
      expected: 'accepted',
      probe: `orientation-${orientation}`,
    });
  const gps = await base()
    .withExif({
      IFD0: { Copyright: 'KitchenCam synthetic fixture' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '0/1 0/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '0/1 0/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
  // Inspect only this generated TIFF/EXIF fixture; no external metadata parser surface.
  const exif = (await sharp(gps).metadata()).exif;
  assert.ok(exif, 'GPS_FIXTURE_REQUIRES_EXIF');
  const tiff = exif.subarray(6);
  const little = tiff.toString('ascii', 0, 2) === 'II';
  const u16 = (offset) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const entries = (offset) =>
    Array.from({ length: u16(offset) }, (_, index) => offset + 2 + index * 12);
  const gpsPointer = entries(u32(4)).find((offset) => u16(offset) === 0x8825);
  assert.ok(gpsPointer, 'GPS_POINTER_MISSING');
  const gpsTags = entries(u32(gpsPointer + 8)).map(u16);
  assert.ok(
    [1, 2, 3, 4].every((tag) => gpsTags.includes(tag)),
    'GPS_TAGS_MISSING',
  );
  result.push({
    name: 'synthetic-exif-gps',
    bytes: gps,
    mime: 'image/jpeg',
    expected: 'accepted',
    probe: 'exif',
    inputGpsVerified: true,
  });
  result.push({
    name: 'jpeg-content-with-png-extension',
    bytes: jpeg,
    mime: 'image/jpeg',
    extension: 'png',
    expected: 'accepted',
  });
  result.push({ name: 'mime-mismatch', bytes: jpeg, mime: 'image/png', expected: 'rejected' });
  result.push({
    name: 'malformed-header',
    bytes: Buffer.alloc(100),
    mime: 'image/jpeg',
    expected: 'rejected',
  });
  result.push({
    name: 'truncated-jpeg',
    bytes: jpeg.subarray(0, jpeg.length - 15),
    mime: 'image/jpeg',
    expected: 'rejected',
  });
  result.push({
    name: 'truncated-png',
    bytes: png.subarray(0, png.length - 15),
    mime: 'image/png',
    expected: 'rejected',
  });
  result.push({
    name: 'truncated-webp',
    bytes: webp.subarray(0, webp.length - 3),
    mime: 'image/webp',
    expected: 'rejected',
  });
  const corrupt = Buffer.from(png);
  corrupt[corrupt.length - 1] ^= 1;
  result.push({
    name: 'png-crc-corruption',
    bytes: corrupt,
    mime: 'image/png',
    expected: 'rejected',
  });
  result.push({
    name: 'valid-container-corrupt-png-pixels',
    bytes: Buffer.concat([
      png.subarray(0, 33),
      chunk('IDAT', Buffer.from('invalid compressed pixels')),
      chunk('IEND', Buffer.alloc(0)),
    ]),
    mime: 'image/png',
    expected: 'rejected',
  });
  const sos = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  assert.ok(sos > 0, 'JPEG_SCAN_FIXTURE_MISSING');
  const scanStart = sos + 2 + jpeg.readUInt16BE(sos + 2);
  result.push({
    name: 'valid-container-truncated-jpeg-pixels',
    bytes: Buffer.concat([jpeg.subarray(0, scanStart + 1), Buffer.from([0xff, 0xd9])]),
    mime: 'image/jpeg',
    expected: 'rejected',
  });
  result.push({
    name: 'synthetic-xmp-icc',
    bytes: await base()
      .withMetadata()
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">synthetic</x:xmpmeta>')
      .jpeg()
      .toBuffer(),
    mime: 'image/jpeg',
    expected: 'accepted',
  });
  const brokenWebp = Buffer.from(webp);
  brokenWebp.fill(0, 20);
  result.push({
    name: 'valid-container-corrupt-webp-pixels',
    bytes: brokenWebp,
    mime: 'image/webp',
    expected: 'rejected',
  });
  for (const [format, bytes] of [
    ['jpeg', jpeg],
    ['png', png],
    ['webp', webp],
  ])
    result.push({
      name: `appended-${format}`,
      bytes: Buffer.concat([bytes, Buffer.from('<script>synthetic</script>')]),
      mime: `image/${format}`,
      expected: 'rejected',
    });
  result.push({
    name: 'concatenated-jpeg-polyglot-style',
    bytes: Buffer.concat([jpeg, jpeg]),
    mime: 'image/jpeg',
    expected: 'rejected',
  });
  result.push({
    name: 'unsupported-svg',
    bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384"/>'),
    mime: 'image/svg+xml',
    expected: 'rejected',
  });
  result.push({
    name: 'unsupported-gif',
    bytes: await base().gif().toBuffer(),
    mime: 'image/gif',
    expected: 'rejected',
  });
  result.push({
    name: 'unsupported-tiff',
    bytes: await base().tiff().toBuffer(),
    mime: 'image/tiff',
    expected: 'rejected',
  });
  result.push({
    name: 'excessive-png-metadata',
    bytes: Buffer.concat([
      png.subarray(0, 33),
      chunk('tEXt', Buffer.alloc(65537, 65)),
      png.subarray(33),
    ]),
    mime: 'image/png',
    expected: 'rejected',
  });
  const compressedMetadata = chunk('zTXt', Buffer.from([97, 0, 0, 120, 156]));
  result.push({
    name: 'compressed-metadata-rejected-before-inflate',
    bytes: Buffer.concat([png.subarray(0, 33), compressedMetadata, png.subarray(33)]),
    mime: 'image/png',
    expected: 'rejected',
  });
  const app = Buffer.alloc(60004, 65);
  app[0] = 255;
  app[1] = 239;
  app.writeUInt16BE(60002, 2);
  result.push({
    name: 'excessive-jpeg-metadata',
    bytes: Buffer.concat([jpeg.subarray(0, 2), app, app, jpeg.subarray(2)]),
    mime: 'image/jpeg',
    expected: 'rejected',
  });
  const hugeHeader = Buffer.from(png.subarray(16, 29));
  hugeHeader.writeUInt32BE(100000, 0);
  hugeHeader.writeUInt32BE(100000, 4);
  result.push({
    name: 'dimension-bomb-header',
    bytes: Buffer.concat([png.subarray(0, 8), chunk('IHDR', hugeHeader), png.subarray(33)]),
    mime: 'image/png',
    expected: 'rejected',
  });
  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(2, 0);
  result.push({
    name: 'apng-animation-marker',
    bytes: Buffer.concat([png.subarray(0, 33), chunk('acTL', animationControl), png.subarray(33)]),
    mime: 'image/png',
    expected: 'rejected',
  });
  const animated = await sharp(Buffer.concat([pixels, pixels]), {
    raw: { width: 512, height: 768, channels: 3, pageHeight: 384 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  // An explicit ANIM chunk tests rejection even if an encoder optimizes identical frames.
  const animChunk = Buffer.alloc(14);
  animChunk.write('ANIM', 0);
  animChunk.writeUInt32LE(6, 4);
  const animatedBytes = Buffer.concat([animated, animChunk]);
  animatedBytes.writeUInt32LE(animatedBytes.length - 8, 4);
  result.push({
    name: 'webp-animation-marker',
    bytes: animatedBytes,
    mime: 'image/webp',
    expected: 'rejected',
  });
  result.push({
    name: 'upload-over-4-mib',
    bytes: Buffer.alloc(4 * 1024 * 1024 + 1),
    mime: 'image/jpeg',
    expected: 'rejected',
  });
  result.push({
    name: 'source-over-25-mib',
    bytes: Buffer.alloc(25 * 1024 * 1024 + 1),
    mime: 'image/jpeg',
    mode: 'prepare-reference',
    expected: 'rejected',
  });
  result.push({
    name: 'below-minimum-dimensions',
    bytes: await sharp({ create: { width: 255, height: 512, channels: 3, background: '#808080' } })
      .png()
      .toBuffer(),
    mime: 'image/png',
    expected: 'rejected',
  });
  result.push({
    name: 'prepared-noise-2048',
    bytes: await noise(2048, 2048).jpeg({ quality: 80 }).toBuffer(),
    mime: 'image/jpeg',
    expected: 'accepted',
  });
  result.push({
    name: 'source-noise-12-mp',
    bytes: await noise(4000, 3000).jpeg({ quality: 90 }).toBuffer(),
    mime: 'image/jpeg',
    mode: 'prepare-reference',
    expected: 'measured',
  });
  result.push({
    name: 'source-over-revised-12-mp',
    bytes: await sharp({
      create: { width: 4001, height: 3000, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer(),
    mime: 'image/png',
    mode: 'prepare-reference',
    expected: 'rejected',
  });
  result.push({
    name: 'source-solid-24-mp',
    bytes: await sharp({
      create: { width: 6000, height: 4000, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer(),
    mime: 'image/png',
    mode: 'prepare-candidate-24mp',
    expected: 'measured',
  });
  result.push({
    name: 'source-noise-24-mp',
    bytes: await noise(6000, 4000).jpeg({ quality: 90 }).toBuffer(),
    mime: 'image/jpeg',
    mode: 'prepare-candidate-24mp',
    expected: 'measured',
  });
  result.push({
    name: 'source-over-24-mp',
    bytes: await sharp({
      create: { width: 6001, height: 4000, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer(),
    mime: 'image/png',
    mode: 'prepare-candidate-24mp',
    expected: 'rejected',
  });
  result.push({
    name: 'server-compressed-large-raster',
    bytes: await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer(),
    mime: 'image/png',
    expected: 'rejected',
  });
  result.push({
    name: 'supervisor-deadline-probe',
    bytes: jpeg,
    mime: 'image/jpeg',
    probe: 'stall',
    expected: 'killed',
  });
  result.push({
    name: 'supervisor-memory-probe',
    bytes: jpeg,
    mime: 'image/jpeg',
    probe: 'memory',
    expected: 'killed',
  });
  return result;
}

function execute(file, fixture) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=96',
        path.resolve('tooling/scan-phase-a/sanitize-worker.cjs'),
        file,
        fixture.mime,
        fixture.mode ?? 'sanitize',
        fixture.probe ?? '',
      ],
      {
        env: { PATH: process.env.PATH, VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let sampledPeakKiB = 0;
    let killReason;
    const kill = (reason) => {
      killReason ??= reason;
      child.kill('SIGKILL');
    };
    const deadline = setTimeout(() => kill('WALL_LIMIT'), 5000);
    const monitor = setInterval(() => {
      try {
        const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
        const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
        sampledPeakKiB = Math.max(sampledPeakKiB, rss);
        if (rss > 192 * 1024) kill('RSS_LIMIT');
      } catch {
        /* Child may already have exited. */
      }
    }, 10);
    child.stdout.on('data', (value) => {
      output += value.toString();
      if (output.length > 4096) kill('OUTPUT_LIMIT');
    });
    // Consume but never echo decoder stderr: it can contain paths or source metadata.
    child.stderr.on('data', () => {});
    child.on('error', () => {
      clearTimeout(deadline);
      clearInterval(monitor);
      reject(new Error('WORKER_START_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      clearInterval(monitor);
      if (killReason)
        resolve({
          outcome: 'killed',
          code: killReason,
          sampledPeakKiB,
          processWallMs: performance.now() - started,
        });
      else if (code !== 0) reject(new Error('WORKER_EXIT_FAILED'));
      else {
        try {
          resolve({
            ...JSON.parse(output),
            sampledPeakKiB,
            processWallMs: performance.now() - started,
          });
        } catch {
          reject(new Error('WORKER_PROTOCOL_FAILED'));
        }
      }
    });
  });
}

async function run() {
  const directory = mkdtempSync(path.join(tmpdir(), 'kitchencam-phase-a-'));
  const observations = [];
  try {
    for (const fixture of await fixtures()) {
      const file = path.join(directory, `${fixture.name}.${fixture.extension ?? 'bin'}`);
      writeFileSync(file, fixture.bytes, { mode: 0o600 });
      const result = await execute(file, fixture);
      const observation = {
        name: fixture.name,
        mode: fixture.mode ?? 'sanitize',
        inputBytes: fixture.bytes.length,
        expected: fixture.expected,
        ...(fixture.inputGpsVerified ? { inputGpsVerified: true } : {}),
        ...result,
      };
      observations.push(observation);
      console.log(JSON.stringify(observation));
      if (fixture.expected !== 'measured')
        assert.equal(result.outcome, fixture.expected, fixture.name);
    }
    const report = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        sharp: sharp.versions.sharp,
        vips: sharp.versions.vips,
        platform: platform(),
        architecture: arch(),
        cpu: cpus()[0]?.model,
      },
      bounds: {
        workerConcurrency: 1,
        sampledRssLimitMiB: 192,
        wallLimitMs: 5000,
        metadataLimitBytes: 65536,
      },
      observations,
    };
    mkdirSync('docs/research/evidence', { recursive: true });
    writeFileSync(
      'docs/research/evidence/scan-phase-a-sanitizer-resumed.json',
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ error: 'SANITIZER_SPIKE_FAILED', kind: error.name }));
  process.exitCode = 1;
});
