const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { runInThisContext } = require('node:vm');
const { before, after, test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

// Run the actual mobile adapter/controller against local PostgREST. Transpile only;
// do not replace their validators, SQL operations, auth, or lifecycle semantics.
const loaded = new Map();
function loadDomain(name) {
  if (loaded.has(name)) return loaded.get(name);
  assert.match(name, /^scan-(domain|service|editor)$/);
  const source = readFileSync(path.resolve('src/features/scans', `${name}.ts`), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const load = (specifier) =>
    specifier.startsWith('./') ? loadDomain(specifier.slice(2)) : require(specifier);
  runInThisContext(`(function(require,module,exports){${output}\n})`)(load, module, module.exports);
  loaded.set(name, module.exports);
  return module.exports;
}
const { createScanService } = loadDomain('scan-service');
const { ScanEditor } = loadDomain('scan-editor');
const { manualIngredient, ScanError } = loadDomain('scan-domain');
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
let local, admin, owner, other, service;
const users = [];
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
  for (let i = 0; i < 2; i++) {
    const client = createClient(local.API_URL, local.ANON_KEY, { auth });
    const result = await client.auth.signInAnonymously();
    assert.equal(result.error, null);
    users.push({ client, id: result.data.user.id });
  }
  [owner, other] = users;
  service = createScanService(owner.client, owner.id);
});
after(async () => {
  for (const actor of users) {
    const result = await admin.auth.admin.deleteUser(actor.id);
    assert.equal(result.error, null, 'remove disposable Phase C identity');
    await actor.client.auth.stopAutoRefresh();
  }
});
async function editorWithNames(names, adapter = service) {
  const scan = await adapter.create(randomUUID(), []);
  const editor = new ScanEditor(scan, adapter, randomUUID);
  for (const name of names) {
    editor.input(name);
    assert.equal(editor.applyInput(), true);
  }
  return { scan, editor };
}
test('manual journey persists ordered edits, selected confirmation, Ready reconstruction and reopening', async () => {
  const { scan, editor } = await editorWithNames(['  طماطم  ', 'Basil', 'Onion']);
  const [tomato, basil, onion] = editor.snapshot().rows;
  editor.edit(tomato.id);
  editor.input('Cherry tomato');
  editor.applyInput();
  editor.change(onion.id, 'remove');
  editor.change(basil.id, 'up');
  editor.change(tomato.id, 'select');
  assert.ok(await editor.submit('ingredients', true));
  const reloaded = await service.read(scan.id);
  assert.deepEqual(
    reloaded.ingredients.map((row) => row.id),
    [basil.id, tomato.id],
  );
  assert.equal(reloaded.ingredients[1].selected, false);
  const remounted = new ScanEditor(reloaded, service, randomUUID);
  const confirmed = await remounted.submit('confirm', true);
  assert.equal(confirmed.state, 'confirmed');
  const ready = await service.read(scan.id);
  assert.deepEqual(
    ready.confirmedIngredients.map((row) => row.displayName),
    ['Basil'],
  );
  const restarted = new ScanEditor(ready, service, randomUUID);
  restarted.input('Garlic');
  restarted.applyInput();
  const reopened = await restarted.submit('ingredients', true);
  assert.equal(reopened.state, 'needs_confirmation');
  assert.equal(reopened.confirmedIngredients, null);
  assert.equal(reopened.draftRevision, ready.draftRevision + 1);
  assert.ok(await restarted.submit('confirm', true));
});
test('valid manual quantities survive loading, an edit, and a real save', async () => {
  const ingredient = {
    ...manualIngredient(randomUUID(), 'Tomato'),
    quantity: { value: '2', unit: 'each', estimated: false },
  };
  const scan = await service.create(randomUUID(), [ingredient]);
  const loaded = await service.read(scan.id);
  assert.deepEqual(loaded.ingredients[0].quantity, ingredient.quantity);
  const editor = new ScanEditor(loaded, service, randomUUID);
  editor.edit(ingredient.id);
  editor.input('Ripe tomato');
  assert.equal(editor.applyInput(), true);
  const saved = await editor.submit('ingredients', true);
  assert.equal(saved.ingredients[0].displayName, 'Ripe tomato');
  assert.deepEqual(saved.ingredients[0].quantity, ingredient.quantity);
});
test('a real server cancellation is terminal to the adapter after a cached draft was loaded', async () => {
  const scan = await service.create(randomUUID(), []);
  const loaded = await service.read(scan.id);
  assert.equal(loaded.id, scan.id);
  const cancelled = await owner.client.rpc('mutate_scan', {
    p_scan: scan.id,
    p_key: randomUUID(),
    p_operation: 'cancel',
    p_body: { expectedVersion: loaded.version },
  });
  assert.equal(cancelled.error, null);
  await assert.rejects(service.read(scan.id), (error) => error.code === 'CANCELLED');
});
test('real stale edit and stale confirmation retain local rows and never overwrite the newer draft', async () => {
  const { scan, editor } = await editorWithNames(['Tomato']);
  const competing = new ScanEditor(scan, service, randomUUID);
  competing.input('Basil');
  competing.applyInput();
  assert.ok(await competing.submit('ingredients', true));
  assert.equal(await editor.submit('ingredients', true), null);
  assert.equal(editor.snapshot().status, 'conflict');
  assert.equal(editor.snapshot().rows[0].displayName, 'Tomato');
  assert.equal(editor.snapshot().latest.ingredients[0].displayName, 'Basil');
  const copy = await editor.copy(true);
  assert.notEqual(copy.id, scan.id);
  assert.equal(copy.ingredients[0].displayName, 'Tomato');
  assert.equal((await service.read(scan.id)).ingredients[0].displayName, 'Basil');
  const confirmation = new ScanEditor(await service.read(scan.id), service, randomUUID);
  competing.input('Onion');
  competing.applyInput();
  await competing.submit('ingredients', true);
  assert.equal(await confirmation.submit('confirm', true), null);
  assert.equal(confirmation.snapshot().status, 'conflict');
  assert.equal((await service.read(scan.id)).state, 'needs_confirmation');
});
test('committed save and confirmation with lost responses retry identical operations once', async () => {
  let loseResponse = true;
  const attempts = [];
  const lossy = {
    ...service,
    mutate: async (command) => {
      attempts.push(command);
      const result = await service.mutate(command);
      if (loseResponse) {
        loseResponse = false;
        throw new ScanError('UNAVAILABLE');
      }
      return result;
    },
  };
  const { scan, editor } = await editorWithNames(['Tomato'], lossy);
  assert.equal(await editor.submit('ingredients', true), null);
  assert.equal((await service.read(scan.id)).version, 2);
  const saved = await editor.submit('ingredients', true);
  assert.equal(saved.version, 2);
  assert.equal(attempts[0], attempts[1]);
  loseResponse = true;
  assert.equal(await editor.submit('confirm', true), null);
  const confirmed = await editor.submit('confirm', true);
  assert.equal(confirmed.version, 3);
  assert.equal(attempts[2], attempts[3]);
});
test('duplicate creation retries, server validation, Unicode limits and exact selected duplicates', async () => {
  const key = randomUUID();
  const creates = await Promise.all([service.create(key, []), service.create(key, [])]);
  assert.equal(creates[0].id, creates[1].id);
  await assert.rejects(
    service.mutate({ key: randomUUID(), scan: creates[0], operation: 'confirm', ingredients: [] }),
    (error) => error.code === 'VALIDATION',
  );
  const rows = [
    manualIngredient(randomUUID(), '🍅'.repeat(120)),
    manualIngredient(randomUUID(), 'tomato'),
    manualIngredient(randomUUID(), 'Tomato'),
  ];
  const saved = await service.mutate({
    key: randomUUID(),
    scan: creates[0],
    operation: 'ingredients',
    ingredients: rows,
  });
  await assert.rejects(
    service.mutate({ key: randomUUID(), scan: saved, operation: 'confirm', ingredients: rows }),
    (error) => error.code === 'DUPLICATE_INGREDIENTS',
  );
  rows[2] = { ...rows[2], selected: false };
  const fixed = await service.mutate({
    key: randomUUID(),
    scan: saved,
    operation: 'ingredients',
    ingredients: rows,
  });
  assert.equal(
    (
      await service.mutate({
        key: randomUUID(),
        scan: fixed,
        operation: 'confirm',
        ingredients: rows,
      })
    ).state,
    'confirmed',
  );
  const invalid = await owner.client.rpc('mutate_scan', {
    p_scan: creates[0].id,
    p_key: randomUUID(),
    p_operation: 'ingredients',
    p_body: {
      expectedVersion: fixed.version + 1,
      expectedDraftRevision: fixed.draftRevision,
      ingredients: [{ ...rows[0], displayName: 'x'.repeat(121) }],
    },
  });
  assert.equal(invalid.error.message, 'VALIDATION');
});
test('guest ownership and restored/refreshed sessions retain access while another user is denied', async () => {
  const { scan, editor } = await editorWithNames(['Tomato']);
  await editor.submit('ingredients', true);
  const otherService = createScanService(other.client, other.id);
  await assert.rejects(otherService.read(scan.id), (error) => error.code === 'NOT_FOUND');
  await assert.rejects(
    otherService.mutate({ scan, key: randomUUID(), operation: 'ingredients', ingredients: [] }),
    (error) => error.code === 'NOT_FOUND',
  );
  const current = (await owner.client.auth.getSession()).data.session;
  const restored = createClient(local.API_URL, local.ANON_KEY, { auth });
  assert.equal(
    (
      await restored.auth.setSession({
        access_token: current.access_token,
        refresh_token: current.refresh_token,
      })
    ).error,
    null,
  );
  assert.equal((await restored.auth.refreshSession()).error, null);
  const restoredService = createScanService(restored, owner.id);
  assert.equal((await restoredService.read(scan.id)).ingredients[0].displayName, 'Tomato');
  await restored.auth.stopAutoRefresh();
  // Refresh rotating tokens are now authoritative for subsequent fixture requests.
  const next = (await restored.auth.getSession()).data.session;
  assert.equal(
    (
      await owner.client.auth.setSession({
        access_token: next.access_token,
        refresh_token: next.refresh_token,
      })
    ).error,
    null,
  );
});
test('offline controller leaves real backend unchanged and retries only after reconnecting', async () => {
  const { scan, editor } = await editorWithNames(['Tomato']);
  assert.equal(await editor.submit('ingredients', false), null);
  assert.deepEqual((await service.read(scan.id)).ingredients, []);
  assert.ok(await editor.submit('ingredients', true));
  assert.equal((await service.read(scan.id)).ingredients.length, 1);
});

test('real newer state returned by replay requires reconciliation, preserving the submitted draft', async () => {
  let lost = true;
  const lossy = {
    ...service,
    mutate: async (command) => {
      const result = await service.mutate(command);
      if (lost) {
        lost = false;
        throw new ScanError('UNAVAILABLE');
      }
      return result;
    },
  };
  const { scan, editor } = await editorWithNames(['Tomato'], lossy);
  assert.equal(await editor.submit('ingredients', true), null);
  const competing = new ScanEditor(await service.read(scan.id), service, randomUUID);
  competing.input('Basil');
  competing.applyInput();
  assert.ok(await competing.submit('ingredients', true));
  assert.equal(await editor.submit('ingredients', true), null);
  assert.equal(editor.snapshot().status, 'conflict');
  assert.deepEqual(
    editor.snapshot().rows.map((row) => row.displayName),
    ['Tomato'],
  );
  assert.deepEqual(
    editor.snapshot().latest.ingredients.map((row) => row.displayName),
    ['Tomato', 'Basil'],
  );
});

test('recovery copy lost acknowledgement retries the same real creation without duplicating lists', async () => {
  const { scan, editor } = await editorWithNames(['Tomato']);
  const competing = new ScanEditor(scan, service, randomUUID);
  competing.input('Basil');
  competing.applyInput();
  await competing.submit('ingredients', true);
  await editor.submit('ingredients', true);
  let lost = true;
  const attempts = [];
  const lossy = {
    ...service,
    create: async (key, rows) => {
      attempts.push(key);
      const result = await service.create(key, rows);
      if (lost) {
        lost = false;
        throw new ScanError('UNAVAILABLE');
      }
      return result;
    },
  };
  const recovery = new ScanEditor(scan, lossy, randomUUID);
  recovery.input('Onion');
  recovery.applyInput();
  recovery.receive(await service.read(scan.id));
  assert.equal(await recovery.copy(true), null);
  const copied = await recovery.copy(true);
  assert.equal(attempts[0], attempts[1]);
  assert.equal(copied.ingredients[0].displayName, 'Onion');
  assert.equal((await recovery.copy(true)).id, copied.id);
  assert.equal(attempts.length, 2);
  assert.equal((await service.read(scan.id)).ingredients[0].displayName, 'Basil');
});

test('same-ID email OTP upgrade preserves access through the actual manual adapter', async () => {
  const { scan, editor } = await editorWithNames(['طماطم']);
  await editor.submit('ingredients', true);
  const confirmed = await editor.submit('confirm', true);
  const email = `manual-upgrade-${randomUUID()}@example.test`;
  const mailboxUrl = new URL(local.INBUCKET_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(mailboxUrl.hostname));
  assert.equal(mailboxUrl.protocol, 'http:');
  assert.equal((await owner.client.auth.updateUser({ email })).error, null);
  let code;
  for (let attempt = 0; attempt < 30; attempt++) {
    const mailbox = await (await fetch(`${mailboxUrl.origin}/api/v1/messages`)).json();
    const message = mailbox.messages?.find((item) => item.To?.some((to) => to.Address === email));
    if (message) {
      const mail = await (await fetch(`${mailboxUrl.origin}/api/v1/message/${message.ID}`)).json();
      code = `${mail.Text}\n${mail.HTML}`.match(/\b\d{6}\b/)?.[0];
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(code, 'local mailbox delivered upgrade OTP');
  const result = await owner.client.auth.verifyOtp({ email, token: code, type: 'email_change' });
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, owner.id);
  assert.equal(result.data.user.is_anonymous, false);
  assert.deepEqual(await service.read(scan.id), confirmed);
  const reopened = new ScanEditor(await service.read(scan.id), service, randomUUID);
  reopened.input('Basil');
  reopened.applyInput();
  assert.equal((await reopened.submit('ingredients', true)).state, 'needs_confirmation');
});
