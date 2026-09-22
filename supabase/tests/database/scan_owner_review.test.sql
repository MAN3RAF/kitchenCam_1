begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Audit the actual catalog, including privileges inherited from Supabase defaults.
select ok(not has_table_privilege(role_name, c.oid, privilege_name),
  role_name || ' cannot ' || privilege_name || ' ' || n.nspname || '.' || c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privileges(privilege_name)
where c.relkind='r' and n.nspname in ('public','private') and c.relname like 'scan%';
select ok(not has_table_privilege(role_name,c.oid,'SELECT'),role_name || ' cannot read private.' || c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('anon'),('authenticated'),('service_role')) roles(role_name)
where c.relkind='r' and n.nspname='private' and c.relname like 'scan%';
select ok(not has_function_privilege(role_name,p.oid,'EXECUTE'),role_name || ' cannot execute ' || p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join (values ('anon'),('authenticated')) roles(role_name)
where (n.nspname='private' and p.proname like '%scan%')
   or (n.nspname='public' and p.proname like 'internal_%scan%');
select ok(p.proconfig @> array['search_path=""'],p.proname || ' fixes search_path')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname like '%scan%' and p.prosecdef;

-- A cleanup claim before the final writer deadline must never become final simply
-- because acknowledgement arrives afterward. No clock override or real sleep needed:
-- shorten this disposable fixture's deadline between claim and acknowledgement.
create temp table ctx(name text primary key,data jsonb);
insert into private.scan_images(id,original_scan_id,image_revision,generation,kind,bucket_id,object_path,write_deadline,delete_by,delete_requested_at)
values('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',1,1,'raw','scan-raw-private','owner-review/deadline',clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '1 hour',clock_timestamp());
insert into ctx values('sweep',public.internal_scan_claim_cleanup());
update private.scan_images set write_deadline=clock_timestamp() where id='71000000-0000-4000-8000-000000000001';
select ok(not public.internal_scan_ack_cleanup('71000000-0000-4000-8000-000000000001',(select (data->0->>'token')::uuid from ctx where name='sweep')),
  'pre-deadline sweep acknowledged after deadline cannot retire a late write');
select ok((select cleaned_at is null and object_path='owner-review/deadline' from private.scan_images where id='71000000-0000-4000-8000-000000000001'),
  'unsafe sweep preserves the cleanup obligation and real object path');
update ctx set data=public.internal_scan_claim_cleanup() where name='sweep';
select ok(public.internal_scan_ack_cleanup('71000000-0000-4000-8000-000000000001',(select (data->0->>'token')::uuid from ctx where name='sweep')),
  'a new sweep begun after the writer deadline can retire the object');

insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('71000000-0000-4000-8000-000000000010','authenticated','authenticated',true,'{}','{}',now(),now()),
 ('71000000-0000-4000-8000-000000000011','authenticated','authenticated',true,'{}','{}',now(),now()),
 ('71000000-0000-4000-8000-000000000012','authenticated','authenticated',false,'{}','{}',now(),now());
grant all on ctx to authenticated,service_role;
insert into ctx values('ingredients','[{"id":"71000000-0000-4000-8000-000000000020","displayName":"Tomato","normalizedName":null,"canonicalId":null,"selected":true,"quantity":null,"provenance":"manual","detectionId":null}]');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000010","role":"authenticated","is_anonymous":true}',true);
insert into ctx select 'draft',to_jsonb(public.create_scan(gen_random_uuid(),'manual',(select data from ctx where name='ingredients')));
insert into ctx select 'confirmed',to_jsonb(public.create_scan(gen_random_uuid(),'manual',(select data from ctx where name='ingredients')));
update ctx set data=public.mutate_scan((data->>'id')::uuid,gen_random_uuid(),'confirm','{"expectedVersion":1,"draftRevision":1}') where name='confirmed';
reset role;
update auth.users set is_anonymous=false where id='71000000-0000-4000-8000-000000000010';
set local role authenticated;
select is((select ingredients from public.scans where id=(select (data->>'id')::uuid from ctx where name='draft')),(select data from ctx where name='ingredients'),'same-ID upgrade preserves ingredient draft');
select is((select confirmed_ingredients from public.scans where id=(select (data->>'id')::uuid from ctx where name='confirmed')),(select data from ctx where name='ingredients'),'same-ID upgrade preserves confirmation snapshot');
select is((select state::text from public.scans where id=(select (data->>'id')::uuid from ctx where name='confirmed')),'confirmed','same-ID upgrade preserves confirmation state');

select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000011","role":"authenticated","is_anonymous":true}',true);
insert into ctx select 'merge_draft',to_jsonb(public.create_scan(gen_random_uuid(),'manual',(select data from ctx where name='ingredients')));
insert into ctx select 'merge_confirmed',to_jsonb(public.create_scan(gen_random_uuid(),'manual',(select data from ctx where name='ingredients')));
update ctx set data=public.mutate_scan((data->>'id')::uuid,gen_random_uuid(),'confirm','{"expectedVersion":1,"draftRevision":1}') where name='merge_confirmed';
select public.issue_account_merge_ticket(repeat('7',64),now()+interval '10 minutes');
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000012","role":"authenticated","is_anonymous":false}',true);
select public.consume_account_merge_ticket(repeat('7',64),gen_random_uuid());
select is((select ingredients from public.scans where id=(select (data->>'id')::uuid from ctx where name='merge_draft')),(select data from ctx where name='ingredients'),'merge preserves transferred draft');
select is((select confirmed_ingredients from public.scans where id=(select (data->>'id')::uuid from ctx where name='merge_confirmed')),(select data from ctx where name='ingredients'),'merge preserves transferred confirmation');
reset role;
delete from auth.users where id='71000000-0000-4000-8000-000000000011';
select is((select count(*) from public.scans where owner_id='71000000-0000-4000-8000-000000000012'),2::bigint,'source cascade cannot remove transferred drafts or confirmations');

-- Account-specific sweeps obey the same final-writer rule as global cleanup.
insert into private.scan_images(id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,write_deadline,delete_by)
values('71000000-0000-4000-8000-000000000030','71000000-0000-4000-8000-000000000031','71000000-0000-4000-8000-000000000012',1,1,'raw','scan-raw-private','owner-review/account-deadline',clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','71000000-0000-4000-8000-000000000012','role','authenticated','is_anonymous',false,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
insert into ctx select 'request',to_jsonb(public.request_account_deletion(gen_random_uuid()));
set local role service_role;
insert into ctx select 'account_sweep',public.internal_account_scan_cleanup((data#>>'{}')::uuid) from ctx where name='request';
reset role;
update private.scan_images set write_deadline=clock_timestamp() where id='71000000-0000-4000-8000-000000000030';
set local role service_role;
select ok(not public.internal_scan_ack_cleanup('71000000-0000-4000-8000-000000000030',(select (data->0->>'token')::uuid from ctx where name='account_sweep')),'account sweep also rejects an acknowledgement crossing the deadline');
select ok(not public.internal_account_scan_cleanup_ready((select (data#>>'{}')::uuid from ctx where name='request')),'account cleanup stays pending after unsafe sweep');
reset role;
delete from auth.users where id='71000000-0000-4000-8000-000000000012';
select ok((select owner_id is null and cleaned_at is null and privacy_request_id is not null and object_path='owner-review/account-deadline' from private.scan_images where id='71000000-0000-4000-8000-000000000030'),'direct Auth deletion preserves outstanding physical cleanup');
set local role service_role;
update ctx set data=public.internal_account_scan_cleanup((select (data#>>'{}')::uuid from ctx where name='request')) where name='account_sweep';
select ok(public.internal_scan_ack_cleanup('71000000-0000-4000-8000-000000000030',(select (data->0->>'token')::uuid from ctx where name='account_sweep')),'account sweep after deadline can finish after Auth deletion');
reset role;

-- A raw target has a conservative deadline starting at authorization, while the
-- scan's 24-hour clock starts at intake claim. The lease must respect the earlier
-- input deadline even when less than 60 seconds remain.
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000010","role":"authenticated","is_anonymous":false}',true);
update private.scan_processing_policy set enabled=true;
insert into ctx select 'near_deadline',to_jsonb(public.create_scan(gen_random_uuid(),'camera'));
insert into ctx select 'near_upload',public.internal_scan_upload(auth.uid(),(data->>'id')::uuid,gen_random_uuid(),'authorize',jsonb_build_object('expectedVersion',1,'imageRevision',1,'tokenHash',repeat('8',64),'noticeVersion','phase-a-v1')) from ctx where name='near_deadline';
select public.internal_scan_upload(auth.uid(),(select (data->>'id')::uuid from ctx where name='near_deadline'),gen_random_uuid(),'claim',jsonb_build_object('uploadId',(select data->>'uploadId' from ctx where name='near_upload'),'tokenHash',repeat('8',64)));
select public.internal_scan_upload(auth.uid(),(select (data->>'id')::uuid from ctx where name='near_deadline'),gen_random_uuid(),'complete',jsonb_build_object('uploadId',(select data->>'uploadId' from ctx where name='near_upload'),'tokenHash',repeat('8',64),'bytes',100,'width',256,'height',256,'digest',repeat('9',64),'mime','image/jpeg'));
update private.scan_images set write_deadline=clock_timestamp(),delete_by=clock_timestamp()+interval '30 seconds' where scan_id=(select (data->>'id')::uuid from ctx where name='near_deadline');
select lives_ok($$insert into ctx select 'near_lease',public.internal_scan_claim_job((data->>'id')::uuid,'sanitize') from ctx where name='near_deadline'$$,'a near-deadline job gets a bounded lease without a constraint failure');
select ok((select j.lease_until <= i.delete_by and j.deadline <= i.delete_by from private.scan_jobs j join private.scan_images i on i.id=j.image_id where j.scan_id=(select (data->>'id')::uuid from ctx where name='near_deadline')),'job lease and absolute deadline cannot outlive input media');

select * from finish();
rollback;
