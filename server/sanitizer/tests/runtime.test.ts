import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Store } from '../storage.ts';
import { Coordinator } from '../coordinator.ts';
import { base, job } from './fixtures.ts';
import { verify } from '../codec.ts';

test('Docker encoder and separate verifier publish a locally owned JPEG', async () => {
  const store = await Store.create(tmpdir());
  try {
    const bytes = await base().png().toBuffer(),
      ref = await store.import(bytes);
    const c = new Coordinator(store, { finish: async () => true });
    const result = await c.process(job(bytes), ref);
    assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
    if (result.status === 'SUCCESS') {
      await verify(await store.read('sanitized', result.output.imageId));
      assert.equal(result.metrics.length, 2);
    }
  } finally {
    await fs.rm(store.root, { recursive: true, force: true });
  }
});
