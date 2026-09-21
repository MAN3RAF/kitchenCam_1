// Additional local security questions found during resume. Original evidence is preserved.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { localConfiguration, localClients, checked } = require('./local.cjs');
const { presign } = require('./sigv4.cjs');

async function run() {
  const config = localConfiguration();
  const { admin, user } = localClients(config);
  const client = user();
  const bucket = admin.storage.from('scan-raw-private');
  const owner = checked(await client.auth.signInAnonymously(), 'IDENTITY_FAILED').user.id;
  const paths = [];
  const observations = [];
  const target = () => {
    const value = `${owner}/phase-a-resume-${randomUUID()}.jpg`;
    paths.push(value);
    return value;
  };
  const record = (name, details) => {
    const row = { name, ...details };
    observations.push(row);
    console.log(JSON.stringify(row));
  };
  const put = async (url, body, headers = {}) => {
    assert.equal(new URL(url).origin, new URL(config.API_URL).origin);
    const requestHeaders = new Headers({ 'Content-Type': 'image/jpeg' });
    for (const [name, value] of Object.entries(headers)) requestHeaders.set(name, value);
    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    await response.arrayBuffer();
    return response.status;
  };
  const get = async (key) =>
    Buffer.from(await checked(await bucket.download(key), 'READ_FAILED').arrayBuffer());
  // Deliberately invalid image bytes: Storage accepting MIME claims is not sanitization.
  const first = Buffer.from('synthetic fixture A');
  const second = Buffer.from('synthetic fixture B');
  try {
    const sdkPath = target();
    const sdk = checked(
      await bucket.createSignedUploadUrl(sdkPath, { upsert: false }),
      'SIGN_FAILED',
    );
    assert.equal(await put(sdk.signedUrl, first), 200);
    const overwrite = await put(sdk.signedUrl, second, { 'x-upsert': 'true' });
    const unchanged = (await get(sdkPath)).equals(first);
    assert.equal(overwrite, 400);
    assert.equal(unchanged, true);
    record('sdk_overwrite_rejected_and_bytes_unchanged', { status: overwrite, unchanged });

    const sdkRacePath = target();
    const race = checked(
      await bucket.createSignedUploadUrl(sdkRacePath, { upsert: false }),
      'SIGN_FAILED',
    );
    const sdkStatuses = await Promise.all([
      put(race.signedUrl, first),
      put(race.signedUrl, second),
    ]);
    assert.deepEqual(sdkStatuses.toSorted(), [200, 400]);
    assert.ok((await get(sdkRacePath)).equals(sdkStatuses[0] === 200 ? first : second));
    record('sdk_concurrent_put_one_winner', { statuses: sdkStatuses, winnerBytesVerified: true });

    const s3Path = target();
    const headers = {
      'content-type': 'image/jpeg',
      'content-length': String(first.length),
      'if-none-match': '*',
    };
    const s3 = presign(config, s3Path, { headers });
    assert.equal(await put(s3, first, headers), 200);
    const status = await put(s3, second, headers);
    const changed = (await get(s3Path)).equals(second);
    assert.equal(status, 200);
    assert.equal(changed, true);
    record('s3_signed_mime_length_condition_same_size_overwrite', { status, changed });

    const racePath = target();
    const s3Race = presign(config, racePath, { headers });
    const s3Statuses = await Promise.all([
      put(s3Race, first, headers),
      put(s3Race, second, headers),
    ]);
    assert.deepEqual(s3Statuses, [200, 200]);
    record('s3_concurrent_conditional_put_both_accepted', { statuses: s3Statuses });

    for (const [mechanism, url] of [
      ['sdk', sdk.signedUrl],
      ['s3', s3],
    ]) {
      const tampered = new URL(url);
      tampered.pathname = tampered.pathname.replace('scan-raw-private', 'scan-retained-private');
      const result = await put(tampered, first, mechanism === 's3' ? headers : {});
      assert.ok(result >= 400);
      record(`${mechanism}_bucket_substitution_denied`, { status: result });
    }
  } finally {
    checked(await bucket.remove(paths), 'CLEANUP_FAILED');
    // Also remove cross-bucket attempted paths, even if a security regression accepted one.
    checked(await admin.storage.from('scan-retained-private').remove(paths), 'CLEANUP_FAILED');
    for (const name of ['scan-raw-private', 'scan-retained-private']) {
      assert.equal(
        checked(await admin.storage.from(name).list(owner), 'CLEANUP_VERIFY_FAILED').length,
        0,
      );
    }
    checked(await admin.auth.admin.deleteUser(owner), 'IDENTITY_CLEANUP_FAILED');
    assert.ok((await admin.auth.admin.getUserById(owner)).error);
    await client.auth.stopAutoRefresh();
  }
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    runtime: { node: process.version },
    scope: 'local-only; synthetic bytes; unchanged policies',
    observations,
    cleanup: { objectsRemoved: true, identityRemoved: true },
  };
  writeFileSync(
    'docs/research/evidence/scan-phase-a-upload-resumed.json',
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
}

run().catch(() => {
  console.error('UPLOAD_SUPPLEMENT_FAILED');
  process.exitCode = 1;
});
