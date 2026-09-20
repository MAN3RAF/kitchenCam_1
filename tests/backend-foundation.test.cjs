const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

test('local Supabase configuration keeps providers local and verifies function JWTs', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /enable_anonymous_sign_ins = true/);
  assert.match(config, /otp_length = 6/);
  assert.match(
    config,
    /additional_redirect_urls = \["kitchencam-development:\/\/auth\/callback"\]/,
  );
  for (const functionName of ['account-delete', 'account-merge-ticket', 'account-merge']) {
    assert.match(config, new RegExp(`\\[functions\\.${functionName}\\]\\s+verify_jwt = true`));
  }
  const appleSection = config.match(/\[auth\.external\.apple\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  assert.ok(appleSection);
  assert.match(appleSection, /enabled = false/);
});

test('identity tables force RLS and storage has no client object policy', () => {
  const rls = read('supabase/migrations/20260920010100_identity_rls.sql');
  for (const table of [
    'profiles',
    'user_preferences',
    'privacy_requests',
    'preference_merge_reviews',
  ]) {
    assert.match(rls, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }

  const storage = read('supabase/migrations/20260920010200_private_storage.sql');
  assert.match(storage, /'scan-raw-private'[\s\S]*?false/);
  assert.match(storage, /'scan-retained-private'[\s\S]*?false/);
  assert.doesNotMatch(storage, /create\s+policy[\s\S]+storage\.objects/i);
});

test('lifecycle functions require authenticated callers and isolate service operations', () => {
  const lifecycle = read('supabase/migrations/20260920010300_account_lifecycle.sql');
  for (const functionSignature of [
    'public.request_account_deletion(uuid)',
    'public.issue_account_merge_ticket(text, timestamptz)',
    'public.consume_account_merge_ticket(text, uuid)',
    'public.resolve_preference_merge(uuid, boolean)',
  ]) {
    assert.match(
      lifecycle,
      new RegExp(
        `grant execute on function ${functionSignature.replace(/[().]/g, '\\$&')} to authenticated`,
        'i',
      ),
    );
  }
  for (const functionSignature of [
    'public.internal_mark_account_deletion_processing(uuid)',
    'public.internal_complete_account_deletion(uuid, boolean, text)',
    'public.internal_complete_account_merge(uuid, uuid, uuid)',
  ]) {
    assert.match(
      lifecycle,
      new RegExp(
        `grant execute on function ${functionSignature.replace(/[().]/g, '\\$&')} to service_role`,
        'i',
      ),
    );
    assert.doesNotMatch(
      lifecycle,
      new RegExp(
        `grant execute on function ${functionSignature.replace(/[().]/g, '\\$&')} to authenticated`,
        'i',
      ),
    );
  }
  assert.match(lifecycle, /auth\.jwt\(\) -> 'amr'/);
  assert.doesNotMatch(lifecycle, /auth\.jwt\(\) ->> 'iat'/);
  assert.match(lifecycle, /now\(\) - interval '10 minutes'/);
  assert.match(lifecycle, /completed_at is null/);
});

test('mobile source cannot reference server credentials', () => {
  const sourceRoots = ['app', 'src'];
  const pending = sourceRoots.map((directory) => path.join(root, directory));
  const sourceFiles = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) sourceFiles.push(fullPath);
    }
  }
  const clientSource = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(clientSource, /SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|REVENUECAT_SECRET/);
  assert.doesNotMatch(clientSource, /service_role/);
});
