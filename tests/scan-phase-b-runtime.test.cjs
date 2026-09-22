const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');

// Explicit local-only workflow. No env files, remote URLs, providers or household images.
let local;
let admin;
const users = [];
const scans = new Set();
const objects = [];
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(statement) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_kitchencam',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: statement,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}
function successful(result, label) {
  assert.equal(result.error?.code ?? null, null, label);
  return result.data;
}
async function create(actor, key = randomUUID(), source = 'manual') {
  const row = successful(
    await actor.client.rpc('create_scan', {
      p_key: key,
      p_source: source,
      p_ingredients: [],
    }),
    'create local scan',
  );
  scans.add(row.id);
  return row;
}
async function mutate(actor, scan, key, operation, body) {
  return actor.client.rpc('mutate_scan', {
    p_scan: scan,
    p_key: key,
    p_operation: operation,
    p_body: body,
  });
}
const ingredient = () => ({
  id: randomUUID(),
  displayName: 'Owner review ingredient',
  normalizedName: null,
  canonicalId: null,
  selected: true,
  quantity: null,
  provenance: 'manual',
  detectionId: null,
});
async function editable(actor) {
  const row = await create(actor);
  return successful(
    await mutate(actor, row.id, randomUUID(), 'ingredients', {
      expectedVersion: row.version,
      expectedDraftRevision: row.draft_revision,
      ingredients: [ingredient()],
    }),
    'editable draft',
  );
}

// Hold a real database transaction while a service RPC attempts to enter it.
// Observe the lock wait before committing the competing owner operation.
async function fenceWaitingWorker(actor, scan, lease, fence, target = actor) {
  const marker = `owner-review-${randomUUID()}`;
  const locker = spawn(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_kitchencam',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  const closed = new Promise((resolve, reject) => {
    locker.on('error', reject);
    locker.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error('fence transaction failed')),
    );
  });
  const locked = new Promise((resolve) =>
    locker.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes(marker)) resolve();
    }),
  );
  locker.stdin.write(`begin; set local statement_timeout='10s';
    select 1 from auth.users where id in (${sqlLiteral(actor.id)},${sqlLiteral(target.id)}) order by id for update;
    select ${sqlLiteral(marker)};\n`);
  try {
    await Promise.race([
      locked,
      new Promise((_, reject) => setTimeout(() => reject(new Error('lock timeout')), 5000)),
    ]);
    const pending = admin
      .rpc('internal_scan_finish_job', {
        p_job: lease.jobId,
        p_lease: lease.leaseToken,
        p_body: {
          imageId: lease.output.id,
          digest: 'c'.repeat(64),
          bytes: 100,
          width: 256,
          height: 256,
          sanitizerVersion: 'phase-a-v1',
        },
      })
      .then((result) => result);
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      waiting =
        Number(
          sql(
            "select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%internal_scan_finish_job%';",
          ),
        ) > 0;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiting, 'worker completion really waits behind the lifecycle transaction');
    const claims = JSON.stringify({
      sub: target.id,
      role: 'authenticated',
      is_anonymous: target === actor,
      amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
    });
    locker.stdin.end(
      `select set_config('request.jwt.claims',${sqlLiteral(claims)},true); ${fence} commit;\n`,
    );
    await closed;
    const result = await pending;
    assert.ok(
      result.data === false || result.error?.message === 'ACCOUNT_NOT_ACTIVE',
      'stale successful result is fenced',
    );
    assert.equal(
      sql(
        `select count(*) from private.scan_images where original_scan_id=${sqlLiteral(scan.id)} and approved_at is not null;`,
      ),
      '0',
    );
  } finally {
    if (!locker.stdin.writableEnded) locker.stdin.end('rollback;\n');
    await closed;
  }
}

async function processing(actor) {
  const scan = await create(actor, randomUUID(), 'camera');
  const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  sql('update private.scan_processing_policy set enabled=true;');
  try {
    const upload = successful(
      await admin.rpc('internal_scan_upload', {
        p_owner: actor.id,
        p_scan: scan.id,
        p_key: randomUUID(),
        p_operation: 'authorize',
        p_body: { expectedVersion: 1, imageRevision: 1, tokenHash, noticeVersion: 'phase-a-v1' },
      }),
      'upload authorization',
    );
    for (const operation of ['claim', 'complete']) {
      successful(
        await admin.rpc('internal_scan_upload', {
          p_owner: actor.id,
          p_scan: scan.id,
          p_key: randomUUID(),
          p_operation: operation,
          p_body: {
            uploadId: upload.uploadId,
            tokenHash,
            ...(operation === 'complete'
              ? { bytes: 100, width: 256, height: 256, digest: 'b'.repeat(64), mime: 'image/jpeg' }
              : {}),
          },
        }),
        operation,
      );
    }
    return {
      scan,
      lease: successful(
        await admin.rpc('internal_scan_claim_job', {
          p_scan: scan.id,
          p_stage: 'sanitize',
        }),
        'sanitizer lease',
      ),
    };
  } finally {
    sql('update private.scan_processing_policy set enabled=false;');
  }
}
before(async () => {
  local = JSON.parse(
    execFileSync(path.resolve('node_modules/.bin/supabase'), ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const url = new URL(local.API_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.protocol, 'http:');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth });
  for (let index = 0; index < 2; index += 1) {
    const client = createClient(local.API_URL, local.ANON_KEY, { auth });
    const { user } = successful(await client.auth.signInAnonymously(), 'guest fixture');
    users.push({ client, id: user.id });
  }
});
after(async () => {
  for (const object of objects) {
    successful(
      await admin.storage.from('scan-raw-private').remove([object]),
      'fixture media cleanup',
    );
  }
  for (const actor of users) {
    const result = await admin.auth.admin.deleteUser(actor.id);
    assert.ok(!result.error || result.error.code === 'user_not_found', 'fixture Auth cleanup');
    await actor.client.auth.stopAutoRefresh();
  }
  // Only receipts for scans created by this suite; no preexisting rows touched.
  if (scans.size) {
    const ids = [...scans].map(sqlLiteral).join(',');
    sql(
      `delete from private.scan_images where original_scan_id in (${ids}); delete from public.scan_deletions where scan_id in (${ids});`,
    );
  }
});

test('simultaneous identical create requests commit a single operation', async () => {
  const key = randomUUID();
  const rows = await Promise.all(Array.from({ length: 8 }, () => create(users[0], key)));
  assert.equal(new Set(rows.map((row) => row.id)).size, 1);
  assert.equal(
    sql(
      `select count(*) from private.scan_operations where owner_id=${sqlLiteral(users[0].id)} and key=${sqlLiteral(key)};`,
    ),
    '1',
  );
});

test('same expected revision has one winner and same-key retry recovers the acknowledgement', async () => {
  const row = await create(users[0]);
  const keyA = randomUUID();
  const keyB = randomUUID();
  const ingredient = {
    id: randomUUID(),
    displayName: 'Test ingredient',
    normalizedName: null,
    canonicalId: null,
    selected: true,
    quantity: null,
    provenance: 'manual',
    detectionId: null,
  };
  const body = { expectedVersion: 1, expectedDraftRevision: 1, ingredients: [ingredient] };
  const results = await Promise.all([
    mutate(users[0], row.id, keyA, 'ingredients', body),
    mutate(users[0], row.id, keyB, 'ingredients', body),
  ]);
  assert.equal(results.filter((r) => r.error === null).length, 1);
  assert.equal(results.find((r) => r.error)?.error.message, 'VERSION_CONFLICT');
  const winner = results[0].error === null ? keyA : keyB;
  const replay = successful(
    await mutate(users[0], row.id, winner, 'ingredients', body),
    'lost ack retry',
  );
  assert.equal(replay.version, 2);
  assert.equal(replay.draft_revision, 2);
  const confirmations = await Promise.all(
    Array.from({ length: 4 }, () =>
      mutate(users[0], row.id, randomUUID(), 'confirm', { expectedVersion: 2, draftRevision: 2 }),
    ),
  );
  assert.equal(confirmations.filter((r) => r.error === null).length, 1);
  assert.equal(confirmations.filter((r) => r.error?.message === 'VERSION_CONFLICT').length, 3);
});

test('real client roles cannot access another scan or server authority', async () => {
  const row = await create(users[0]);
  assert.deepEqual(
    successful(
      await users[1].client.from('scans').select('*').eq('id', row.id),
      'other owner read',
    ),
    [],
  );
  assert.ok((await users[0].client.from('scans').update({ version: 900 }).eq('id', row.id)).error);
  assert.ok(
    (await users[0].client.rpc('internal_scan_claim_job', { p_scan: row.id, p_stage: 'sanitize' }))
      .error,
  );
  const anon = createClient(local.API_URL, local.ANON_KEY, { auth });
  assert.ok(
    (await anon.rpc('create_scan', { p_key: randomUUID(), p_source: 'manual', p_ingredients: [] }))
      .error,
  );
  assert.equal(
    (await mutate(users[1], row.id, randomUUID(), 'cancel', { expectedVersion: 1 })).error.message,
    'NOT_FOUND',
  );
});

test('cancellation racing a draft save cannot be undone by the losing write', async () => {
  const row = await create(users[0]);
  const results = await Promise.all([
    mutate(users[0], row.id, randomUUID(), 'cancel', { expectedVersion: 1 }),
    mutate(users[0], row.id, randomUUID(), 'ingredients', {
      expectedVersion: 1,
      expectedDraftRevision: 1,
      ingredients: [],
    }),
  ]);
  assert.equal(results.filter((r) => r.error === null).length, 1);
  const current = successful(
    await users[0].client.from('scans').select('*').eq('id', row.id).single(),
    'current scan',
  );
  if (current.state !== 'cancelled')
    successful(
      await mutate(users[0], row.id, randomUUID(), 'cancel', { expectedVersion: current.version }),
      'cancel current revision',
    );
  const terminal = await mutate(users[0], row.id, randomUUID(), 'ingredients', {
    expectedVersion: 3,
    expectedDraftRevision: 2,
    ingredients: [],
  });
  assert.ok(terminal.error);
  assert.equal(
    successful(
      await users[0].client.from('scans').select('state').eq('id', row.id).single(),
      'terminal scan',
    ).state,
    'cancelled',
  );
});

test('concurrent conflicting reuse of a creation key has one winner', async () => {
  const key = randomUUID();
  const results = await Promise.all(
    ['manual', 'camera'].map((source) =>
      users[1].client.rpc('create_scan', {
        p_key: key,
        p_source: source,
        p_ingredients: [],
      }),
    ),
  );
  assert.equal(results.filter((result) => result.error === null).length, 1);
  assert.equal(results.find((result) => result.error)?.error.message, 'IDEMPOTENCY_CONFLICT');
  scans.add(results.find((result) => result.data)?.data.id);
});

for (const operation of ['ingredients', 'cancel']) {
  test(`confirmation racing ${operation} commits exactly one current revision`, async () => {
    const row = await editable(users[1]);
    const results = await Promise.all([
      mutate(users[1], row.id, randomUUID(), 'confirm', {
        expectedVersion: row.version,
        draftRevision: row.draft_revision,
      }),
      mutate(users[1], row.id, randomUUID(), operation, {
        expectedVersion: row.version,
        ...(operation === 'ingredients'
          ? { expectedDraftRevision: row.draft_revision, ingredients: [ingredient()] }
          : {}),
      }),
    ]);
    assert.equal(results.filter((result) => result.error === null).length, 1);
    assert.equal(results.find((result) => result.error)?.error.message, 'VERSION_CONFLICT');
    const current = successful(
      await users[1].client.from('scans').select('*').eq('id', row.id).single(),
    );
    assert.equal(current.version, row.version + 1);
    assert.equal(
      current.state,
      results[0].error === null
        ? 'confirmed'
        : operation === 'cancel'
          ? 'cancelled'
          : 'needs_confirmation',
    );
    assert.deepEqual(
      current.confirmed_ingredients,
      current.state === 'confirmed' ? row.ingredients : null,
    );
  });
}

for (const operation of ['replace', 'cancel', 'delete', 'account-delete', 'merge']) {
  test(`${operation} fences a successful worker result observed waiting on the lifecycle lock`, async () => {
    const client = createClient(local.API_URL, local.ANON_KEY, { auth });
    const { user } = successful(await client.auth.signInAnonymously());
    const actor = { client, id: user.id };
    users.push(actor);
    const { scan, lease } = await processing(actor);
    let target = actor;
    let fence;
    if (operation === 'merge') {
      const email = `review-${randomUUID()}@example.test`;
      const password = randomUUID();
      const { user: permanent } = successful(
        await admin.auth.admin.createUser({ email, password, email_confirm: true }),
      );
      const targetClient = createClient(local.API_URL, local.ANON_KEY, { auth });
      successful(await targetClient.auth.signInWithPassword({ email, password }));
      target = { client: targetClient, id: permanent.id };
      users.push(target);
      const hash = createHash('sha256').update(randomUUID()).digest('hex');
      successful(
        await actor.client.rpc('issue_account_merge_ticket', {
          p_token_hash: hash,
          p_expires_at: new Date(Date.now() + 600000).toISOString(),
        }),
      );
      fence = `select * from public.consume_account_merge_ticket(${sqlLiteral(hash)},gen_random_uuid());`;
    } else if (operation === 'account-delete') {
      fence = 'select public.request_account_deletion(gen_random_uuid());';
    } else {
      fence = `select public.mutate_scan(id,gen_random_uuid(),${sqlLiteral(operation)},jsonb_build_object('expectedVersion',version)) from public.scans where id=${sqlLiteral(scan.id)};`;
    }
    await fenceWaitingWorker(actor, scan, lease, fence, target);
    assert.equal(
      sql(
        `select count(*) from private.scan_jobs where scan_id=${sqlLiteral(scan.id)} and state in ('pending','running');`,
      ),
      '0',
    );
    assert.equal(
      sql(
        `select count(*) from private.scan_upload_authorizations where scan_id=${sqlLiteral(scan.id)} and revoked_at is null;`,
      ),
      '0',
    );
    if (operation === 'merge') {
      assert.equal(
        sql(`select owner_id::text from public.scans where id=${sqlLiteral(scan.id)};`),
        target.id,
      );
    }
    if (operation === 'account-delete') {
      assert.equal(
        (
          await admin.rpc('internal_scan_upload', {
            p_owner: actor.id,
            p_scan: scan.id,
            p_key: randomUUID(),
            p_operation: 'authorize',
            p_body: {},
          })
        ).error?.message,
        'ACCOUNT_NOT_ACTIVE',
      );
    }
  });
}

test('a delayed cleanup acknowledgement cannot lose a physical late write across the deadline', async () => {
  const scan = await create(users[1], randomUUID(), 'camera');
  const id = randomUUID();
  const object = `${users[1].id}/${randomUUID()}`;
  objects.push(object);
  sql(`insert into private.scan_images(id,scan_id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,write_deadline,delete_by,delete_requested_at)
    values(${sqlLiteral(id)},${sqlLiteral(scan.id)},${sqlLiteral(scan.id)},${sqlLiteral(users[1].id)},1,1,'raw','scan-raw-private',${sqlLiteral(object)},clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '1 hour',clock_timestamp());`);
  const claim = successful(await admin.rpc('internal_scan_claim_cleanup')).find(
    (row) => row.imageId === id,
  );
  assert.ok(claim);
  successful(await admin.storage.from('scan-raw-private').remove([object]));
  successful(
    await admin.storage
      .from('scan-raw-private')
      .upload(object, Buffer.from('late bytes'), { contentType: 'image/jpeg' }),
  );
  sql(
    `update private.scan_images set write_deadline=clock_timestamp() where id=${sqlLiteral(id)};`,
  );
  assert.equal(
    successful(await admin.rpc('internal_scan_ack_cleanup', { p_image: id, p_token: claim.token })),
    false,
  );
  assert.ok(successful(await admin.storage.from('scan-raw-private').download(object)));
  assert.equal(
    sql(
      `select count(*) from private.scan_images where id=${sqlLiteral(id)} and cleaned_at is null and object_path=${sqlLiteral(object)};`,
    ),
    '1',
  );
  const finalClaim = successful(await admin.rpc('internal_scan_claim_cleanup')).find(
    (row) => row.imageId === id,
  );
  successful(await admin.storage.from('scan-raw-private').remove([object]));
  assert.equal(
    successful(
      await admin.rpc('internal_scan_ack_cleanup', { p_image: id, p_token: finalClaim.token }),
    ),
    true,
  );
  assert.ok((await admin.storage.from('scan-raw-private').download(object)).error);
});

test('merged media and a late write remain pending until real account cleanup finishes', async () => {
  const guest = users[0];
  const row = await create(guest, randomUUID(), 'camera');
  const image = randomUUID();
  const object = `${guest.id}/${randomUUID()}`;
  objects.push(object);
  sql(`insert into private.scan_images(id,scan_id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,write_deadline,delete_by)
    values(${sqlLiteral(image)},${sqlLiteral(row.id)},${sqlLiteral(row.id)},${sqlLiteral(guest.id)},1,1,'raw','scan-raw-private',${sqlLiteral(object)},clock_timestamp()+interval '60 seconds',clock_timestamp()+interval '23 hours');`);
  successful(
    await admin.storage
      .from('scan-raw-private')
      .upload(object, Buffer.from('synthetic quarantine fixture'), { contentType: 'image/jpeg' }),
    'quarantine fixture',
  );
  const email = `scan-merge-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { user } = successful(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'permanent fixture',
  );
  const client = createClient(local.API_URL, local.ANON_KEY, { auth });
  const target = { id: user.id, client };
  users.push(target);
  successful(await client.auth.signInWithPassword({ email, password }), 'target sign-in');
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  successful(
    await guest.client.rpc('issue_account_merge_ticket', {
      p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_expires_at: new Date(Date.now() + 600000).toISOString(),
    }),
    'merge ticket',
  );
  const { session } = successful(await client.auth.getSession(), 'target session');
  async function edge(name, body) {
    return fetch(`${local.API_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: local.ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
  assert.equal((await edge('account-merge', { token })).status, 200);
  assert.equal(
    successful(
      await client.from('scans').select('owner_id').eq('id', row.id).single(),
      'transferred scan',
    ).owner_id,
    target.id,
  );
  assert.equal(
    (await edge('account-delete', {})).status,
    503,
    'possible late writer keeps deletion pending',
  );
  assert.deepEqual(successful(await client.from('scans').select('id'), 'pending owner read'), []);
  assert.equal(
    (
      await client.rpc('create_scan', {
        p_key: randomUUID(),
        p_source: 'manual',
        p_ingredients: [],
      })
    ).error?.message,
    'ACCOUNT_NOT_ACTIVE',
  );
  // Model a delayed external write after the first sweep, without deploying ingress.
  successful(
    await admin.storage
      .from('scan-raw-private')
      .upload(object, Buffer.from('synthetic late write'), {
        contentType: 'image/jpeg',
        upsert: true,
      }),
    'late-write fixture',
  );
  sql(
    `update private.scan_images set write_deadline=clock_timestamp()-interval '1 second',cleanup_lease_until=null where id=${sqlLiteral(image)};`,
  );
  assert.equal(
    (await edge('account-delete', {})).status,
    202,
    'retry drains former guest path and completes deletion',
  );
  assert.ok(
    (await admin.storage.from('scan-raw-private').download(object)).error,
    'late object is actually gone',
  );
  assert.equal(
    sql(
      `select count(*) from private.scan_images where id=${sqlLiteral(image)} and cleaned_at is not null and owner_id is null;`,
    ),
    '1',
  );
});

test('account lock makes a waiting creation recheck deletion status after commit', async () => {
  const actor = users[1];
  const marker = `phase-b-lock-${randomUUID()}`;
  const locker = spawn(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_kitchencam',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  const closed = new Promise((resolve, reject) => {
    locker.on('error', reject);
    locker.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error('lock fixture failed')),
    );
  });
  const locked = new Promise((resolve) => {
    locker.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes(marker)) resolve();
    });
  });
  locker.stdin.write(
    `begin; select 1 from private.account_controls where user_id=${sqlLiteral(actor.id)} for update; select ${sqlLiteral(marker)};\n`,
  );
  try {
    await Promise.race([
      locked,
      new Promise((_, reject) => setTimeout(() => reject(new Error('lock setup timeout')), 5000)),
    ]);
    const pending = actor.client
      .rpc('create_scan', { p_key: randomUUID(), p_source: 'manual', p_ingredients: [] })
      .then((result) => result);
    // Observe a real wait, not merely two sequential requests with the same revision.
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      waiting =
        Number(
          sql(
            "select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%create_scan%';",
          ),
        ) > 0;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiting, 'creation is blocked on the account lifecycle lock');
    locker.stdin.end(
      `update private.account_controls set status='deletion_pending',deletion_requested_at=clock_timestamp() where user_id=${sqlLiteral(actor.id)}; commit;\n`,
    );
    await closed;
    assert.equal((await pending).error?.message, 'ACCOUNT_NOT_ACTIVE');
  } finally {
    if (!locker.stdin.writableEnded) locker.stdin.end('rollback;\n');
    await closed;
  }
});
