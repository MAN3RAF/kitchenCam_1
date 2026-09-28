import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { encode, verify } from './codec.ts';
import { Failure, fail, limits } from './policy.ts';

const started = performance.now();
const cpu = process.cpuUsage();
let category = 'INTERNAL';
try {
  const mode = process.argv[2];
  if (mode !== 'encode' && mode !== 'verify') fail('INTERNAL');
  const file = await open(
    '/input/image',
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !stat.size) fail('UNREADABLE');
    if (stat.size > (mode === 'verify' ? limits.outputBytes : limits.inputBytes))
      fail('IMAGE_TOO_LARGE');
    bytes = Buffer.alloc(stat.size);
    const read = await file.read(bytes, 0, stat.size, 0);
    if (read.bytesRead !== stat.size) fail('UNREADABLE');
  } finally {
    await file.close();
  }
  const result =
    mode === 'encode' ? await encode(bytes) : Buffer.from(JSON.stringify(await verify(bytes)));
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(result, (error) => (error ? reject(error) : resolve())),
  );
  category = 'SUCCESS';
} catch (error) {
  category = error instanceof Failure ? error.category : 'DECODE_FAILURE';
  process.exitCode = 1;
} finally {
  const used = process.cpuUsage(cpu);
  const status = await readFile('/proc/self/status', 'utf8');
  const peakRssKiB = Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0);
  // Explicit allowlist: never print exceptions, paths, metadata or bytes.
  process.stderr.write(
    JSON.stringify({
      category,
      elapsedMs: performance.now() - started,
      cpuMs: (used.user + used.system) / 1000,
      peakRssKiB,
    }) + '\n',
  );
}
