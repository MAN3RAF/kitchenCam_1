const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const ids = { owner: randomUUID(), scan: randomUUID(), raw: randomUUID(), job: randomUUID() };
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
    input: s,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let locker;
(async () => {
  try {
    sql(`begin;
   insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('${ids.owner}','authenticated','authenticated',true,'{}','{}',now(),now());
   insert into public.scans(id,owner_id,source,state,image_revision,sanitization_state,first_uploaded_at,media_expires_at)
    values('${ids.scan}','${ids.owner}','camera','sanitizing',1,'pending',now(),now()+interval '24 hours');
   insert into private.scan_controls(scan_id) values('${ids.scan}');
   insert into private.scan_images(id,scan_id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,write_deadline,delete_by,byte_size,width,height,digest)
    values('${ids.raw}','${ids.scan}','${ids.scan}','${ids.owner}',1,1,'raw','scan-raw-private','${ids.owner}/${ids.raw}',now(),now()+interval '1 hour',100,256,256,repeat('a',64));
   insert into private.scan_jobs(id,scan_id,image_id,image_revision,generation,stage,deadline)
    values('${ids.job}','${ids.scan}','${ids.raw}',1,1,'sanitize',now()+interval '1 hour');
   commit;`);
    const claim = JSON.parse(
      sql(`select public.internal_scan_claim_job('${ids.scan}','sanitize');`),
    );
    // Shorten only these fixture deadlines, retaining the real finish RPC unchanged.
    sql(`update private.scan_jobs set lease_until=clock_timestamp()+interval '3 seconds' where id='${ids.job}';
    update private.scan_images set write_deadline=clock_timestamp()+interval '3 seconds' where id='${claim.output.id}';`);
    locker = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let diagnostic = '';
    locker.stderr.on('data', () => {});
    const locked = new Promise((r) =>
      locker.stdout.on('data', (b) => {
        diagnostic += b.toString();
        if (diagnostic.includes('RAW_LOCK_HELD')) r();
      }),
    );
    const closed = new Promise((r, j) => {
      locker.on('error', j);
      locker.on('close', (code) => (code === 0 ? r() : j(new Error('LOCKER_FAILURE'))));
    });
    locker.stdin.write(
      `begin;set local statement_timeout='10s';select 1 from private.scan_images where id='${ids.raw}' for update;select 'RAW_LOCK_HELD';\n`,
    );
    await locked;
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let result = '';
    child.stdout.on('data', (b) => (result += b.toString()));
    child.stderr.on('data', () => {});
    const finished = new Promise((r, j) => {
      child.on('error', j);
      child.on('close', (code) => (code === 0 ? r() : j(new Error('FINISH_FAILURE'))));
    });
    child.stdin
      .end(`set statement_timeout='10s';select public.internal_scan_finish_job('${ids.job}','${claim.leaseToken}',
   jsonb_build_object('imageId','${claim.output.id}','digest',repeat('b',64),'bytes',100,'width',256,'height',256,'sanitizerVersion','phase-f-probe'));\n`);
    let waiting = false;
    for (let i = 0; i < 60; i++) {
      waiting =
        Number(
          sql(
            "select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%select public.internal_scan_finish_job%';",
          ),
        ) > 0;
      if (waiting) break;
      await delay(25);
    }
    assert.ok(waiting, 'finish must really wait on the raw inventory lock');
    await delay(3500);
    const expired = sql(
      `select lease_until < clock_timestamp() from private.scan_jobs where id='${ids.job}';`,
    );
    assert.equal(expired, 't');
    locker.stdin.end('commit;\n');
    await closed;
    await finished;
    const state = JSON.parse(
      sql(
        `select jsonb_build_object('state',s.state,'sanitization',s.sanitization_state,'approvedAfterWriterDeadline',i.approved_at>i.write_deadline,'recognitionJobs',(select count(*) from private.scan_jobs where scan_id=s.id and stage='recognize')) from public.scans s join private.scan_images i on i.scan_id=s.id and i.kind='sanitized' where s.id='${ids.scan}';`,
      ),
    );
    console.log(
      JSON.stringify({
        observedLockWait: waiting,
        leaseExpiredBeforeUnlock: expired === 't',
        finishReturnedTrue: result.trim().endsWith('t'),
        ...state,
      }),
    );
  } finally {
    if (locker && !locker.stdin.writableEnded) locker.stdin.end('rollback;\n');
    sql(
      `delete from auth.users where id='${ids.owner}';delete from private.scan_images where original_scan_id='${ids.scan}';delete from public.scan_deletions where scan_id='${ids.scan}';`,
    );
    console.log(
      JSON.stringify({
        fixtureRowsRemaining: Number(
          sql(
            `select (select count(*) from auth.users where id='${ids.owner}')+(select count(*) from public.scans where id='${ids.scan}')+(select count(*) from private.scan_images where original_scan_id='${ids.scan}');`,
          ),
        ),
      }),
    );
  }
})().catch(() => {
  console.error('FENCE_PROBE_FAILED');
  process.exitCode = 1;
});
