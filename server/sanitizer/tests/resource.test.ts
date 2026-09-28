import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { containerArgs, docker, execute, image } from '../runtime.ts';
import { Store } from '../storage.ts';
import { corpus, noise } from './fixtures.ts';
const exec = promisify(execFile);
const evidence: unknown[] = [];
after(async () => {
  if (process.env.PHASE_F_EVIDENCE)
    await fs.writeFile(process.env.PHASE_F_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
});
async function probe(code: string) {
  const store = await Store.create(tmpdir()),
    name = `kitchencam-f-${randomUUID()}`;
  const key = randomUUID();
  await store.write('working', key, Buffer.from('probe'));
  const args = containerArgs(name, await store.target('working', key), 'encode');
  args.splice(
    args.indexOf(image),
    2,
    '--entrypoint',
    'node',
    image,
    '--max-old-space-size=64',
    '-e',
    code,
  );
  const started = performance.now();
  try {
    let output = '',
      exit = 0;
    try {
      output = (await exec('docker', args, { timeout: 15000, maxBuffer: 65536 })).stdout.trim();
    } catch (error) {
      if (
        typeof error !== 'object' ||
        !error ||
        !('code' in error) ||
        typeof error.code !== 'number'
      )
        throw error;
      exit = error.code;
    }
    const state = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', name])) as {
      OOMKilled: boolean;
    };
    return { output, exit, oom: state.OOMKilled, elapsedMs: performance.now() - started };
  } finally {
    await docker(['rm', '--force', name]);
    await fs.rm(store.root, { recursive: true, force: true });
  }
}
test('Docker enforces read-only root, UID, no capabilities, no network and configured cgroup bounds', async () => {
  const r = await probe(
    `const f=require('fs');let ro=false;try{f.writeFileSync('/owned','x')}catch(e){ro=e.code==='EROFS'};console.log(JSON.stringify({ro,uid:process.getuid(),status:f.readFileSync('/proc/self/status','utf8').match(/^(CapEff|NoNewPrivs):.*$/gm),net:f.readdirSync('/sys/class/net'),memory:f.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids:f.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:f.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim()}));`,
  );
  assert.equal(r.exit, 0);
  const v = JSON.parse(r.output);
  assert.equal(v.ro, true);
  assert.equal(v.uid, 1000);
  assert.deepEqual(v.net, ['lo']);
  assert.equal(v.memory, String(192 * 1024 * 1024));
  assert.equal(v.pids, '32');
  assert.equal(v.cpu, '100000 100000');
  assert.match(v.status.join(' '), /CapEff:\s+0+ /);
  assert.match(v.status.join(' '), /NoNewPrivs:\s+1/);
  evidence.push({ case: 'isolation', ...r });
});
test('memory exhaustion is killed by cgroup', async () => {
  const r = await probe(`const held=[];for(;;)held.push(Buffer.alloc(16*1024*1024,1));`);
  assert.equal(r.oom, true);
  assert.equal(r.exit, 137);
  evidence.push({ case: 'memory', ...r });
});
test('CPU exhaustion is killed by RLIMIT_CPU', async () => {
  const r = await probe('for(;;){}');
  assert.equal(r.exit, 137);
  assert.equal(r.oom, false);
  assert.ok(r.elapsedMs < 12000);
  evidence.push({ case: 'cpu', ...r });
});
test('tmpfs disk bound rejects additional writes', async () => {
  const r = await probe(
    `const f=require('fs');let bytes=0;try{for(let i=0;i<20;i++){f.writeFileSync('/tmp/'+i,Buffer.alloc(1024*1024));bytes+=1024*1024}}catch(e){console.log(JSON.stringify({code:e.code,bytes}))}`,
  );
  assert.equal(r.exit, 0);
  const v = JSON.parse(r.output);
  assert.equal(v.code, 'ENOSPC');
  assert.ok(v.bytes <= 8388608);
  evidence.push({ case: 'disk', ...r });
});
test('PID exhaustion rejects more children', async () => {
  const r = await probe(
    `const {spawn}=require('child_process');let failed=false;const children=[];for(let i=0;i<50;i++){const c=spawn('sleep',['10'],{stdio:'ignore'});children.push(c);c.on('error',e=>{if(e.code==='EAGAIN')failed=true})}setTimeout(()=>{console.log(JSON.stringify({failed}));for(const c of children)c.kill()},500)`,
  );
  assert.equal(r.exit, 0);
  assert.equal(JSON.parse(r.output).failed, true);
  evidence.push({ case: 'pids', ...r });
});
test('all malformed corpus entries run through the bounded Docker decoder', async () => {
  const store = await Store.create(tmpdir());
  try {
    for (const item of await corpus()) {
      // The oversized fixture is rejected by parent admission before container creation.
      if (item.name === 'over-byte-cap') {
        await assert.rejects(() => store.import(item.bytes), /IMAGE_TOO_LARGE/);
        continue;
      }
      const key = randomUUID(),
        file = await store.target('working', key);
      await fs.writeFile(file, item.bytes, { mode: 0o444 });
      let accepted = false;
      let metrics: unknown;
      try {
        const result = await execute(
          file,
          'encode',
          new AbortController().signal,
          Date.now() + 10000,
        );
        accepted = true;
        metrics = result.metrics;
      } catch (error) {
        metrics = { category: error instanceof Error ? error.message : 'INTERNAL' };
      }
      assert.equal(accepted, item.accepted, item.name);
      evidence.push({ case: item.name, accepted, inputBytes: item.bytes.length, metrics });
      await store.remove('working', key);
    }
  } finally {
    await fs.rm(store.root, { recursive: true, force: true });
  }
});
test('representative image sizes have measured Docker output and resources', async () => {
  const store = await Store.create(tmpdir());
  try {
    for (const [width, height] of [
      [1024, 768],
      [2048, 1536],
      [4000, 3000],
    ]) {
      const bytes = await noise(width!, height!),
        key = randomUUID(),
        file = await store.target('working', key);
      await fs.writeFile(file, bytes, { mode: 0o444 });
      const result = await execute(
        file,
        'encode',
        new AbortController().signal,
        Date.now() + 15000,
      );
      assert.ok(result.bytes.length <= 4 * 1024 * 1024);
      assert.ok(result.metrics.peakRssKiB < 192 * 1024);
      evidence.push({
        case: `${width}x${height}`,
        inputBytes: bytes.length,
        outputBytes: result.bytes.length,
        ...result.metrics,
      });
      await store.remove('working', key);
    }
  } finally {
    await fs.rm(store.root, { recursive: true, force: true });
  }
});
test('parent deadline and cancellation terminate the container without output publication', async () => {
  const store = await Store.create(tmpdir()),
    key = randomUUID(),
    file = await store.target('working', key);
  try {
    await fs.writeFile(file, await noise(4000, 3000), { mode: 0o444 });
    await assert.rejects(
      () => execute(file, 'encode', new AbortController().signal, Date.now() + 50),
      /TIMEOUT/,
    );
    const abort = new AbortController(),
      pending = execute(file, 'encode', abort.signal, Date.now() + 10000);
    const timer = setTimeout(() => abort.abort(), 100);
    try {
      await assert.rejects(() => pending, /CANCELLED/);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await fs.rm(store.root, { recursive: true, force: true });
  }
});
test('in-container five second watchdog survives loss of the host caller', async () => {
  const name = `kitchencam-f-${randomUUID()}`,
    store = await Store.create(tmpdir()),
    key = randomUUID();
  try {
    await store.write('working', key, Buffer.from('probe'));
    const args = containerArgs(name, await store.target('working', key), 'encode');
    args.splice(
      args.indexOf(image),
      2,
      '--entrypoint',
      'timeout',
      image,
      '--signal=KILL',
      '5s',
      'node',
      '-e',
      'setInterval(()=>{},1000)',
    );
    const started = performance.now();
    await assert.rejects(
      () => exec('docker', args, { timeout: 10000 }),
      (error) =>
        typeof error === 'object' && error !== null && 'code' in error && error.code === 137,
    );
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 9000);
    evidence.push({ case: 'internal-wall', elapsedMs });
  } finally {
    await docker(['rm', '--force', name]);
    await fs.rm(store.root, { recursive: true, force: true });
  }
});
