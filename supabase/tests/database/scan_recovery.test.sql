begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('61000000-0000-4000-8000-000000000001','authenticated','authenticated',true,'{}','{}',now(),now());
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
update private.scan_processing_policy set enabled=true;
create temp table ctx(name text primary key,data jsonb);
grant all on ctx to authenticated,service_role;

-- Fixture control-plane calls only: no image bytes, mock recognizer or production worker.
create function pg_temp.processing_fixture() returns jsonb language plpgsql as $$
declare s public.scans; a jsonb; token text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
begin
  s:=public.create_scan(gen_random_uuid(),'gallery');
  a:=public.internal_scan_upload(auth.uid(),s.id,gen_random_uuid(),'authorize',jsonb_build_object('expectedVersion',1,'imageRevision',1,'tokenHash',token,'noticeVersion','phase-a-v1'));
  perform public.internal_scan_upload(auth.uid(),s.id,gen_random_uuid(),'claim',jsonb_build_object('uploadId',a->>'uploadId','tokenHash',token));
  perform public.internal_scan_upload(auth.uid(),s.id,gen_random_uuid(),'complete',jsonb_build_object('uploadId',a->>'uploadId','tokenHash',token,'bytes',100,'width',256,'height',256,'digest',repeat('a',64),'mime','image/jpeg'));
  return jsonb_build_object('scanId',s.id,'lease',public.internal_scan_claim_job(s.id,'sanitize'));
end;
$$;
insert into ctx values('retry',pg_temp.processing_fixture());
select ok(not public.internal_scan_finish_job((select (data->'lease'->>'jobId')::uuid from ctx where name='retry'),gen_random_uuid(),'{"error":"SANITIZER_TIMEOUT"}'),'wrong lease token denied');
select ok(public.internal_scan_finish_job((select (data->'lease'->>'jobId')::uuid from ctx where name='retry'),(select (data->'lease'->>'leaseToken')::uuid from ctx where name='retry'),'{"error":"SANITIZER_TIMEOUT"}'),'transient sanitizer failure returns to pending');
insert into ctx select 'retry2',public.internal_scan_claim_job((data->>'scanId')::uuid,'sanitize') from ctx where name='retry';
select isnt((select data->'output'->>'id' from ctx where name='retry2'),(select data->'lease'->'output'->>'id' from ctx where name='retry'),'retry gets a different immutable output target');
select ok(not public.internal_scan_finish_job((select (data->'lease'->>'jobId')::uuid from ctx where name='retry'),(select (data->'lease'->>'leaseToken')::uuid from ctx where name='retry'),'{"error":"SANITIZER_TIMEOUT"}'),'old lease fenced after retry');
select ok(public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='retry2'),(select (data->>'leaseToken')::uuid from ctx where name='retry2'),'{"error":"SANITIZER_TIMEOUT"}'),'second infrastructure failure can retry');
insert into ctx select 'retry3',public.internal_scan_claim_job((data->>'scanId')::uuid,'sanitize') from ctx where name='retry';
select ok(public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='retry3'),(select (data->>'leaseToken')::uuid from ctx where name='retry3'),'{"error":"SANITIZER_TIMEOUT"}'),'third failure is recorded');
select is((select state::text from public.scans where id=(select (data->>'scanId')::uuid from ctx where name='retry')),'failed','retry budget exhausts into failed state');
select throws_ok($$select public.internal_scan_claim_job((select (data->>'scanId')::uuid from ctx where name='retry'),'sanitize')$$,'P0001','JOB_UNAVAILABLE','no fourth attempt');
set local role authenticated;
select lives_ok($$select public.mutate_scan(id,gen_random_uuid(),'manual',jsonb_build_object('expectedVersion',version,'imageRevision',image_revision)) from public.scans where id=(select (data->>'scanId')::uuid from ctx where name='retry')$$,'exhausted job can recover with manual entry');
reset role;

insert into ctx values('replacement',pg_temp.processing_fixture());
set local role authenticated;
insert into ctx select 'replaced',public.mutate_scan(id,gen_random_uuid(),'replace',jsonb_build_object('expectedVersion',version)) from public.scans where id=(select (data->>'scanId')::uuid from ctx where name='replacement');
select is((select data->>'image_revision' from ctx where name='replaced'),'2','replacement advances image revision');
select is((select data->>'sanitization_state' from ctx where name='replaced'),'not_started','replacement invalidates sanitizer approval');
reset role;
select ok(not public.internal_scan_finish_job((select (data->'lease'->>'jobId')::uuid from ctx where name='replacement'),(select (data->'lease'->>'leaseToken')::uuid from ctx where name='replacement'),'{"error":"SANITIZER_TIMEOUT"}'),'replaced photo fences old worker');
select ok((select bool_and(delete_requested_at is not null) from private.scan_images where scan_id=(select (data->>'scanId')::uuid from ctx where name='replacement')),'replacement schedules prior artifacts for cleanup');

insert into ctx values('reclaim',pg_temp.processing_fixture());
update private.scan_jobs set lease_until=clock_timestamp()-interval '1 second' where id=(select (data->'lease'->>'jobId')::uuid from ctx where name='reclaim');
insert into ctx select 'reclaimed',public.internal_scan_claim_job((data->>'scanId')::uuid,'sanitize') from ctx where name='reclaim';
select isnt((select data->>'leaseToken' from ctx where name='reclaimed'),(select data->'lease'->>'leaseToken' from ctx where name='reclaim'),'expired lease gets new fencing token');
select ok(not public.internal_scan_finish_job((select (data->'lease'->>'jobId')::uuid from ctx where name='reclaim'),(select (data->'lease'->>'leaseToken')::uuid from ctx where name='reclaim'),'{"error":"SANITIZER_TIMEOUT"}'),'crashed worker cannot finish after reclaim');
select throws_ok($$select public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='reclaimed'),(select (data->>'leaseToken')::uuid from ctx where name='reclaimed'),jsonb_build_object('imageId',(select data->'output'->>'id' from ctx where name='reclaimed'),'digest',repeat('b',64),'bytes',4194305,'width',256,'height',256,'sanitizerVersion','phase-a-v1'))$$,'23514',null,'oversized sanitizer output cannot be approved');
select ok(public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='reclaimed'),(select (data->>'leaseToken')::uuid from ctx where name='reclaimed'),jsonb_build_object('imageId',(select data->'output'->>'id' from ctx where name='reclaimed'),'digest',repeat('b',64),'bytes',100,'width',256,'height',256,'sanitizerVersion','phase-a-v1')),'current attempt can approve bounded output');
select throws_ok($$update private.scan_images set digest=repeat('f',64) where id=(select (data->'output'->>'id')::uuid from ctx where name='reclaimed')$$,'P0001','IMMUTABLE_SANITIZER_APPROVAL','approved bytes cannot be retargeted');
select throws_ok($$update private.scan_images set object_path='other-path' where id=(select (data->'output'->>'id')::uuid from ctx where name='reclaimed')$$,'P0001','IMMUTABLE_IMAGE_TARGET','registered path cannot be changed');
update private.scan_processing_policy set enabled=false;
select throws_ok($$select public.internal_scan_claim_job((select (data->>'scanId')::uuid from ctx where name='reclaim'),'recognize')$$,'P0001','RECOGNITION_UNAVAILABLE','outage prevents new dispatch');
set local role authenticated;
select is((select state::text from public.scans where id=(select (data->>'scanId')::uuid from ctx where name='reclaim')),'queued','already admitted status remains readable during outage');
reset role;
update private.scan_processing_policy set enabled=true;
insert into ctx select 'recognition',public.internal_scan_claim_job((data->>'scanId')::uuid,'recognize') from ctx where name='reclaim';
select throws_ok($$select public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='recognition'),(select (data->>'leaseToken')::uuid from ctx where name='recognition'),'{"assessment":"food_detected","ingredients":[]}')$$,'P0001','VALIDATION','empty food claim is invalid');
select throws_ok($$select public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='recognition'),(select (data->>'leaseToken')::uuid from ctx where name='recognition'),'{"assessment":"abstained","ingredients":[],"provider":"secret"}')$$,'P0001','VALIDATION','provider envelope cannot enter public state');
select ok(public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='recognition'),(select (data->>'leaseToken')::uuid from ctx where name='recognition'),'{"assessment":"abstained","ingredients":[]}'),'valid empty assessment creates editable draft');
select is((select state::text from public.scans where id=(select (data->>'scanId')::uuid from ctx where name='reclaim')),'needs_confirmation','assessment awaits explicit user confirmation');
select ok(not public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='recognition'),(select (data->>'leaseToken')::uuid from ctx where name='recognition'),'{"assessment":"abstained","ingredients":[]}'),'completion cannot apply twice');

insert into ctx select 'expired',to_jsonb(public.create_scan(gen_random_uuid(),'camera'));
-- One shared timestamp is necessary for the exact 24-hour constraint.
update public.scans set first_uploaded_at=now()-interval '25 hours',media_expires_at=now()-interval '1 hour' where id=(select (data->>'id')::uuid from ctx where name='expired');
select ok(public.internal_scan_expire((select (data->>'id')::uuid from ctx where name='expired')),'due scan can be durably expired');
select is((select state::text from public.scans where id=(select (data->>'id')::uuid from ctx where name='expired')),'expired','expiry is terminal');
set local role authenticated;
select throws_ok($$select public.mutate_scan(id,gen_random_uuid(),'replace',jsonb_build_object('expectedVersion',version)) from public.scans where id=(select (data->>'id')::uuid from ctx where name='expired')$$,'P0001','CANCELLED','expired scan cannot be reopened');
reset role;
select * from finish();
rollback;
