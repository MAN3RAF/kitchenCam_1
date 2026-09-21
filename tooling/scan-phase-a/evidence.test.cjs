const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const evidence = (name) =>
  JSON.parse(
    readFileSync(path.resolve(`docs/research/evidence/scan-phase-a-${name}.json`), 'utf8'),
  );
const observation = (report, name) => {
  const found = report.observations.find((item) => item.name === name);
  assert.ok(found, `Missing observation: ${name}`);
  return found;
};

test('recorded local ten-minute boundary has before/after and a fresh positive control', () => {
  const report = evidence('upload');
  const before = observation(report, 's3_600_seconds_before_expiry');
  const after = observation(report, 's3_600_seconds_after_expiry');
  assert.equal(before.status, 200);
  assert.ok(before.ageSeconds >= 590 && before.ageSeconds < 600);
  assert.ok(after.ageSeconds >= 600);
  assert.ok(after.status >= 400);
  assert.equal(observation(report, 's3_fresh_positive_control_after_expiry').status, 200);
  assert.equal(observation(report, 'sdk_signed_expiry_claim').lifetimeSeconds, 7200);
  assert.equal(observation(report, 'sdk_still_usable_after_ten_minutes').status, 200);
  assert.ok(observation(report, 'sdk_still_usable_after_ten_minutes').ageSeconds > 600);
});

test('recorded limitations remain explicit, not mislabeled as successful security controls', () => {
  const report = evidence('upload');
  for (const name of [
    'sdk_after_object_delete_cancel_proxy',
    'sdk_other_user_with_capability',
    's3_other_user_with_capability',
    's3_overwrite',
    's3_conditional_replay',
    'sdk_late_upload_after_auth_deletion',
    's3_late_upload_after_auth_deletion',
  ])
    assert.equal(observation(report, name).status, 200);
  assert.equal(observation(report, 's3_overwrite_bytes_changed').changed, true);
  assert.equal(observation(report, 's3_conditional_overwrite_bytes_changed').changed, true);
  for (const mechanism of ['sdk', 's3']) {
    for (const suffix of ['over_bucket_10_mib', 'disallowed_content_type'])
      assert.ok(observation(report, `${mechanism}_${suffix}`).status >= 400);
    for (const suffix of ['lying_image_content_type', 'over_scan_4_mib'])
      assert.equal(observation(report, `${mechanism}_${suffix}`).status, 200);
  }
  assert.ok(observation(report, 'sdk_upload_capability_cannot_read_raw').status >= 400);
  assert.ok(observation(report, 's3_put_capability_cannot_read_raw').status >= 400);
  for (const kind of ['anonymous', 'permanent']) {
    assert.equal(observation(report, `${kind}_direct_upload`).denied, true);
    assert.equal(observation(report, `${kind}_self_signing`).denied, true);
    assert.equal(observation(report, `${kind}_s3_session_upload`).status, 403);
  }
  for (const name of [
    'sdk_path_substitution',
    's3_path_substitution',
    's3_signed_length_changed',
    's3_signed_content_type_changed',
  ])
    assert.ok(observation(report, name).status >= 400);
  for (const kind of ['anonymous', 'permanent', 'other']) {
    assert.equal(observation(report, `${kind}_raw_read`).denied, true);
    assert.equal(observation(report, `${kind}_raw_list`).count, 0);
    assert.equal(observation(report, `${kind}_raw_sign_read`).denied, true);
  }
});

test('sanitizer evidence includes verified output and failure corpus', () => {
  const report = evidence('sanitizer');
  for (const row of report.observations) {
    if (row.expected !== 'measured') assert.equal(row.outcome, row.expected, row.name);
    if (row.outcome === 'accepted') {
      assert.equal(row.metadataAbsent, true);
      assert.ok(row.outputBytes <= 4 * 1024 * 1024);
      assert.ok(row.width >= 256 && row.width <= 2048);
      assert.ok(row.height >= 256 && row.height <= 2048);
    }
  }
  for (let index = 1; index <= 8; index++)
    assert.equal(observation(report, `orientation-${index}`).orientationVerified, true);
  assert.equal(observation(report, 'synthetic-exif-gps').inputHadExif, true);
  assert.equal(observation(report, 'valid-container-corrupt-png-pixels').outcome, 'rejected');
  assert.equal(observation(report, 'valid-container-corrupt-webp-pixels').outcome, 'rejected');
  assert.equal(observation(report, 'supervisor-deadline-probe').code, 'WALL_LIMIT');
  assert.equal(observation(report, 'supervisor-memory-probe').code, 'RSS_LIMIT');
});

test('evidence contains no capabilities, metadata values, credentials or local file paths', () => {
  for (const name of ['upload', 'sanitizer', 'upload-resumed', 'sanitizer-resumed']) {
    const report = JSON.stringify(evidence(name));
    assert.doesNotMatch(
      report,
      /https?:\/\/|\/home\/|\/tmp\/|eyJ[A-Za-z0-9_-]{20,}|sb_secret_|X-Amz-Signature|GPSLatitude|GPSLongitude/,
    );
  }
});

test('supplement distinguishes length binding from immutable bytes and verifies cleanup', () => {
  const report = evidence('upload-resumed');
  assert.equal(observation(report, 'sdk_overwrite_rejected_and_bytes_unchanged').unchanged, true);
  assert.deepEqual(
    observation(report, 'sdk_concurrent_put_one_winner').statuses.toSorted(),
    [200, 400],
  );
  assert.equal(
    observation(report, 's3_signed_mime_length_condition_same_size_overwrite').changed,
    true,
  );
  assert.deepEqual(
    observation(report, 's3_concurrent_conditional_put_both_accepted').statuses,
    [200, 200],
  );
  for (const mechanism of ['sdk', 's3'])
    assert.ok(observation(report, `${mechanism}_bucket_substitution_denied`).status >= 400);
  assert.deepEqual(report.cleanup, { objectsRemoved: true, identityRemoved: true });
});

test('expanded sanitizer corpus proves GPS presence, full JPEG decode and revised source admission', () => {
  const report = evidence('sanitizer-resumed');
  for (const row of report.observations) {
    if (row.expected !== 'measured') assert.equal(row.outcome, row.expected, row.name);
    assert.ok(row.processWallMs > 0);
    if (row.outcome === 'accepted') {
      assert.equal(row.metadataAbsent, true);
      assert.ok(row.outputBytes <= 4194304 && row.width <= 2048 && row.height <= 2048);
      assert.ok(row.width >= 256 && row.height >= 256);
    }
  }
  assert.equal(observation(report, 'synthetic-exif-gps').inputGpsVerified, true);
  assert.equal(observation(report, 'valid-container-truncated-jpeg-pixels').code, 'DECODE_FAILED');
  assert.equal(observation(report, 'source-over-revised-12-mp').code, 'DIMENSION_LIMIT');
  for (let index = 1; index <= 8; index++)
    assert.equal(observation(report, `orientation-${index}`).orientationVerified, true);
  assert.equal(observation(report, 'supervisor-deadline-probe').code, 'WALL_LIMIT');
  assert.equal(observation(report, 'supervisor-memory-probe').code, 'RSS_LIMIT');
});
