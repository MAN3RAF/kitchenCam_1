const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const args = [
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
];
const sql = (s) =>
  execFileSync('docker', args, {
    input: `set statement_timeout='15s';\n${s}`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 20000,
  })
    .trim()
    .replace(/^SET\n/, '');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate) {
  for (let i = 0; i < 160; i++) {
    if (predicate()) return;
    await delay(50);
  }
  assert.fail('database condition not observed before test deadline');
}
function connection() {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (b) => {
    output += b.toString();
  });
  child.stderr.on('data', () => {});
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('LOCAL_SQL_FAILED'))));
  });
  // Attach immediately so a teardown does not produce an unhandled rejection.
  done.catch(() => {});
  return { child, done, output: () => output };
}
function fixture(digest = 'a'.repeat(64), size = 100, width = 256, height = 256, claimNow = true) {
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.ok([size, width, height].every(Number.isSafeInteger));
  const ids = { owner: randomUUID(), scan: randomUUID(), raw: randomUUID(), job: randomUUID() };
  sql(`begin;
    insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('${ids.owner}','authenticated','authenticated',true,'{}','{}',now(),now());
    insert into public.scans(id,owner_id,source,state,image_revision,sanitization_state,first_uploaded_at,media_expires_at)
      values('${ids.scan}','${ids.owner}','camera','sanitizing',1,'pending',now(),now()+interval '24 hours');
    insert into private.scan_controls(scan_id) values('${ids.scan}');
    insert into private.scan_images(id,scan_id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,write_deadline,delete_by,byte_size,width,height,digest)
      values('${ids.raw}','${ids.scan}','${ids.scan}','${ids.owner}',1,1,'raw','scan-raw-private','${ids.owner}/${ids.raw}',now(),now()+interval '1 hour',${size},${width},${height},'${digest}');
    insert into private.scan_jobs(id,scan_id,image_id,image_revision,generation,stage,deadline)
      values('${ids.job}','${ids.scan}','${ids.raw}',1,1,'sanitize',now()+interval '1 hour');commit;`);
  return {
    ...ids,
    claim: claimNow
      ? JSON.parse(sql(`select public.internal_scan_claim_job('${ids.scan}','sanitize');`))
      : null,
  };
}
function cleanup(f) {
  sql(
    `delete from auth.users where id='${f.owner}';delete from private.scan_images where original_scan_id='${f.scan}';delete from public.scan_deletions where scan_id='${f.scan}';`,
  );
  assert.equal(
    sql(`select count(*) from private.scan_images where original_scan_id='${f.scan}';`),
    '0',
  );
}
function finishSql(f, error = false) {
  if (error)
    return `select public.internal_scan_finish_job('${f.job}','${f.claim.leaseToken}','{"error":"IMAGE_INVALID"}'::jsonb);`;
  return `select public.internal_scan_finish_job('${f.job}','${f.claim.leaseToken}',jsonb_build_object('imageId','${f.claim.output.id}','digest',repeat('b',64),'bytes',100,'width',256,'height',256,'sanitizerVersion','phase-f-test'));`;
}
async function race(kind) {
  const f = fixture();
  let locker, finisher;
  try {
    const expiring = ['lease', 'output-lease', 'deadline', 'writer', 'error-lease'].includes(kind);
    if (['lease', 'output-lease', 'deadline', 'error-lease'].includes(kind))
      sql(
        `update private.scan_jobs set ${kind !== 'deadline' ? 'lease_until' : 'deadline'}=clock_timestamp()+interval '4 seconds' where id='${f.job}';`,
      );
    if (kind === 'writer')
      sql(
        `update private.scan_images set write_deadline=clock_timestamp()+interval '4 seconds' where id='${f.claim.output.id}';`,
      );
    locker = connection();
    const lock = ['cancel', 'replace', 'delete', 'account-delete', 'auth-delete'].includes(kind)
      ? `select 1 from auth.users where id='${f.owner}' for update;`
      : kind === 'new-lease'
        ? `select 1 from private.scan_jobs where id='${f.job}' for update;`
        : `select 1 from private.scan_images where id='${kind === 'output-lease' ? f.claim.output.id : f.raw}' for update;`;
    locker.child.stdin.write(
      `begin;set local statement_timeout='15s';${lock}select 'LOCK_READY';\n`,
    );
    for (let i = 0; i < 100 && !locker.output().includes('LOCK_READY'); i++) await delay(20);
    assert.ok(locker.output().includes('LOCK_READY'));
    const marker = randomUUID();
    finisher = connection();
    finisher.child.stdin.end(
      `set application_name='${marker}';set statement_timeout='15s';${finishSql(f, kind === 'error-lease')}\n`,
    );
    await until(
      () =>
        sql(
          `select count(*) from pg_stat_activity where application_name='${marker}' and wait_event_type='Lock';`,
        ) === '1',
    );
    assert.equal(
      sql(
        `select lease_until>clock_timestamp() and deadline>clock_timestamp() from private.scan_jobs where id='${f.job}';`,
      ),
      't',
      'worker valid when lock wait observed',
    );
    if (expiring) {
      const expr =
        kind === 'writer'
          ? `(select write_deadline from private.scan_images where id='${f.claim.output.id}')`
          : `(select ${kind !== 'deadline' ? 'lease_until' : 'deadline'} from private.scan_jobs where id='${f.job}')`;
      await until(() => sql(`select ${expr}<=clock_timestamp();`) === 't');
      assert.equal(
        sql(
          `select a.xact_start < ${expr} and clock_timestamp() >= ${expr} from pg_stat_activity a where application_name='${marker}';`,
        ),
        't',
        'transaction-start time would wrongly consider the expired authority valid',
      );
    }
    let action = '';
    if (kind === 'new-lease')
      action = `update private.scan_jobs set lease_token=gen_random_uuid() where id='${f.job}';`;
    if (['cancel', 'replace', 'delete'].includes(kind))
      action = `select set_config('request.jwt.claims','{"sub":"${f.owner}","role":"authenticated"}',true);select public.mutate_scan(id,gen_random_uuid(),'${kind}',jsonb_build_object('expectedVersion',version)) from public.scans where id='${f.scan}';`;
    if (kind === 'account-delete')
      action = `update private.account_controls set status='deletion_pending',deletion_requested_at=clock_timestamp() where user_id='${f.owner}';`;
    if (kind === 'auth-delete') action = `delete from auth.users where id='${f.owner}';`;
    locker.child.stdin.end(`${action}commit;\n`);
    await locker.done;
    let failure = false;
    try {
      await finisher.done;
    } catch {
      failure = true;
    }
    if (!['account-delete', 'auth-delete'].includes(kind))
      assert.equal(
        failure,
        false,
        'completion must return a fenced result, not fail through an unrelated SQL error',
      );
    const accepted = !failure && finisher.output().trim().endsWith('t');
    assert.equal(accepted, kind === 'valid', `completion after ${kind} lock wait`);
    assert.equal(
      sql(
        `select count(*) from private.scan_images where original_scan_id='${f.scan}' and approved_at is not null;`,
      ),
      kind === 'valid' ? '1' : '0',
    );
    assert.equal(
      sql(
        `select count(*) from private.scan_jobs where scan_id='${f.scan}' and stage='recognize';`,
      ),
      kind === 'valid' ? '1' : '0',
    );
    if (kind === 'error-lease') {
      assert.equal(
        sql(`select state from private.scan_jobs where id='${f.job}';`),
        'running',
        'terminal expiry rolls back job cancellation',
      );
      assert.equal(
        sql(`select generation from private.scan_controls where scan_id='${f.scan}';`),
        String(f.claim.generation),
        'terminal expiry rolls back generation increment',
      );
      assert.equal(
        sql(
          `select delete_requested_at is null from private.scan_images where id='${f.claim.output.id}';`,
        ),
        't',
        'terminal expiry rolls back output cleanup',
      );
      assert.equal(
        sql(`select state::text from public.scans where id='${f.scan}';`),
        'sanitizing',
        'expired error rolls back terminal transition',
      );
      assert.equal(
        sql(`select delete_requested_at is null from private.scan_images where id='${f.raw}';`),
        't',
      );
    }
    if (['lease', 'output-lease', 'deadline', 'writer'].includes(kind)) {
      assert.equal(sql(`select state from private.scan_jobs where id='${f.job}';`), 'running');
      assert.equal(sql(`select state::text from public.scans where id='${f.scan}';`), 'sanitizing');
      assert.equal(
        sql(`select delete_requested_at is null from private.scan_images where id='${f.raw}';`),
        't',
        'rejection cannot suppress the raw cleanup obligation',
      );
    }
    if (!['account-delete', 'auth-delete'].includes(kind)) {
      assert.equal(sql(finishSql(f)), 'f', 'repeated completion cannot publish or duplicate trust');
    }
  } finally {
    if (locker && !locker.child.stdin.writableEnded) locker.child.stdin.end('rollback;\n');
    if (locker) await locker.done.catch(() => {});
    if (finisher) await finisher.done.catch(() => {});
    cleanup(f);
  }
}
module.exports = { sql, fixture, cleanup, finishSql, race };
