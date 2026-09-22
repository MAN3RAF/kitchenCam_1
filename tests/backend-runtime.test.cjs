const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const ts = require('typescript');

// Explicit opt-in workflow: never load credentials from an env file or a remote project.
let local;
let admin;
let guest;
let owner;
let other;
const users = new Set();
const objects = [];
const clients = [];
const buckets = ['scan-raw-private', 'scan-retained-private'];
const nonce = randomUUID();
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function success(result, label) {
  assert.equal(result.error?.code ?? result.error?.message ?? null, null, label);
  return result.data;
}

function client(options = {}) {
  const instance = createClient(local.API_URL, local.ANON_KEY, {
    auth: { ...authOptions, ...options },
  });
  clients.push(instance);
  return instance;
}

async function anonymous() {
  const instance = client();
  const { user } = success(await instance.auth.signInAnonymously(), 'anonymous sign-in');
  users.add(user.id);
  return { client: instance, id: user.id };
}

async function permanent(label) {
  const email = `${label}-${nonce}@example.test`;
  const password = randomUUID();
  const { user } = success(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'local permanent fixture',
  );
  users.add(user.id);
  const instance = client();
  success(await instance.auth.signInWithPassword({ email, password }), 'password sign-in');
  return { client: instance, id: user.id, email };
}

async function edge(name, instance, body) {
  const session = instance ? success(await instance.auth.getSession(), 'session').session : null;
  const response = await fetch(`${local.API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: local.ANON_KEY,
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, body: await response.json() };
}

async function mailCode(email) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${local.INBUCKET_URL}/api/v1/messages`);
    const mailbox = await response.json();
    const message = mailbox.messages?.find((item) => item.To?.some((to) => to.Address === email));
    if (message) {
      const detail = await fetch(`${local.INBUCKET_URL}/api/v1/message/${message.ID}`);
      const mail = await detail.json();
      const code = `${mail.Text}\n${mail.HTML}`.match(/\b\d{6}\b/)?.[0];
      assert.ok(code, 'captured message contains a six-digit OTP');
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail('local email capture did not receive an OTP');
}

function loadTypeScript(relative, replacements = {}) {
  const source = ts.transpileModule(readFileSync(path.resolve(relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output = { exports: {} };
  const resolve = (name) => replacements[name] ?? require(name);
  new Function('require', 'module', 'exports', source)(resolve, output, output.exports);
  return output.exports;
}

function appAuth(instance) {
  return loadTypeScript('src/features/auth/auth-service.ts', {
    '@/services/backend/client': { getBackendClient: () => instance },
    '@/services/backend/session-storage': loadTypeScript(
      'src/services/backend/session-storage.web.ts',
    ),
    '@/features/auth/auth-errors': loadTypeScript('src/features/auth/auth-errors.ts'),
  });
}

before(async () => {
  local = JSON.parse(
    execFileSync(path.resolve('node_modules/.bin/supabase'), ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  for (const field of ['API_URL', 'INBUCKET_URL']) {
    const url = new URL(local[field]);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'local stack only');
    assert.equal(url.protocol, 'http:');
  }
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions });
  const memory = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
      removeItem: (key) => memory.delete(key),
    },
  });
  guest = await anonymous();
  owner = await permanent('owner');
  other = await permanent('other');
});

after(async () => {
  if (admin) {
    for (const bucket of buckets) {
      const paths = objects.filter(([name]) => name === bucket).map(([, objectPath]) => objectPath);
      for (let offset = 0; offset < paths.length; offset += 100) {
        success(
          await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100)),
          'fixture object cleanup',
        );
      }
    }
    for (const id of users) {
      const result = await admin.auth.admin.deleteUser(id);
      assert.ok(!result.error || result.error.code === 'user_not_found', 'fixture user cleanup');
    }
  }
  for (const instance of clients) await instance.auth.stopAutoRefresh();
  delete globalThis.sessionStorage;
});

test('real permanent and anonymous sessions cannot read or change another owner', async () => {
  for (const actor of [owner, guest]) {
    for (const table of ['profiles', 'user_preferences']) {
      const rows = success(await actor.client.from(table).select('*'), 'owner read');
      assert.deepEqual(
        rows.map((row) => row.user_id),
        [actor.id],
      );
      const values = table === 'profiles' ? { display_name: 'forged' } : { default_servings: 23 };
      const changed = success(
        await actor.client.from(table).update(values).eq('user_id', other.id).select(),
        'cross-owner update',
      );
      assert.deepEqual(changed, []);
    }
  }
  assert.equal(success(await other.client.from('profiles').select().single()).display_name, null);
  assert.equal(
    success(await other.client.from('user_preferences').select().single()).default_servings,
    2,
  );
});

test('private operational tables and service-only RPCs deny client sessions', async () => {
  for (const actor of [owner, guest]) {
    for (const table of ['account_controls', 'account_merge_tickets', 'account_merge_events']) {
      const result = await actor.client.schema('private').from(table).select('*');
      assert.ok(result.error, `private.${table} must not be exposed`);
    }
    for (const [name, args] of [
      ['internal_mark_account_deletion_processing', { p_request_id: randomUUID() }],
      ['internal_complete_account_deletion', { p_request_id: randomUUID(), p_success: true }],
      [
        'internal_complete_account_merge',
        {
          p_merge_ticket_id: randomUUID(),
          p_target_user_id: actor.id,
          p_correlation_id: randomUUID(),
        },
      ],
    ]) {
      const result = await actor.client.rpc(name, args);
      assert.equal(result.error?.code, '42501', `${name} is service-only`);
    }
  }
});

test('populated private buckets deny list, download, signing, and upload to every client role', async () => {
  for (const bucket of buckets) {
    const objectPath = `${owner.id}/runtime-${nonce}.png`;
    objects.push([bucket, objectPath]);
    success(
      await admin.storage.from(bucket).upload(objectPath, Buffer.from('local-fixture'), {
        contentType: 'image/png',
      }),
      'service storage upload',
    );
    success(
      await admin.storage.from(bucket).download(objectPath),
      'service storage positive control',
    );
    for (const instance of [client(), owner.client, guest.client]) {
      const listing = success(
        await instance.storage.from(bucket).list(owner.id),
        'private listing',
      );
      assert.deepEqual(listing, []);
      assert.ok((await instance.storage.from(bucket).download(objectPath)).error, 'read denied');
      assert.ok(
        (await instance.storage.from(bucket).createSignedUrl(objectPath, 60)).error,
        'sign denied',
      );
      assert.ok(
        (
          await instance.storage
            .from(bucket)
            .upload(`${guest.id}/${randomUUID()}.png`, Buffer.from('forged'), {
              contentType: 'image/png',
            })
        ).error,
        'upload denied',
      );
    }
  }
});

test('Edge Functions reject unauthenticated calls and invalid operations', async () => {
  for (const name of ['account-delete', 'account-merge-ticket', 'account-merge']) {
    assert.equal((await edge(name)).status, 401, `${name} requires a session`);
  }
  assert.equal((await edge('account-merge-ticket', owner.client)).status, 409);
  assert.equal((await edge('account-merge', guest.client, { token: 'a'.repeat(64) })).status, 409);
  assert.equal((await edge('account-merge', owner.client, { token: 'invalid' })).status, 400);
});

test('app anonymous-to-email OTP upgrade preserves identity, data, and persisted session', async () => {
  const storage = loadTypeScript('src/services/backend/session-storage.web.ts').sessionStorage;
  const instance = client({ storage, storageKey: `upgrade-${nonce}`, persistSession: true });
  const auth = appAuth(instance);
  const session = await auth.ensureGuestSession();
  users.add(session.user.id);
  success(
    await instance
      .from('profiles')
      .update({ display_name: 'Before upgrade' })
      .eq('user_id', session.user.id),
  );
  const ingredients = [
    {
      id: randomUUID(),
      displayName: 'Upgrade fixture',
      normalizedName: null,
      canonicalId: null,
      selected: true,
      quantity: null,
      provenance: 'manual',
      detectionId: null,
    },
  ];
  const draft = success(
    await instance.rpc('create_scan', {
      p_key: randomUUID(),
      p_source: 'manual',
      p_ingredients: ingredients,
    }),
  );
  const confirmationScan = success(
    await instance.rpc('create_scan', {
      p_key: randomUUID(),
      p_source: 'manual',
      p_ingredients: ingredients,
    }),
  );
  const confirmed = success(
    await instance.rpc('mutate_scan', {
      p_scan: confirmationScan.id,
      p_key: randomUUID(),
      p_operation: 'confirm',
      p_body: { expectedVersion: 1, draftRevision: 1 },
    }),
  );
  const email = `upgrade-${nonce}@example.test`;
  const pending = await auth.requestEmailCode(email);
  assert.equal(pending.type, 'email_change');
  assert.deepEqual(await auth.loadPendingEmailAuthentication(), pending);
  await auth.verifyEmailCode(pending, await mailCode(email));
  const upgraded = success(await instance.auth.getUser()).user;
  assert.equal(upgraded.id, session.user.id);
  assert.equal(upgraded.is_anonymous, false);
  assert.deepEqual(
    success(await instance.from('scans').select('*').eq('id', draft.id).single()),
    draft,
  );
  assert.deepEqual(
    success(await instance.from('scans').select('*').eq('id', confirmed.id).single()),
    confirmed,
  );
  assert.equal(
    success(await instance.from('profiles').select().single()).display_name,
    'Before upgrade',
  );
  assert.equal(await auth.loadPendingEmailAuthentication(), null);
  const resumed = client({ storage, storageKey: `upgrade-${nonce}`, persistSession: true });
  assert.equal(success(await resumed.auth.getUser()).user.id, session.user.id);
  assert.equal(success(await resumed.auth.refreshSession()).user.id, session.user.id);
});

test('app existing-account OTP merge binds the ticket and only permits idempotent owner retries', async () => {
  const source = await anonymous();
  success(
    await source.client
      .from('user_preferences')
      .update({ default_servings: 6 })
      .eq('user_id', source.id),
  );
  const auth = appAuth(source.client);
  const pending = await auth.requestEmailCode(owner.email);
  assert.equal(pending.type, 'email');
  assert.match(pending.mergeToken, /^[0-9a-f]{64}$/);
  const outcome = await auth.verifyEmailCode(pending, await mailCode(owner.email));
  assert.equal(outcome.preferenceReviewRequired, true);
  assert.equal(success(await source.client.auth.getUser()).user.id, owner.id);
  assert.equal((await admin.auth.admin.getUserById(source.id)).error?.code, 'user_not_found');
  const repeat = await edge('account-merge', owner.client, { token: pending.mergeToken });
  assert.equal(repeat.status, 200, 'same owner may retry without repeating the transfer');
  const stolen = await edge('account-merge', other.client, { token: pending.mergeToken });
  assert.equal(stolen.status, 409);
  assert.equal(stolen.body.error.code, 'MERGE_TICKET_ALREADY_CLAIMED');
  assert.equal(
    success(await owner.client.from('user_preferences').select().single()).default_servings,
    2,
  );
  const review = success(await owner.client.from('preference_merge_reviews').select().single());
  for (const actor of [other, guest]) {
    assert.deepEqual(success(await actor.client.from('preference_merge_reviews').select()), []);
  }
  assert.equal(
    (
      await other.client.rpc('resolve_preference_merge', {
        p_review_id: review.id,
        p_use_guest_values: true,
      })
    ).error?.message,
    'PREFERENCE_REVIEW_UNAVAILABLE',
  );
  success(
    await owner.client.rpc('resolve_preference_merge', {
      p_review_id: review.id,
      p_use_guest_values: false,
    }),
  );
});

test('native session adapter restores a real session across client recreation and clears every chunk', async () => {
  // Exercise the native adapter with a host storage double; hardware security remains a device gate.
  const memory = new Map();
  const storage = loadTypeScript('src/services/backend/session-storage.native.ts', {
    'expo-secure-store': {
      getItemAsync: async (key) => memory.get(key) ?? null,
      setItemAsync: async (key, value) => {
        memory.set(key, value);
      },
      deleteItemAsync: async (key) => {
        memory.delete(key);
      },
    },
  }).sessionStorage;
  const instance = client({ storage, storageKey: `native-${nonce}`, persistSession: true });
  const { user } = success(await instance.auth.signInAnonymously());
  users.add(user.id);
  assert.ok(memory.size > 1, 'session uses a manifest and secure-store chunks');
  const resumed = client({ storage, storageKey: `native-${nonce}`, persistSession: true });
  assert.equal(success(await resumed.auth.getUser()).user.id, user.id);
  assert.equal(success(await resumed.auth.refreshSession()).user.id, user.id);
  success(await resumed.auth.signOut({ scope: 'local' }));
  assert.equal(memory.size, 0);
});

test('deletion revokes data immediately, finishes cleanup, and rejects the deleted session', async () => {
  const actor = await anonymous();
  for (const bucket of buckets) {
    const objectPath = `${actor.id}/delete-${nonce}.png`;
    objects.push([bucket, objectPath]);
    success(
      await admin.storage
        .from(bucket)
        .upload(objectPath, Buffer.from('fixture'), { contentType: 'image/png' }),
    );
  }
  const requestId = success(
    await actor.client.rpc('request_account_deletion', { p_correlation_id: randomUUID() }),
  );
  assert.deepEqual(success(await actor.client.from('profiles').select()), []);
  assert.equal(
    success(await actor.client.rpc('request_account_deletion', { p_correlation_id: randomUUID() })),
    requestId,
  );
  const result = await edge('account-delete', actor.client);
  assert.equal(result.status, 202);
  assert.equal((await admin.auth.admin.getUserById(actor.id)).error?.code, 'user_not_found');
  for (const bucket of buckets) {
    assert.deepEqual(success(await admin.storage.from(bucket).list(actor.id)), []);
  }
  const completed = success(
    await admin.from('privacy_requests').select().eq('id', requestId).single(),
  );
  assert.equal(completed.status, 'completed');
  assert.equal(completed.user_id, null);
  success(
    await admin.rpc('internal_complete_account_deletion', {
      p_request_id: requestId,
      p_success: true,
    }),
  );
  assert.deepEqual(
    success(await admin.from('privacy_requests').select().eq('id', requestId).single()),
    completed,
  );
  assert.equal((await edge('account-delete', actor.client)).status, 401);
});

test('deletion cleanup removes nested objects and more than one listing page', async () => {
  const actor = await anonymous();
  const paths = Array.from({ length: 1001 }, (_, index) => `${actor.id}/page-${index}.png`);
  paths.push(`${actor.id}/nested/deeper/image.png`);
  for (let offset = 0; offset < paths.length; offset += 20) {
    await Promise.all(
      paths.slice(offset, offset + 20).map(async (objectPath) => {
        objects.push([buckets[0], objectPath]);
        success(
          await admin.storage.from(buckets[0]).upload(objectPath, Buffer.from('fixture'), {
            contentType: 'image/png',
          }),
          'paginated cleanup fixture',
        );
      }),
    );
  }
  const result = await edge('account-delete', actor.client);
  assert.equal(result.status, 202);
  assert.deepEqual(success(await admin.storage.from(buckets[0]).list(actor.id)), []);
  assert.ok((await admin.storage.from(buckets[0]).download(paths.at(-1))).error);
});

test('an issued guest ticket cannot delete an identity after it upgrades to permanent', async () => {
  const actor = await anonymous();
  const issued = await edge('account-merge-ticket', actor.client);
  assert.equal(issued.status, 201);
  success(
    await admin.auth.admin.updateUserById(actor.id, {
      email: `upgraded-ticket-${nonce}@example.test`,
      email_confirm: true,
    }),
  );
  assert.equal(success(await admin.auth.admin.getUserById(actor.id)).user.is_anonymous, false);
  const result = await edge('account-merge', other.client, { token: issued.body.data.token });
  assert.equal(result.status, 409, 'upgraded source must not be merged away');
  assert.ok(success(await admin.auth.admin.getUserById(actor.id)).user);
});
