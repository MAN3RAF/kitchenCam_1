const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const test = require('node:test');
const { assertClientModule, assertPublicEnvironment } = require('../tooling/client-boundary.cjs');
const createConfig = require('../app.config.js');

test('public environment rejects unapproved names without revealing their values', () => {
  assert.doesNotThrow(() =>
    assertPublicEnvironment({ EXPO_PUBLIC_APP_ENV: 'development', SERVER_ONLY: 'not-exported' }),
  );
  assert.throws(
    () => assertPublicEnvironment({ EXPO_PUBLIC_PROVIDER_KEY: 'do-not-echo' }),
    (error) => !error.message.includes('do-not-echo'),
  );
});

test('Metro boundary rejects server paths and relative aliases after resolution', () => {
  const root = process.cwd();
  for (const name of [
    'server/keys.ts',
    'supabase/functions/index.ts',
    'src/config/ai.server.ts',
    '.env.local',
    'tooling/keys.cjs',
    'app.config.js',
  ]) {
    assert.throws(() => assertClientModule(root, path.resolve(root, name)));
  }
  assert.doesNotThrow(() =>
    assertClientModule(root, path.resolve(root, 'src/config/public-env.ts')),
  );
});

test('app config exports no environment object or server-only sentinel', () => {
  const previous = process.env.KITCHENCAM_TEST_SERVER_SENTINEL;
  process.env.KITCHENCAM_TEST_SERVER_SENTINEL = 'server-value-must-not-ship';
  try {
    const config = createConfig();
    assert.equal(config.extra, undefined);
    assert.ok(!JSON.stringify(config).includes('server-value-must-not-ship'));
  } finally {
    if (previous === undefined) delete process.env.KITCHENCAM_TEST_SERVER_SENTINEL;
    else process.env.KITCHENCAM_TEST_SERVER_SENTINEL = previous;
  }
});

test('a server credential cannot be mislabeled as the public Supabase key', () => {
  for (const key of [
    'sb_secret_server-value-must-not-ship',
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`,
    'sk-server-value-must-not-ship',
  ]) {
    assert.throws(
      () =>
        assertPublicEnvironment({
          EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
        }),
      (error) => !error.message.includes(key),
    );
  }
});
