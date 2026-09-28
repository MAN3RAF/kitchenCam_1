import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execute } from '../runtime.ts';

test('untrusted output flood starts at most one Docker kill request', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'kitchencam-f-flood-'));
  const originalPath = process.env.PATH;
  const log = path.join(root, 'calls');
  try {
    // Real subprocess/pipe execution; a delayed Docker-control response models
    // bytes continuing to arrive after the first output-limit violation.
    await fs.writeFile(
      path.join(root, 'docker'),
      `#!${process.execPath}\nconst fs=require('node:fs');const command=process.argv[2];fs.appendFileSync(${JSON.stringify(log)},command+'\\n');if(command==='run'){let n=0;const timer=setInterval(()=>{process.stdout.write(Buffer.alloc(2048));if(++n===12){clearInterval(timer);process.exitCode=1;}},20);}else if(command==='kill'){setTimeout(()=>{},300);}`,
      { mode: 0o700 },
    );
    process.env.PATH = root + path.delimiter + originalPath;
    await assert.rejects(
      () => execute('/unused', 'verify', new AbortController().signal, Date.now() + 10000),
      /OUTPUT_VERIFICATION/,
    );
    const calls = (await fs.readFile(log, 'utf8')).trim().split('\n');
    assert.equal(
      calls.filter((c) => c === 'kill').length,
      1,
      'one limit violation must not fan out into supervisor subprocesses',
    );
    assert.equal(calls.filter((c) => c === 'rm').length, 1);
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(root, { recursive: true, force: true });
  }
});
for (const operation of ['inspect', 'rm'])
  test(`deadline that expires during Docker ${operation} cannot return successful output`, async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'kitchencam-f-inspect-'));
    const originalPath = process.env.PATH;
    try {
      await fs.writeFile(
        path.join(root, 'docker'),
        `#!${process.execPath}\nconst command=process.argv[2];if(command==='run'){process.stdout.write('{}');process.stderr.write(JSON.stringify({category:'SUCCESS',elapsedMs:1,cpuMs:1,peakRssKiB:1}));}else if(command==='inspect'||command==='rm'){setTimeout(()=>process.stdout.write('{"OOMKilled":false}'),command===${JSON.stringify(operation)}?400:0);}`,
        { mode: 0o700 },
      );
      process.env.PATH = root + path.delimiter + originalPath;
      await assert.rejects(
        () => execute('/unused', 'verify', new AbortController().signal, Date.now() + 200),
        /TIMEOUT/,
      );
    } finally {
      process.env.PATH = originalPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
