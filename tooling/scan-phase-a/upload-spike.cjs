const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { localConfiguration, localClients, checked } = require('./local.cjs');
const { presign } = require('./sigv4.cjs');

// Real wall-clock wait, deliberately NOT mocked or replaced with a database timestamp.
// Emit only named observations and status codes; never URLs, paths, tokens, or bodies.
async function run() {
  const config = localConfiguration();
  const { admin, user } = localClients(config);
  const bucket = admin.storage.from('scan-raw-private');
  const actors = [];
  const paths = new Set();
  const nonce = randomUUID();
  const observations = [];
  const image = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082',
    'hex',
  );
  const record = (name, details) => {
    const observation = { name, ...details };
    observations.push(observation);
    console.log(JSON.stringify(observation));
  };
  const target = (owner) => {
    const value = `${owner}/phase-a-${nonce}/${randomUUID()}.png`;
    paths.add(value);
    return value;
  };
  const put = async (url, body = image, headers = {}) => {
    const destination = new URL(url);
    assert.equal(destination.origin, new URL(config.API_URL).origin);
    const response = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/png', ...headers },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    await response.arrayBuffer();
    return response.status;
  };
  const signed = async (objectPath) =>
    checked(
      await bucket.createSignedUploadUrl(objectPath, { upsert: false }),
      'SIGNED_ISSUANCE_FAILED',
    );
  const remove = async (objectPath) =>
    checked(await bucket.remove([objectPath]), 'OBJECT_CLEANUP_FAILED');
  try {
    for (const kind of ['anonymous', 'permanent', 'other']) {
      const client = user();
      let identity;
      if (kind === 'anonymous')
        identity = checked(await client.auth.signInAnonymously(), 'GUEST_FAILED');
      else {
        const email = `phase-a-${kind}-${nonce}@example.test`;
        const password = randomUUID();
        const created = checked(
          await admin.auth.admin.createUser({ email, password, email_confirm: true }),
          'USER_FAILED',
        );
        actors.push({ id: created.user.id, client, kind });
        identity = checked(
          await client.auth.signInWithPassword({ email, password }),
          'SIGNIN_FAILED',
        );
      }
      if (kind === 'anonymous') actors.push({ id: identity.user.id, client, kind });
    }
    const [guest, owner, other] = actors;
    // Start ten-minute experiment before the fast matrix; no secret leaves this process.
    const expiryPath = target(owner.id);
    const expiryAt = Date.now();
    const tenMinute = presign(config, expiryPath);
    const expiryStart = await put(tenMinute);
    record('s3_600_seconds_initial', {
      status: expiryStart,
      ageSeconds: (Date.now() - expiryAt) / 1000,
    });
    assert.equal(expiryStart, 200, 'S3_POSITIVE_CONTROL_FAILED');
    await remove(expiryPath);

    for (const actor of [guest, owner]) {
      const scoped = actor.client.storage.from('scan-raw-private');
      record(`${actor.kind}_direct_upload`, {
        denied: Boolean(
          (await scoped.upload(target(actor.id), image, { contentType: 'image/png' })).error,
        ),
      });
      record(`${actor.kind}_self_signing`, {
        denied: Boolean((await scoped.createSignedUploadUrl(target(actor.id))).error),
      });
      const session = checked(await actor.client.auth.getSession(), 'SESSION_FAILED').session;
      record(`${actor.kind}_s3_session_upload`, {
        status: await put(presign(config, target(actor.id), { session: session.access_token })),
      });
    }

    const sdkPath = target(owner.id);
    const sdk = await signed(sdkPath);
    const claims = JSON.parse(Buffer.from(sdk.token.split('.')[1], 'base64url').toString());
    record('sdk_signed_expiry_claim', { lifetimeSeconds: claims.exp - claims.iat });
    record('sdk_initial_upload', { status: await put(sdk.signedUrl) });
    const readWithUpload = await fetch(sdk.signedUrl, { method: 'GET', redirect: 'error' });
    await readWithUpload.arrayBuffer();
    record('sdk_upload_capability_cannot_read_raw', { status: readWithUpload.status });
    record('sdk_replay_no_upsert', {
      status: await put(sdk.signedUrl, Buffer.concat([image, Buffer.from('changed')])),
    });
    record('sdk_replay_upsert_header', {
      status: await put(sdk.signedUrl, image, { 'x-upsert': 'true' }),
    });
    const substitute = new URL(sdk.signedUrl);
    substitute.pathname = substitute.pathname.replace(/[^/]+$/, `${randomUUID()}.png`);
    paths.add(substitute.pathname.split('/scan-raw-private/')[1]);
    record('sdk_path_substitution', { status: await put(substitute.toString()) });
    const altered = new URL(sdk.signedUrl);
    const alteredClaims = { ...claims, exp: claims.iat + 600 };
    const tokenParts = sdk.token.split('.');
    tokenParts[1] = Buffer.from(JSON.stringify(alteredClaims)).toString('base64url');
    altered.searchParams.set('token', tokenParts.join('.'));
    record('sdk_cannot_shorten_signed_expiry', { status: await put(altered.toString()) });
    await remove(sdkPath);
    record('sdk_after_object_delete_cancel_proxy', { status: await put(sdk.signedUrl) });

    const otherSession = checked(await other.client.auth.getSession(), 'SESSION_FAILED').session;
    for (const mechanism of ['sdk', 's3']) {
      const create = async (objectPath, options) =>
        mechanism === 'sdk'
          ? (await signed(objectPath)).signedUrl
          : presign(config, objectPath, options);
      const capability = await create(target(owner.id));
      record(`${mechanism}_other_user_with_capability`, {
        status: await put(capability, image, {
          Authorization: `Bearer ${otherSession.access_token}`,
        }),
      });
      const wrongMime = await create(target(owner.id));
      record(`${mechanism}_disallowed_content_type`, {
        status: await put(wrongMime, image, { 'Content-Type': 'text/plain' }),
      });
      record(`${mechanism}_lying_image_content_type`, {
        status: await put(await create(target(owner.id)), Buffer.from('not an image'), {
          'Content-Type': 'image/jpeg',
        }),
      });
      record(`${mechanism}_over_scan_4_mib`, {
        status: await put(await create(target(owner.id)), Buffer.alloc(4 * 1024 * 1024 + 1)),
      });
      record(`${mechanism}_over_bucket_10_mib`, {
        status: await put(await create(target(owner.id)), Buffer.alloc(10 * 1024 * 1024 + 1)),
      });
    }

    const s3Path = target(owner.id);
    const s3 = presign(config, s3Path);
    record('s3_initial_upload', { status: await put(s3) });
    record('s3_overwrite', {
      status: await put(s3, Buffer.concat([image, Buffer.from('changed')])),
    });
    const downloaded = checked(await bucket.download(s3Path), 'POSITIVE_READ_FAILED');
    record('s3_overwrite_bytes_changed', {
      changed: (await downloaded.arrayBuffer()).byteLength !== image.length,
    });
    const conditionalPath = target(owner.id);
    const conditionalHeaders = { 'if-none-match': '*' };
    const conditional = presign(config, conditionalPath, { headers: conditionalHeaders });
    record('s3_conditional_first', { status: await put(conditional, image, conditionalHeaders) });
    record('s3_conditional_replay', {
      status: await put(
        conditional,
        Buffer.concat([image, Buffer.from('changed')]),
        conditionalHeaders,
      ),
    });
    const conditionalBytes = checked(
      await bucket.download(conditionalPath),
      'CONDITIONAL_READ_FAILED',
    );
    record('s3_conditional_overwrite_bytes_changed', {
      changed: (await conditionalBytes.arrayBuffer()).byteLength !== image.length,
    });
    await remove(conditionalPath);
    record('s3_conditional_after_delete', {
      status: await put(conditional, image, conditionalHeaders),
    });
    const tampered = new URL(s3);
    tampered.pathname = tampered.pathname.replace(/[^/]+$/, `${randomUUID()}.png`);
    paths.add(tampered.pathname.split('/scan-raw-private/')[1]);
    record('s3_path_substitution', { status: await put(tampered.toString()) });
    const wrongMethod = await fetch(s3, { method: 'GET', redirect: 'error' });
    await wrongMethod.arrayBuffer();
    record('s3_put_capability_cannot_read_raw', { status: wrongMethod.status });
    const contentBoundHeaders = { 'content-type': 'image/png' };
    const contentBound = presign(config, target(owner.id), { headers: contentBoundHeaders });
    record('s3_signed_content_type_changed', {
      status: await put(contentBound, image, { 'Content-Type': 'image/jpeg' }),
    });
    const lengthHeaders = { 'content-length': String(image.length) };
    record('s3_signed_length_initial', {
      status: await put(presign(config, target(owner.id), { headers: lengthHeaders }), image),
    });
    record('s3_signed_length_changed', {
      status: await put(
        presign(config, target(owner.id), { headers: lengthHeaders }),
        Buffer.concat([image, Buffer.from('larger')]),
      ),
    });

    for (const actor of [guest, owner, other]) {
      const scoped = actor.client.storage.from('scan-raw-private');
      record(`${actor.kind}_raw_read`, { denied: Boolean((await scoped.download(s3Path)).error) });
      record(`${actor.kind}_raw_list`, {
        count: checked(await scoped.list(owner.id), 'LIST_FAILED').length,
      });
      record(`${actor.kind}_raw_sign_read`, {
        denied: Boolean((await scoped.createSignedUrl(s3Path, 60)).error),
      });
    }
    const deleted = actors[2];
    const deletedSdk = await signed(target(deleted.id));
    const deletedS3 = presign(config, target(deleted.id));
    // Match the existing cleanup order: drain this fixture prefix, delete Auth, then attempt a late PUT.
    for (const objectPath of paths)
      if (objectPath.startsWith(`${deleted.id}/`)) await remove(objectPath);
    checked(await admin.auth.admin.deleteUser(deleted.id), 'DELETE_USER_FAILED');
    record('sdk_late_upload_after_auth_deletion', { status: await put(deletedSdk.signedUrl) });
    record('s3_late_upload_after_auth_deletion', { status: await put(deletedS3) });

    // Use the exact same 600-second URL, with genuine elapsed time, at both boundaries.
    while (Date.now() - expiryAt < 590000)
      await delay(Math.min(10000, 590000 - (Date.now() - expiryAt)));
    record('s3_600_seconds_before_expiry', {
      status: await put(tenMinute),
      ageSeconds: (Date.now() - expiryAt) / 1000,
    });
    await remove(expiryPath);
    while (Date.now() - expiryAt < 605000)
      await delay(Math.min(10000, 605000 - (Date.now() - expiryAt)));
    record('s3_600_seconds_after_expiry', {
      status: await put(tenMinute),
      ageSeconds: (Date.now() - expiryAt) / 1000,
    });
    record('s3_fresh_positive_control_after_expiry', {
      status: await put(presign(config, target(owner.id))),
    });
    await remove(sdkPath);
    record('sdk_still_usable_after_ten_minutes', {
      status: await put(sdk.signedUrl),
      ageSeconds: Date.now() / 1000 - claims.iat,
    });
    const storageImage = execFileSync(
      'docker',
      ['inspect', '--format', '{{.Config.Image}}', 'supabase_storage_kitchencam'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    const report = {
      schemaVersion: 1,
      scope: 'local-only; unchanged policies; synthetic bytes',
      runtime: { node: process.version, storageImage },
      recordedAt: new Date().toISOString(),
      observations,
    };
    mkdirSync('docs/research/evidence', { recursive: true });
    writeFileSync(
      'docs/research/evidence/scan-phase-a-upload.json',
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } finally {
    for (const objectPath of paths) await remove(objectPath);
    for (const actor of actors) {
      const result = await admin.auth.admin.deleteUser(actor.id);
      if (result.error && result.error.code !== 'user_not_found')
        throw new Error('FIXTURE_USER_CLEANUP_FAILED');
      await actor.client.auth.stopAutoRefresh();
    }
    console.log(JSON.stringify({ cleanup: 'fixture objects and identities removed' }));
  }
}

run().catch((error) => {
  // Underlying SDK/network errors may contain capabilities. Emit only a constant safe code.
  console.error(JSON.stringify({ error: 'UPLOAD_SPIKE_FAILED', kind: error.name }));
  process.exitCode = 1;
});
