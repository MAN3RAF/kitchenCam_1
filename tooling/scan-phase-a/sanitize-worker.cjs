const { readFileSync } = require('node:fs');
const { Buffer } = require('node:buffer');
const { sanitize } = require('./sanitizer.cjs');
const { ImageFailure } = require('./image-inspection.cjs');
const sharp = require('sharp');

async function main() {
  const started = performance.now();
  const cpu = process.cpuUsage();
  const [file, mime, mode, probe] = process.argv.slice(2);
  if (probe === 'stall') {
    while (true) {
      /* Supervisor deadline probe, no decoder involved. */
    }
  }
  if (probe === 'memory') {
    const retained = [];
    while (true) retained.push(Buffer.alloc(8 * 1024 * 1024, 1));
  }
  let result;
  try {
    const bytes = readFileSync(file);
    const value = await sanitize(bytes, { mime, mode });
    let orientationVerified;
    if (probe.startsWith('orientation-')) {
      const expected = ['RGBY', 'GRYB', 'YBGR', 'BYRG', 'RBGY', 'BRYG', 'YGBR', 'GYRB'][
        Number(probe.split('-')[1]) - 1
      ];
      const decoded = await sharp(value.output).raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = decoded.info;
      const corners = [
        [20, 20],
        [width - 21, 20],
        [20, height - 21],
        [width - 21, height - 21],
      ];
      const actual = corners
        .map(([x, y]) => {
          const offset = (y * width + x) * channels;
          const [r, g, b] = decoded.data.subarray(offset, offset + 3);
          return r > 180 && g > 180 ? 'Y' : r > 180 ? 'R' : g > 180 ? 'G' : b > 180 ? 'B' : '?';
        })
        .join('');
      if (actual !== expected) throw new ImageFailure('ORIENTATION_FAILED');
      orientationVerified = true;
    }
    if (probe === 'exif' && !value.inputHadExif) throw new ImageFailure('FIXTURE_EXIF_MISSING');
    // Return only dimensions/resource measurements; never image bytes or metadata values.
    result = {
      outcome: 'accepted',
      outputBytes: value.output.length,
      width: value.width,
      height: value.height,
      inputHadExif: value.inputHadExif,
      metadataAbsent: value.metadataAbsent,
      ...(orientationVerified ? { orientationVerified } : {}),
    };
  } catch (error) {
    result = {
      outcome: 'rejected',
      code: error instanceof ImageFailure ? error.code : 'DECODE_FAILED',
    };
  }
  const used = process.cpuUsage(cpu);
  const highWater = Number(
    readFileSync('/proc/self/status', 'utf8').match(/^VmHWM:\s+(\d+)/m)?.[1],
  );
  console.log(
    JSON.stringify({
      ...result,
      wallMs: performance.now() - started,
      cpuMs: (used.user + used.system) / 1000,
      peakRssKiB: highWater,
      rusageMaxRssKiB: process.resourceUsage().maxRSS,
    }),
  );
}

main().catch(() => {
  console.error('SANITIZER_WORKER_FAILED');
  process.exitCode = 1;
});
