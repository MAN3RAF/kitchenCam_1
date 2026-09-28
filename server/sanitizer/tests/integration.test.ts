import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Store } from '../storage.ts';
import { Coordinator, digest } from '../coordinator.ts';
import { PhaseBLifecycle } from '../lifecycle.ts';
import { localRpc } from '../service-rpc.ts';
import { base } from './fixtures.ts';
import { execute } from '../runtime.ts';
type Fixture = { owner: string; scan: string; raw: string; job: string };
const require = createRequire(import.meta.url);
const { sql, fixture, cleanup } = require('../../../tests/helpers/scan-fence.cjs') as {
  sql: (s: string) => string;
  fixture: (digest: string, size: number, w: number, h: number, claim: boolean) => Fixture;
  cleanup: (f: Fixture) => void;
};
const local = JSON.parse(
  execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
) as { API_URL: string; SERVICE_ROLE_KEY: string };
const rpc = localRpc(local.API_URL, local.SERVICE_ROLE_KEY);
for (const cancelled of [false, true])
  test(`real service RPC and Docker pipeline ${cancelled ? 'cancellation' : 'success'} with authoritative cleanup`, async () => {
    const bytes = await base().jpeg().toBuffer(),
      f = fixture(digest(bytes), bytes.length, 512, 384, false),
      store = await Store.create(tmpdir());
    try {
      const lifecycle = new PhaseBLifecycle(rpc),
        job = await lifecycle.claim(f.scan),
        input = await store.import(bytes);
      const coordinator = new Coordinator(store, lifecycle, async (...args) => {
        const result = await execute(...args);
        if (cancelled && args[1] === 'verify')
          sql(
            `begin;select set_config('request.jwt.claims','{"sub":"${f.owner}","role":"authenticated"}',true);select public.mutate_scan(id,gen_random_uuid(),'cancel',jsonb_build_object('expectedVersion',version)) from public.scans where id='${f.scan}';commit;`,
          );
        return result;
      });
      const result = await coordinator.process(job, input);
      assert.equal(result.status, cancelled ? 'REJECTED' : 'SUCCESS');
      assert.equal(
        sql(
          `select count(*) from private.scan_images where original_scan_id='${f.scan}' and approved_at is not null;`,
        ),
        cancelled ? '0' : '1',
      );
      assert.equal(
        sql(
          `select count(*) from private.scan_jobs where scan_id='${f.scan}' and stage='recognize';`,
        ),
        cancelled ? '0' : '1',
      );
      // Shorten only fixture deadlines to exercise restart cleanup without 60s waits.
      sql(
        `update private.scan_images set write_deadline=least(write_deadline,clock_timestamp()-interval '1 second'),delete_requested_at=clock_timestamp() where original_scan_id='${f.scan}';`,
      );
      const record = JSON.parse((await store.read('journal', job.outputId)).toString());
      record.job.deadline = Date.now() - 1;
      await store.record(job.outputId, record);
      await coordinator.recover(rpc);
      await coordinator.recover(rpc);
      for (const area of ['incoming', 'working', 'sanitized', 'journal'] as const)
        assert.deepEqual(await fs.readdir(await store.directory(area)), []);
      assert.equal(
        sql(
          `select count(*) from private.scan_images where original_scan_id='${f.scan}' and cleaned_at is null;`,
        ),
        '0',
      );
    } finally {
      cleanup(f);
      await fs.rm(store.root, { recursive: true, force: true });
    }
  });

test('retry attempts sharing a raw image complete all cleanup journals', async () => {
  const { Failure } = await import('../policy.ts');
  const bytes = await base().jpeg().toBuffer(),
    f = fixture(digest(bytes), bytes.length, 512, 384, false),
    store = await Store.create(tmpdir());
  try {
    const lifecycle = new PhaseBLifecycle(rpc),
      first = await lifecycle.claim(f.scan);
    const failed = new Coordinator(store, lifecycle, async () => {
      throw new Failure('INTERNAL');
    });
    assert.equal((await failed.process(first, await store.import(bytes))).status, 'FAILED');
    const second = await lifecycle.claim(f.scan);
    assert.equal(first.inputId, second.inputId);
    assert.notEqual(first.outputId, second.outputId);
    const coordinator = new Coordinator(store, lifecycle);
    assert.equal((await coordinator.process(second, await store.import(bytes))).status, 'SUCCESS');
    sql(
      `update private.scan_images set write_deadline=least(write_deadline,clock_timestamp()-interval '1 second'),delete_requested_at=clock_timestamp() where original_scan_id='${f.scan}';`,
    );
    for (const key of [first.outputId, second.outputId]) {
      const record = JSON.parse((await store.read('journal', key)).toString());
      record.job.deadline = Date.now() - 1;
      await store.record(key, record);
    }
    await coordinator.recover(rpc);
    await coordinator.recover(rpc);
    assert.equal(
      sql(
        `select count(*) from private.scan_images where original_scan_id='${f.scan}' and cleaned_at is null;`,
      ),
      '0',
    );
    assert.deepEqual(
      await fs.readdir(await store.directory('journal')),
      [],
      'shared raw cleanup acknowledgement must satisfy every retry obligation',
    );
  } finally {
    cleanup(f);
    await fs.rm(store.root, { recursive: true, force: true });
  }
});
