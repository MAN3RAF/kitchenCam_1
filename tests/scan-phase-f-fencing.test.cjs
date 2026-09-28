const { test } = require('node:test');
const { race } = require('./helpers/scan-fence.cjs');
for (const kind of [
  'lease',
  'output-lease',
  'error-lease',
  'deadline',
  'writer',
  'valid',
  'new-lease',
  'cancel',
  'replace',
  'delete',
  'account-delete',
  'auth-delete',
]) {
  test(`sanitizer completion fences ${kind} after an observed database lock wait`, () =>
    race(kind));
}
