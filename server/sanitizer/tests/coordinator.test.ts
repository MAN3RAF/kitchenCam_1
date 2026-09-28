import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../storage.ts';
import { Coordinator } from '../coordinator.ts';
import { Failure } from '../policy.ts';
import { base, job } from './fixtures.ts';
import { encode, verify } from '../codec.ts';
import type { Executor } from '../coordinator.ts';
import type { Category } from '../policy.ts';
const source = await base().jpeg().toBuffer();
const metrics = { elapsedMs: 1, cpuMs: 1, peakRssKiB: 1, processMs: 1 };
const inProcess: Executor = async (file, mode) => ({
  bytes:
    mode === 'encode'
      ? await encode(await fs.readFile(file))
      : Buffer.from(JSON.stringify(await verify(await fs.readFile(file)))),
  metrics,
});
async function fixture(run: Executor = inProcess, finish = async () => true) {
  const store = await Store.create(tmpdir()),
    events: unknown[] = [];
  const coordinator = new Coordinator(store, { finish }, run, (event) => events.push(event));
  const input = await store.import(source),
    request = job(source);
  return {
    store,
    coordinator,
    input,
    request,
    events,
    dispose: () => fs.rm(store.root, { recursive: true, force: true }),
  };
}
test('verified success retains only owned output and journal; privacy allowlist', async () => {
  const f = await fixture();
  try {
    const result = await f.coordinator.process(f.request, f.input);
    assert.equal(result.status, 'SUCCESS');
    assert.deepEqual(await fs.readdir(path.join(f.store.root, 'incoming')), []);
    assert.deepEqual(await fs.readdir(path.join(f.store.root, 'working')), []);
    await verify(await f.store.read('sanitized', f.request.outputId));
    assert.deepEqual(f.events, [{ jobId: f.request.jobId, status: 'SUCCESS' }]);
    assert.ok(!JSON.stringify(f.events).includes(f.store.root));
    await assert.rejects(() => f.coordinator.process(f.request, f.input));
    assert.equal(
      (
        JSON.parse((await f.store.read('journal', f.request.outputId)).toString()) as {
          phase: string;
        }
      ).phase,
      'SANITIZED',
    );
  } finally {
    await f.dispose();
  }
});
for (const category of [
  'TIMEOUT',
  'RESOURCE_LIMIT',
  'DECODE_FAILURE',
  'INTERNAL',
  'OUTPUT_VERIFICATION',
] as Category[]) {
  test(`${category} cleans source/intermediates/output and never approves`, async () => {
    let approves = 0;
    const f = await fixture(async () => {
      throw new Failure(category);
    });
    const c = new Coordinator(
      f.store,
      {
        finish: async (_job, result) => {
          if (!('error' in result)) approves++;
          return true;
        },
      },
      async () => {
        throw new Failure(category);
      },
    );
    try {
      const r = await c.process(f.request, f.input);
      assert.ok('category' in r);
      assert.equal(r.category, category);
      assert.equal(approves, 0);
      for (const area of ['incoming', 'working', 'sanitized'])
        assert.deepEqual(await fs.readdir(path.join(f.store.root, area)), []);
      await f.store.remove('incoming', f.input);
      await f.store.remove('sanitized', f.request.outputId);
    } finally {
      await f.dispose();
    }
  });
}
test('late successful decoder result after cancellation is discarded', async () => {
  const abort = new AbortController();
  let approvals = 0;
  const f = await fixture(
    async (...args) => {
      const result = await inProcess(...args);
      abort.abort();
      return result;
    },
    async () => {
      approvals++;
      return true;
    },
  );
  try {
    const result = await f.coordinator.process(f.request, f.input, abort.signal);
    assert.equal(result.status, 'CANCELLED');
    assert.equal(approvals, 0);
    assert.deepEqual(await fs.readdir(path.join(f.store.root, 'sanitized')), []);
  } finally {
    await f.dispose();
  }
});
for (const fence of [
  'cancel',
  'replace',
  'newer-revision',
  'delete',
  'account-delete',
  'lease-expiry',
])
  test(`authoritative ${fence} refuses late success and removes output`, async () => {
    const f = await fixture(inProcess, async () => false);
    try {
      const result = await f.coordinator.process(f.request, f.input);
      assert.ok('category' in result);
      assert.equal(result.category, 'STALE_REVISION');
      assert.deepEqual(await fs.readdir(path.join(f.store.root, 'sanitized')), []);
    } finally {
      await f.dispose();
    }
  });
test('expired deadline and source digest mismatch cannot reach the decoder', async () => {
  for (const override of [{ deadline: Date.now() - 1 }, { inputDigest: 'f'.repeat(64) }]) {
    const f = await fixture(async () => {
      assert.fail('decoder must not start');
    });
    try {
      const r = await f.coordinator.process({ ...f.request, ...override }, f.input);
      assert.ok('category' in r);
      assert.equal(r.category, 'deadline' in override ? 'TIMEOUT' : 'STALE_REVISION');
    } finally {
      await f.dispose();
    }
  }
});
test('uncertain commit preserves output and durable COMMITTING journal', async () => {
  const f = await fixture(inProcess, async () => {
    throw new Error('private credential and source metadata');
  });
  try {
    const r = await f.coordinator.process(f.request, f.input);
    assert.equal(r.status, 'PENDING');
    await verify(await f.store.read('sanitized', f.request.outputId));
    assert.equal(
      JSON.parse((await f.store.read('journal', f.request.outputId)).toString()).phase,
      'COMMITTING',
    );
    assert.ok(!JSON.stringify(f.events).includes('credential'));
  } finally {
    await f.dispose();
  }
});
test('concurrency is bounded across coordinators sharing a runtime', async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const f = await fixture(async (...args) => {
    entered();
    await wait;
    return inProcess(...args);
  });
  try {
    const pending = f.coordinator.process(f.request, f.input);
    await started;
    await assert.rejects(() => f.coordinator.process(job(source), f.input), /BUSY/);
    const other = new Coordinator(f.store, { finish: async () => true }, inProcess);
    await assert.rejects(() => other.process(job(source), f.input), /BUSY/);
    release();
    assert.equal((await pending).status, 'SUCCESS');
  } finally {
    release();
    await f.dispose();
  }
});
test('path traversal, absolute references, extension names, symlinks, hardlinks and directories fail closed', async () => {
  const f = await fixture();
  const outside = await fs.mkdtemp(path.join(tmpdir(), 'kitchencam-f-outside-'));
  try {
    for (const ref of ['../private', '/etc/passwd', '..', `${randomUUID()}.jpg`])
      await assert.rejects(() => f.store.read('incoming', ref), /PATH_INVALID/);
    const secret = path.join(outside, 'original');
    await fs.writeFile(secret, 'private sentinel');
    const link = randomUUID();
    await fs.symlink(secret, path.join(f.store.root, 'incoming', link));
    await assert.rejects(() => f.store.read('incoming', link));
    const hard = randomUUID();
    await fs.link(secret, path.join(f.store.root, 'incoming', hard));
    await assert.rejects(() => f.store.read('incoming', hard), /PATH_INVALID/);
    const folder = randomUUID();
    await fs.mkdir(path.join(f.store.root, 'incoming', folder));
    await assert.rejects(() => f.store.read('incoming', folder), /PATH_INVALID/);
    await f.store.remove('incoming', link);
    assert.equal(await fs.readFile(secret, 'utf8'), 'private sentinel');
    await fs.rename(path.join(f.store.root, 'sanitized'), path.join(f.store.root, 'saved'));
    await fs.symlink(outside, path.join(f.store.root, 'sanitized'));
    await assert.rejects(() => f.store.write('sanitized', randomUUID(), source), /PATH_INVALID/);
    assert.equal(await fs.readFile(secret, 'utf8'), 'private sentinel');
  } finally {
    await f.dispose();
    await fs.rm(outside, { recursive: true, force: true });
  }
});
test('tampered or undecodable output cannot reach finish success', async () => {
  for (const bytes of [
    Buffer.from('not an image'),
    Buffer.alloc(4 * 1024 * 1024 + 1),
    await base().withMetadata().jpeg().toBuffer(),
  ]) {
    let approvals = 0;
    const f = await fixture(
      async () => ({ bytes, metrics }),
      async () => {
        approvals++;
        return true;
      },
    );
    try {
      const r = await f.coordinator.process(f.request, f.input);
      assert.notEqual(r.status, 'SUCCESS');
      assert.ok(approvals <= 1);
      assert.deepEqual(await fs.readdir(path.join(f.store.root, 'sanitized')), []);
    } finally {
      await f.dispose();
    }
  }
});
test('recovery preserves uncertain trust until authoritative deletion and retries a nonfinal acknowledgement', async () => {
  const f = await fixture(inProcess, async () => {
    throw new Error('lost acknowledgement');
  });
  try {
    assert.equal((await f.coordinator.process(f.request, f.input)).status, 'PENDING');
    const record = JSON.parse((await f.store.read('journal', f.request.outputId)).toString());
    record.job.deadline = Date.now() - 1;
    await f.store.record(f.request.outputId, record);
    await f.coordinator.recover();
    await verify(await f.store.read('sanitized', f.request.outputId));
    let final = false;
    const deleted: string[] = [];
    const rpc: import('../lifecycle.ts').Rpc = async (name, body) => {
      if (name === 'internal_scan_claim_cleanup')
        return [f.request.inputId, f.request.outputId, randomUUID()].map((imageId) => ({
          imageId,
          token: randomUUID(),
        }));
      assert.equal(name, 'internal_scan_ack_cleanup');
      assert.ok([f.request.inputId, f.request.outputId].includes(String(body.p_image)));
      if (body.p_image === f.request.outputId)
        assert.deepEqual(await fs.readdir(await f.store.directory('sanitized')), []);
      deleted.push(String(body.p_image));
      return final;
    };
    await f.coordinator.recover(rpc);
    assert.equal((await fs.readdir(await f.store.directory('journal'))).length, 1);
    final = true;
    await f.coordinator.recover(rpc);
    assert.deepEqual(await fs.readdir(await f.store.directory('journal')), []);
    assert.equal(deleted.length, 4);
  } finally {
    await f.dispose();
  }
});
test('crash recovery removes orphan files and never follows a stale PID lock', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.store.root, 'lock'), 'stale PID 999999');
    for (const area of ['working', 'sanitized'] as const)
      await f.store.write(area, randomUUID(), source);
    await f.coordinator.recover();
    for (const area of ['incoming', 'working', 'sanitized'] as const)
      assert.deepEqual(await fs.readdir(await f.store.directory(area)), []);
  } finally {
    await f.dispose();
  }
});
test('kernel runtime lock is released after coordinator process death', async () => {
  const { spawn } = await import('node:child_process');
  const store = await Store.create(tmpdir());
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {Store} from ${JSON.stringify(new URL('../storage.ts', import.meta.url).href)};await new Store(${JSON.stringify(store.root)}).lock();process.stdout.write('READY');setInterval(()=>{},1000);`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', () => reject(new Error('lock child exited early')));
    });
    await assert.rejects(() => store.lock(), /BUSY/);
    const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await stopped;
    let unlocked = false;
    for (let i = 0; i < 50; i++) {
      try {
        const release = await store.lock();
        await release();
        unlocked = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    assert.equal(unlocked, true);
  } finally {
    child.kill('SIGKILL');
    await fs.rm(store.root, { recursive: true, force: true });
  }
});
test('shared raw cleanup cannot acknowledge bytes retained by a newer live attempt', async () => {
  const f = await fixture();
  try {
    const old = {
      job: { ...f.request, deadline: Date.now() - 1 },
      inputRef: f.input,
      attempt: randomUUID(),
      phase: 'REJECTED',
    };
    const current = {
      job: job(source, { inputId: f.request.inputId }),
      inputRef: randomUUID(),
      attempt: randomUUID(),
      phase: 'SANITIZING',
    };
    await f.store.write('journal', old.job.outputId, Buffer.from(JSON.stringify(old)));
    await f.store.write('journal', current.job.outputId, Buffer.from(JSON.stringify(current)));
    await f.store.write('incoming', current.inputRef, source);
    const acknowledged: string[] = [];
    const rpc: import('../lifecycle.ts').Rpc = async (name, body) => {
      if (name === 'internal_scan_claim_cleanup')
        return [{ imageId: f.request.inputId, token: randomUUID() }];
      acknowledged.push(String(body.p_image));
      return true;
    };
    await f.coordinator.recover(rpc);
    assert.deepEqual(await f.store.read('incoming', current.inputRef), source);
    assert.deepEqual(
      acknowledged,
      [],
      'retained live source forbids final physical cleanup acknowledgement',
    );
  } finally {
    await f.dispose();
  }
});
