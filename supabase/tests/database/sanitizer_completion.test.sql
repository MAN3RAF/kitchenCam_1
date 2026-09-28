begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('81000000-0000-4000-8000-000000000001','authenticated','authenticated',true,'{}','{}',now(),now());
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create temp table ctx(name text primary key,data jsonb);
create function pg_temp.fixture() returns jsonb language plpgsql as $$
declare s public.scans; raw_id uuid:=gen_random_uuid(); claim jsonb; t timestamptz:=clock_timestamp();
begin
  s:=public.create_scan(gen_random_uuid(),'camera');
  update public.scans set state='sanitizing',sanitization_state='pending',first_uploaded_at=t,media_expires_at=t+interval '24 hours' where id=s.id;
  insert into private.scan_images(id,scan_id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,write_deadline,delete_by,digest,byte_size,width,height)
    values(raw_id,s.id,s.id,auth.uid(),1,1,'raw','scan-raw-private',auth.uid()::text||'/'||raw_id::text,t,t+interval '1 hour',repeat('a',64),100,256,256);
  insert into private.scan_jobs(scan_id,image_id,image_revision,generation,stage,deadline) values(s.id,raw_id,1,1,'sanitize',t+interval '1 hour');
  claim:=public.internal_scan_claim_job(s.id,'sanitize');
  return claim||jsonb_build_object('scanId',s.id,'rawId',raw_id);
end;
$$;
create function pg_temp.finish(c jsonb) returns boolean language sql as $$
select public.internal_scan_finish_job((c->>'jobId')::uuid,(c->>'leaseToken')::uuid,
 jsonb_build_object('imageId',c->'output'->>'id','digest',repeat('b',64),'bytes',100,'width',256,'height',256,'sanitizerVersion','phase-f-v1'));
$$;
select ok(has_function_privilege('service_role','public.internal_scan_finish_job(uuid,uuid,jsonb)','EXECUTE'),'service finish grant preserved');
select ok(not has_function_privilege('authenticated','public.internal_scan_finish_job(uuid,uuid,jsonb)','EXECUTE'),'client finish denied');
select ok(not has_function_privilege('anon','public.internal_scan_finish_job(uuid,uuid,jsonb)','EXECUTE'),'anon finish denied');
insert into ctx values('valid',pg_temp.fixture());
select ok(pg_temp.finish((select data from ctx where name='valid')),'valid sanitizer completes');
select ok(not pg_temp.finish((select data from ctx where name='valid')),'duplicate success is fenced');
select is((select count(*) from private.scan_jobs where scan_id=(select (data->>'scanId')::uuid from ctx where name='valid') and stage='recognize'),1::bigint,'one recognition eligibility row');
insert into ctx values('raw-cleanup',pg_temp.fixture());
update private.scan_images set delete_requested_at=clock_timestamp() where id=(select (data->>'rawId')::uuid from ctx where name='raw-cleanup');
select ok(not pg_temp.finish((select data from ctx where name='raw-cleanup')),'raw cleanup revokes eligibility');
-- A transaction-local trigger models elapsed time in a later write. It is rolled
-- back with this test and is never installed by a migration.
create function pg_temp.delay_recognition_insert() returns trigger language plpgsql as $$
begin
 if new.stage='recognize' then perform pg_sleep(0.3); end if;
 return new;
end;
$$;
create trigger test_delay_recognition before insert on private.scan_jobs for each row execute function pg_temp.delay_recognition_insert();
insert into ctx values('late-write',pg_temp.fixture());
update private.scan_jobs set lease_until=clock_timestamp()+interval '0.15 seconds' where id=(select (data->>'jobId')::uuid from ctx where name='late-write');
select ok(not pg_temp.finish((select data from ctx where name='late-write')),'post-write clock fence rolls back elapsed-time expiry');
select is((select count(*) from private.scan_images where scan_id=(select (data->>'scanId')::uuid from ctx where name='late-write') and approved_at is not null),0::bigint,'tentative approval rolled back');
select is((select count(*) from private.scan_jobs where scan_id=(select (data->>'scanId')::uuid from ctx where name='late-write') and stage='recognize'),0::bigint,'tentative queue insertion rolled back');
select is((select state::text from public.scans where id=(select (data->>'scanId')::uuid from ctx where name='late-write')),'sanitizing','trusted scan transition rolled back');
select ok((select delete_requested_at is null from private.scan_images where id=(select (data->>'rawId')::uuid from ctx where name='late-write')),'raw cleanup mutation rolled back');
select ok(not pg_temp.finish((select data from ctx where name='late-write')),'expired retry remains rejected');
-- Independent review: expiry in a later write must cover the job deadline,
-- not just lease time. All earlier trust/cleanup effects remain transactional.
insert into ctx values('late-deadline',pg_temp.fixture());
update private.scan_jobs set deadline=clock_timestamp()+interval '0.15 seconds' where id=(select (data->>'jobId')::uuid from ctx where name='late-deadline');
select ok(not pg_temp.finish((select data from ctx where name='late-deadline')),'post-write job deadline expiry is rejected');
select is((select count(*) from private.scan_images where scan_id=(select (data->>'scanId')::uuid from ctx where name='late-deadline') and approved_at is not null),0::bigint,'deadline rollback removes approval');
select is((select count(*) from private.scan_jobs where scan_id=(select (data->>'scanId')::uuid from ctx where name='late-deadline') and stage='recognize'),0::bigint,'deadline rollback removes queue');
select ok((select delete_requested_at is null from private.scan_images where id=(select (data->>'rawId')::uuid from ctx where name='late-deadline')),'deadline rollback preserves raw cleanup obligation');
-- An unrelated exception must propagate and roll back the whole call, rather
-- than being swallowed as a successful or partially applied transition.
create or replace function pg_temp.delay_recognition_insert() returns trigger language plpgsql as $$
begin
 if new.stage='recognize' then raise exception 'REVIEW_INSERT_FAILURE'; end if;
 return new;
end;
$$;
insert into ctx values('write-exception',pg_temp.fixture());
select throws_ok($q$select pg_temp.finish((select data from ctx where name='write-exception'))$q$,'P0001','REVIEW_INSERT_FAILURE','later write exception aborts completion');
select is((select count(*) from private.scan_images where scan_id=(select (data->>'scanId')::uuid from ctx where name='write-exception') and approved_at is not null),0::bigint,'exception removes approval');
select is((select count(*) from private.scan_jobs where scan_id=(select (data->>'scanId')::uuid from ctx where name='write-exception') and stage='recognize'),0::bigint,'exception removes queue');
select is((select state::text from public.scans where id=(select (data->>'scanId')::uuid from ctx where name='write-exception')),'sanitizing','exception preserves scan state');
select ok((select delete_requested_at is null from private.scan_images where id=(select (data->>'rawId')::uuid from ctx where name='write-exception')),'exception removes tentative raw cleanup request');
select is((select state from private.scan_jobs where id=(select (data->>'jobId')::uuid from ctx where name='write-exception')),'running','exception preserves active job');
select * from finish();
rollback;
