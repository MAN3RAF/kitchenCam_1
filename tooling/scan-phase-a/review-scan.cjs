const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { localConfiguration } = require('./local.cjs');

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0')
    .filter(Boolean);
const changed = [
  ...new Set([
    ...git('diff', '--name-only', '-z', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard', '-z'),
  ]),
];
const config = localConfiguration();
const secrets = ['SECRET_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET', 'S3_PROTOCOL_ACCESS_KEY_SECRET']
  .map((key) => config[key])
  .filter(Boolean);
let checked = 0;
for (const file of changed) {
  const text = readFileSync(file, 'utf8');
  assert.ok(
    !secrets.some((secret) => text.includes(secret)),
    'ACTUAL_LOCAL_SECRET_IN_CHANGED_ARTIFACT',
  );
  assert.doesNotMatch(
    text,
    /(?:\/home\/[^/\s]+\/Projects\/|[A-Z]:\\Users\\|sb_secret_[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/,
    'SECRET_OR_DEVELOPER_PATH_IN_CHANGED_ARTIFACT',
  );
  checked++;
}
console.log(
  JSON.stringify({
    changedFilesScanned: checked,
    actualLocalSecretValuesChecked: secrets.length,
    result: 'passed',
    valuesLogged: false,
  }),
);
