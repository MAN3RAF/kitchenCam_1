import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fail, Failure, limits } from './policy.ts';
import type { Category } from './policy.ts';
const exec = promisify(execFile);
export const image = 'kitchencam-sanitizer:phase-f';
export type Metrics = { elapsedMs: number; cpuMs: number; peakRssKiB: number; processMs: number };
export type Execution = { bytes: Buffer; metrics: Metrics };
const categories: Category[] = [
  'UNSUPPORTED_FORMAT',
  'MALFORMED_IMAGE',
  'IMAGE_TOO_LARGE',
  'UNREADABLE',
  'DECODE_FAILURE',
  'OUTPUT_VERIFICATION',
  'INTERNAL',
];
export async function docker(args: string[]) {
  try {
    return (await exec('docker', args, { timeout: 10000, maxBuffer: 65536 })).stdout.trim();
  } catch {
    throw new Failure('INTERNAL');
  }
}
export function containerArgs(name: string, file: string, mode: 'encode' | 'verify') {
  return [
    'run',
    '--name',
    name,
    '--label',
    'kitchencam.phase=f',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--memory=192m',
    '--memory-swap=192m',
    '--cpus=1',
    '--pids-limit=32',
    '--ulimit',
    'cpu=4:4',
    '--ulimit',
    'core=0:0',
    '--ulimit',
    'nofile=64:64',
    '--ulimit',
    'fsize=8388608:8388608',
    '--shm-size=1m',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=8388608,mode=700,uid=1000,gid=1000',
    '--mount',
    `type=bind,source=${file},target=/input/image,readonly`,
    '--log-driver=none',
    image,
    mode,
  ];
}
export async function execute(
  file: string,
  mode: 'encode' | 'verify',
  signal: AbortSignal,
  deadline: number,
  name = `kitchencam-f-${randomUUID()}`,
): Promise<Execution> {
  if (signal.aborted) fail('CANCELLED');
  if (Date.now() >= deadline) fail('TIMEOUT');
  const started = performance.now();
  const child = spawn('docker', containerArgs(name, file, mode), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: Buffer[] = [];
  let completed = false;
  let size = 0,
    diagnostic = '',
    reason: Category | undefined;
  let termination: Promise<void> | undefined;
  const kill = (why: Category) => {
    reason ??= why;
    if (termination) return;
    // Container termination, not merely termination of the Docker client.
    termination = docker(['kill', name]).then(
      () => {},
      () => {},
    );
  };
  const cancel = () => kill('CANCELLED');
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => kill('TIMEOUT'),
    Math.max(1, Math.min(limits.wallMs, deadline - Date.now())),
  );
  // Bounded second stop: if Docker itself is unresponsive, return failed; durable
  // recovery retains the container name. In-container timeout still terminates Node.
  const watchdog = setTimeout(() => {
    reason ??= 'TIMEOUT';
    child.kill('SIGKILL');
  }, limits.wallMs + 12000);
  child.stdout.on('data', (part: Buffer) => {
    size += part.length;
    if (size > (mode === 'encode' ? limits.outputBytes : 1024)) kill('OUTPUT_VERIFICATION');
    else chunks.push(part);
  });
  child.stderr.on('data', (part: Buffer) => {
    if (diagnostic.length + part.length <= 2048) diagnostic += part.toString();
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', () => reject(new Failure('INTERNAL')));
      child.once('close', resolve);
    });
    if (signal.aborted) reason = 'CANCELLED';
    if (Date.now() >= deadline) reason ??= 'TIMEOUT';
    if (reason) fail(reason);
    const state: unknown = JSON.parse(
      await docker(['inspect', '--format', '{{json .State}}', name]),
    );
    if (typeof state === 'object' && state && 'OOMKilled' in state && state.OOMKilled === true)
      fail('RESOURCE_LIMIT');
    if (code === 137 || code === 124) fail('TIMEOUT');
    let report: Record<string, unknown>;
    try {
      report = JSON.parse(diagnostic) as Record<string, unknown>;
    } catch {
      fail('INTERNAL');
    }
    if (code !== 0)
      fail(
        categories.includes(report.category as Category)
          ? (report.category as Category)
          : 'INTERNAL',
      );
    if (
      report.category !== 'SUCCESS' ||
      !['elapsedMs', 'cpuMs', 'peakRssKiB'].every(
        (k) =>
          typeof report[k] === 'number' && Number.isFinite(report[k]) && Number(report[k]) >= 0,
      )
    )
      fail('INTERNAL');
    // Docker inspection is asynchronous too: cancellation/deadline can arrive
    // after the child exit and the first reason check.
    if (signal.aborted) fail('CANCELLED');
    if (Date.now() >= deadline) reason ??= 'TIMEOUT';
    if (reason) fail(reason);
    completed = true;
    return {
      bytes: Buffer.concat(chunks),
      metrics: {
        elapsedMs: Number(report.elapsedMs),
        cpuMs: Number(report.cpuMs),
        peakRssKiB: Number(report.peakRssKiB),
        processMs: performance.now() - started,
      },
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(watchdog);
    signal.removeEventListener('abort', cancel);
    // Drain the one outstanding stop request before reusing this container name.
    await termination;
    // Failure to remove is propagated: caller keeps its durable cleanup record.
    await docker(['rm', '--force', name]);
    if (completed) {
      if (signal.aborted) fail('CANCELLED');
      if (Date.now() >= deadline) fail('TIMEOUT');
    }
  }
}
