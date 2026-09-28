import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { inspectImage } from './inspection.ts';
import { Failure, fail, dimensions, limits, version } from './policy.ts';
import type { Category } from './policy.ts';
import { Store, uuid } from './storage.ts';
import { execute, docker } from './runtime.ts';
import type { Metrics } from './runtime.ts';
import { databaseError, validateJob } from './contracts.ts';
import type { Rpc } from './lifecycle.ts';
import type { Job, Lifecycle, Result, Verified } from './contracts.ts';
export const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type RecordState = {
  job: Job;
  inputRef: string;
  attempt: string;
  phase: 'SANITIZING' | 'COMMITTING' | 'SANITIZED' | 'REJECTED';
  cleaned?: string[];
};
export type Executor = typeof execute;
export class Coordinator {
  private active = false;
  readonly store: Store;
  readonly lifecycle: Lifecycle;
  readonly run: Executor;
  readonly log: (event: { jobId: string; status: Result['status']; category?: Category }) => void;
  constructor(
    store: Store,
    lifecycle: Lifecycle,
    run: Executor = execute,
    log: Coordinator['log'] = () => {},
  ) {
    this.store = store;
    this.lifecycle = lifecycle;
    this.run = run;
    this.log = log;
  }
  async process(
    job: Job,
    inputRef: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Result> {
    validateJob(job);
    if (!uuid.test(inputRef)) fail('PATH_INVALID');
    if (this.active) fail('BUSY');
    const unlock = await this.store.lock();
    this.active = true;
    const attempt = randomUUID();
    const record: RecordState = { job, inputRef, attempt, phase: 'SANITIZING' };
    const metrics: Metrics[] = [];
    let result: Result;
    let commitStarted = false;
    let registered = false;
    try {
      if ((await fs.readdir(await this.store.directory('journal'))).length >= 16) fail('BUSY');
      await this.store.write('journal', job.outputId, Buffer.from(JSON.stringify(record)));
      registered = true;
      const current = () => {
        if (signal.aborted) fail('CANCELLED');
        if (Date.now() >= job.deadline) fail('TIMEOUT');
      };
      current();
      const source = await this.store.read('incoming', inputRef);
      if (digest(source) !== job.inputDigest) fail('STALE_REVISION');
      const info = inspectImage({
        size: source.length,
        read: (at, length) => source.subarray(at, at + length),
      });
      const expected = dimensions(info, info.orientation);
      // Copy admitted bytes to a distinct immutable mount; no mutable incoming path
      // is reused by the decoder. Source bytes remain untrusted.
      const sourceFile = await this.store.target('working', attempt);
      const handle = await fs.open(sourceFile, 'wx', 0o444);
      try {
        await handle.writeFile(source);
        await handle.sync();
      } finally {
        await handle.close();
      }
      current();
      const encoded = await this.run(
        sourceFile,
        'encode',
        signal,
        job.deadline,
        `kitchencam-f-${attempt}`,
      );
      metrics.push(encoded.metrics);
      current();
      await this.store.write('working', job.outputId, encoded.bytes);
      await this.store.remove('working', attempt);
      const bytes = await this.store.read('working', job.outputId, limits.outputBytes);
      const inspected = inspectImage({
        size: bytes.length,
        read: (at, length) => bytes.subarray(at, at + length),
      });
      if (
        inspected.format !== 'jpeg' ||
        inspected.metadata.length ||
        inspected.orientation !== 1 ||
        inspected.width !== expected.width ||
        inspected.height !== expected.height
      )
        fail('OUTPUT_VERIFICATION');
      const verification = await this.run(
        await this.store.target('working', job.outputId),
        'verify',
        signal,
        job.deadline,
        `kitchencam-f-${attempt}`,
      );
      metrics.push(verification.metrics);
      current();
      const actual: unknown = JSON.parse(verification.bytes.toString());
      if (
        typeof actual !== 'object' ||
        !actual ||
        !('width' in actual) ||
        !('height' in actual) ||
        actual.width !== expected.width ||
        actual.height !== expected.height
      )
        fail('OUTPUT_VERIFICATION');
      // Parent owns publication. Decoder sees neither destination nor DB authority.
      const output: Verified = {
        ...expected,
        bytes: bytes.length,
        digest: digest(bytes),
        sanitizerVersion: version,
        imageId: job.outputId,
      };
      await this.store.write('sanitized', job.outputId, bytes);
      current();
      record.phase = 'COMMITTING';
      await this.store.record(job.outputId, record);
      current();
      commitStarted = true;
      const accepted = await this.lifecycle.finish(job, output);
      commitStarted = false;
      if (!accepted) fail('STALE_REVISION');
      record.phase = 'SANITIZED';
      await this.store.record(job.outputId, record);
      result = {
        status: 'SUCCESS',
        trust: 'SANITIZED',
        jobId: job.jobId,
        imageRevision: job.imageRevision,
        output,
        metrics,
      };
    } catch (error) {
      if (!registered) throw error;
      const category = error instanceof Failure ? error.category : 'INTERNAL';
      if (commitStarted || record.phase === 'SANITIZED') {
        // A lost finish acknowledgement can mean committed success. Keep the output
        // until Phase B authorizes cleanup; never retry an ambiguous success as a new approval.
        result = { status: 'PENDING', trust: 'SANITIZING', category: 'INTERNAL', jobId: job.jobId };
      } else {
        record.phase = 'REJECTED';
        await this.store.record(job.outputId, record);
        if (!['CANCELLED', 'STALE_REVISION', 'BUSY'].includes(category)) {
          try {
            await this.lifecycle.finish(job, { error: databaseError(category) });
          } catch {
            /* Phase B lease/retry remains authoritative. */
          }
        }
        result = {
          status:
            category === 'CANCELLED'
              ? 'CANCELLED'
              : category === 'TIMEOUT'
                ? 'TIMED_OUT'
                : ['INTERNAL', 'RESOURCE_LIMIT', 'OUTPUT_VERIFICATION'].includes(category)
                  ? 'FAILED'
                  : 'REJECTED',
          trust: 'REJECTED',
          category,
          jobId: job.jobId,
        };
      }
    } finally {
      try {
        if (registered) {
          await this.store.remove('working', attempt);
          await this.store.remove('working', job.outputId);
          await this.store.remove('incoming', inputRef);
          if (record.phase === 'REJECTED') {
            await this.store.remove('sanitized', job.outputId);
          }
        }
      } finally {
        this.active = false;
        await unlock();
      }
    }
    this.log({
      jobId: job.jobId,
      status: result.status,
      ...('category' in result ? { category: result.category } : {}),
    });
    return result;
  }
  // Recovery and cleanup serialize with processing. A cleanup claim authorizes
  // only registered IDs in this local store, never an arbitrary returned path.
  async recover(rpc?: Rpc) {
    const unlock = await this.store.lock();
    try {
      const claims = rpc ? await rpc('internal_scan_claim_cleanup', { p_limit: 100 }) : [];
      if (!Array.isArray(claims)) fail('INTERNAL');
      const records: RecordState[] = [];
      const eligible = new Set<RecordState>();
      const acknowledged = new Set<string>();
      const live = new Set<string>();
      for (const key of await fs.readdir(await this.store.directory('journal'))) {
        if (!uuid.test(key)) fail('PATH_INVALID');
        const value: unknown = JSON.parse(
          (await this.store.read('journal', key, 16384)).toString(),
        );
        if (
          typeof value !== 'object' ||
          !value ||
          !('job' in value) ||
          !('attempt' in value) ||
          !('inputRef' in value) ||
          !('phase' in value)
        )
          fail('INTERNAL');
        const record = value as RecordState;
        validateJob(record.job);
        if (
          !uuid.test(record.attempt) ||
          !uuid.test(record.inputRef) ||
          !['SANITIZING', 'COMMITTING', 'SANITIZED', 'REJECTED'].includes(record.phase)
        )
          fail('PATH_INVALID');
        if (record.job.outputId !== key) {
          await this.store.remove('journal', key);
          continue;
        }
        if (
          record.cleaned !== undefined &&
          (!Array.isArray(record.cleaned) ||
            record.cleaned.some((id) => ![record.job.inputId, key].includes(id)))
        )
          fail('INTERNAL');
        records.push(record);
        for (const id of record.cleaned ?? []) acknowledged.add(id);
        live.add(key);
        live.add(record.attempt);
        live.add(record.inputRef);
        if (Date.now() < record.job.deadline) continue;
        const name = `kitchencam-f-${record.attempt}`;
        const present = await docker([
          'ps',
          '-aq',
          '--filter',
          `name=^/${name}$`,
          '--filter',
          'label=kitchencam.phase=f',
        ]);
        if (present) await docker(['rm', '--force', name]);
        await this.store.remove('working', record.attempt);
        await this.store.remove('working', key);
        await this.store.remove('incoming', record.inputRef);
        if (!['COMMITTING', 'SANITIZED'].includes(record.phase))
          await this.store.remove('sanitized', key);
        eligible.add(record);
      }
      // An inventory ID can belong to multiple retry journals. Deletion must
      // cover every local copy, and a newer live attempt must block its ack.
      const persistReceipts = async () => {
        for (const record of records) {
          const cleaned = [record.job.inputId, record.job.outputId].filter((id) =>
            acknowledged.has(id),
          );
          if (cleaned.some((id) => !record.cleaned?.includes(id))) {
            record.cleaned = cleaned;
            await this.store.record(record.job.outputId, record);
          }
        }
      };
      await persistReceipts();
      for (const candidate of claims as unknown[]) {
        if (typeof candidate !== 'object' || !candidate) fail('INTERNAL');
        const claim = candidate as Record<string, unknown>;
        if (
          typeof claim.imageId !== 'string' ||
          typeof claim.token !== 'string' ||
          !uuid.test(claim.imageId) ||
          !uuid.test(claim.token)
        )
          fail('INTERNAL');
        const refs = records.filter((record) =>
          [record.job.inputId, record.job.outputId].includes(String(claim.imageId)),
        );
        if (!refs.length || refs.some((record) => !eligible.has(record))) continue;
        for (const record of refs) {
          if (record.job.outputId === claim.imageId)
            await this.store.remove('sanitized', record.job.outputId);
        }
        if (acknowledged.has(claim.imageId)) continue;
        // Acknowledge once, then durably distribute the receipt before pruning
        // any journal. Existing receipts also reconcile an interrupted fan-out.
        if (
          (await rpc!('internal_scan_ack_cleanup', {
            p_image: claim.imageId,
            p_token: claim.token,
          })) === true
        ) {
          acknowledged.add(claim.imageId);
          await persistReceipts();
        }
      }
      for (const record of eligible) {
        if ([record.job.inputId, record.job.outputId].every((id) => record.cleaned?.includes(id)))
          await this.store.remove('journal', record.job.outputId);
      }
      // Crash before initial journal publication cannot have approved anything.
      for (const area of ['working', 'incoming', 'sanitized'] as const) {
        for (const key of await fs.readdir(await this.store.directory(area))) {
          if (!live.has(key)) await this.store.remove(area, key);
        }
      }
    } finally {
      await unlock();
    }
  }
}
