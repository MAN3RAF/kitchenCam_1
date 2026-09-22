begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('51000000-0000-4000-8000-000000000001','authenticated','authenticated',true,'{}','{}',now(),now()),
 ('51000000-0000-4000-8000-000000000002','authenticated','authenticated',false,'{}','{}',now(),now()),
 ('51000000-0000-4000-8000-000000000003','authenticated','authenticated',true,'{}','{}',now(),now());
create temp table ctx(name text primary key, data jsonb);
grant all on ctx to authenticated, service_role;
insert into ctx values ('ingredient','[{"id":"52000000-0000-4000-8000-000000000001","displayName":"Tomato","normalizedName":null,"canonicalId":null,"selected":true,"quantity":null,"provenance":"manual","detectionId":null}]');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.scans'::regclass),'scan RLS is forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.scan_deletions'::regclass),'receipt RLS is forced');
select ok(not has_function_privilege('authenticated','public.internal_scan_upload(uuid,uuid,uuid,text,jsonb)','EXECUTE'),'clients cannot invoke ingress control');
select ok(not has_function_privilege('authenticated','public.internal_scan_finish_job(uuid,uuid,jsonb)','EXECUTE'),'clients cannot approve sanitizer or recognition');
select ok(not has_function_privilege('anon','public.create_scan(uuid,public.scan_source,jsonb)','EXECUTE'),'signed-out clients cannot create scans');
select ok(not has_table_privilege('authenticated','private.scan_images','SELECT'),'image inventory is server-only');
select ok(not has_table_privilege('authenticated','private.scan_jobs','SELECT'),'jobs are server-only');
select ok(not has_table_privilege('authenticated','private.scan_operations','SELECT'),'operation digests are server-only');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
insert into ctx select 'manual',to_jsonb(public.create_scan('53000000-0000-4000-8000-000000000001','manual',(select data from ctx where name='ingredient')));
select is((select data->>'state' from ctx where name='manual'),'needs_confirmation','manual creation is editable');
select is((select data->>'image_revision' from ctx where name='manual'),'0','manual has no image revision');
select is((select count(*) from public.scans),1::bigint,'anonymous owner sees scan');
select throws_ok($$update public.scans set state='confirmed'$$,'42501',null,'direct client state writes denied');
select throws_ok($$delete from public.scans$$,'42501',null,'direct client deletion denied');
select throws_ok($$select * from private.scan_images$$,'42501',null,'private paths denied');
select is((public.create_scan('53000000-0000-4000-8000-000000000001','manual',(select data from ctx where name='ingredient'))).id,
 (select (data->>'id')::uuid from ctx where name='manual'),'create acknowledgement replay returns same scan');
select throws_ok($$select public.create_scan('53000000-0000-4000-8000-000000000001','manual','[]')$$,'P0001','IDEMPOTENCY_CONFLICT','different create payload conflicts');
select throws_ok($$select public.create_scan(gen_random_uuid(),'manual','[{"path":"secret"}]')$$,'P0001','VALIDATION','private ingredient fields rejected');
select throws_ok($$select public.mutate_scan((select (data->>'id')::uuid from ctx where name='manual'),gen_random_uuid(),'cancel','{"expectedVersion":"sensitive-input"}')$$,'P0001','VALIDATION','malformed revision returns a safe code without echoing input');

insert into ctx select 'confirmed',public.mutate_scan((data->>'id')::uuid,'53000000-0000-4000-8000-000000000002','confirm','{"expectedVersion":1,"draftRevision":1}') from ctx where name='manual';
select is((select data->>'state' from ctx where name='confirmed'),'confirmed','explicit confirmation succeeds');
select is(jsonb_array_length((select data->'confirmed_ingredients' from ctx where name='confirmed')),1,'snapshot contains selected row');
select is(public.mutate_scan((select (data->>'id')::uuid from ctx where name='manual'),'53000000-0000-4000-8000-000000000002','confirm','{"draftRevision":1,"expectedVersion":1}')->>'version','2','same payload reordered replay precedes stale revision rejection');
select throws_ok($$select public.mutate_scan((select (data->>'id')::uuid from ctx where name='manual'),gen_random_uuid(),'confirm','{"expectedVersion":1,"draftRevision":1}')$$,'P0001','VERSION_CONFLICT','new stale operation conflicts');
insert into ctx select 'edited',public.mutate_scan((data->>'id')::uuid,gen_random_uuid(),'ingredients',jsonb_build_object('expectedVersion',2,'expectedDraftRevision',1,'ingredients',(select data from ctx where name='ingredient'))) from ctx where name='manual';
select is((select data->>'state' from ctx where name='edited'),'needs_confirmation','editing invalidates confirmation');
select is((select data->'confirmed_ingredients' from ctx where name='edited'),'null'::jsonb,'old snapshot removed');
select is((select data->>'draft_revision' from ctx where name='edited'),'2','draft revision advances');
insert into ctx select 'empty',to_jsonb(public.create_scan(gen_random_uuid(),'manual','[]'));
select throws_ok($$select public.mutate_scan((select (data->>'id')::uuid from ctx where name='empty'),gen_random_uuid(),'confirm','{"expectedVersion":1,"draftRevision":1}')$$,'P0001','VALIDATION','empty confirmation denied');

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
select is((select count(*) from public.scans),0::bigint,'other owner cannot read scans');
select throws_ok($$select public.mutate_scan((select (data->>'id')::uuid from ctx where name='manual'),'53000000-0000-4000-8000-000000000002','confirm','{"expectedVersion":1,"draftRevision":1}')$$,'P0001','NOT_FOUND','ownership checked before known-key replay');
reset role;
update auth.users set is_anonymous=false where id='51000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
select is((select count(*) from public.scans),2::bigint,'same-UUID upgrade preserves scan ownership');
insert into ctx select 'deleted',public.mutate_scan((data->>'id')::uuid,'53000000-0000-4000-8000-000000000003','delete','{"expectedVersion":3}') from ctx where name='manual';
select is((select count(*) from public.scans),1::bigint,'deleted scan immediately hidden');
select is((select count(*) from public.scan_deletions),1::bigint,'owner can read deletion receipt');
select is(public.mutate_scan((select (data->>'id')::uuid from ctx where name='manual'),'53000000-0000-4000-8000-000000000003','delete','{"expectedVersion":3}')->>'id',
 (select data->>'id' from ctx where name='deleted'),'delete replay retains receipt');
select throws_ok($$select public.create_scan('53000000-0000-4000-8000-000000000001','manual',(select data from ctx where name='ingredient'))$$,'P0001','NOT_FOUND','create replay cannot resurrect deletion');

-- A separate guest exercises durable processing. Service methods do not generate bytes/results.
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}',true);
insert into ctx select 'image',to_jsonb(public.create_scan(gen_random_uuid(),'camera'));
reset role;
select throws_ok($$select public.internal_scan_upload('51000000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from ctx where name='image'),gen_random_uuid(),'authorize',jsonb_build_object('expectedVersion',1,'imageRevision',1,'tokenHash',repeat('a',64),'noticeVersion','phase-a-v1'))$$,'P0001','RECOGNITION_UNAVAILABLE','admission is closed by default');
update private.scan_processing_policy set enabled=true;
set local role service_role;
insert into ctx select 'upload', public.internal_scan_upload('51000000-0000-4000-8000-000000000003',(data->>'id')::uuid,gen_random_uuid(),'authorize',jsonb_build_object('expectedVersion',1,'imageRevision',1,'tokenHash',repeat('a',64),'noticeVersion','phase-a-v1')) from ctx where name='image';
select throws_ok($$select public.internal_scan_claim_job((select (data->>'id')::uuid from ctx where name='image'),'recognize')$$,'P0001','JOB_UNAVAILABLE','unsanitized recognition denied');
insert into ctx select 'claim',public.internal_scan_upload('51000000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from ctx where name='image'),'53000000-0000-4000-8000-000000000004','claim',jsonb_build_object('uploadId',data->>'uploadId','tokenHash',repeat('a',64))) from ctx where name='upload';
select throws_ok($$select public.internal_scan_upload('51000000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from ctx where name='image'),'53000000-0000-4000-8000-000000000004','claim',jsonb_build_object('uploadId',(select data->>'uploadId' from ctx where name='upload'),'tokenHash',repeat('a',64)))$$,'P0001','UPLOAD_EXPIRED','same-key claim cannot start a second writer');
select lives_ok($$select public.internal_scan_upload('51000000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from ctx where name='image'),'53000000-0000-4000-8000-000000000005','complete',jsonb_build_object('uploadId',(select data->>'uploadId' from ctx where name='upload'),'tokenHash',repeat('a',64),'bytes',1024,'width',256,'height',256,'digest',repeat('b',64),'mime','image/jpeg'))$$,'verified upload queues sanitizer');
select lives_ok($$select public.internal_scan_upload('51000000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from ctx where name='image'),'53000000-0000-4000-8000-000000000005','complete',jsonb_build_object('uploadId',(select data->>'uploadId' from ctx where name='upload'),'tokenHash',repeat('a',64),'bytes',1024,'width',256,'height',256,'digest',repeat('b',64),'mime','image/jpeg'))$$,'upload completion acknowledgement can be replayed');
insert into ctx select 'sanitize',public.internal_scan_claim_job((data->>'id')::uuid,'sanitize') from ctx where name='image';
select throws_ok($$select public.internal_scan_claim_job((select (data->>'id')::uuid from ctx where name='image'),'sanitize')$$,'P0001','JOB_UNAVAILABLE','active lease cannot be claimed twice');
select ok(public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='sanitize'),(select (data->>'leaseToken')::uuid from ctx where name='sanitize'),jsonb_build_object('imageId',(select data->'output'->>'id' from ctx where name='sanitize'),'digest',repeat('c',64),'bytes',900,'width',256,'height',256,'sanitizerVersion','phase-a-v1')),'current sanitizer lease approves immutable target');
insert into ctx select 'recognize',public.internal_scan_claim_job((data->>'id')::uuid,'recognize') from ctx where name='image';
reset role;
select is((select count(*) from private.scan_jobs where scan_id=(select (data->>'id')::uuid from ctx where name='image')),2::bigint,'completion replay did not duplicate jobs');
select ok((select approved_at is not null and digest=repeat('c',64) from private.scan_images where id=(select (data->'output'->>'id')::uuid from ctx where name='sanitize')),'approval binds digest and server artifact');
select throws_ok($$update public.scans set first_uploaded_at=first_uploaded_at+interval '1 hour',media_expires_at=media_expires_at+interval '1 hour' where id=(select (data->>'id')::uuid from ctx where name='image')$$,'P0001','IMMUTABLE_MEDIA_DEADLINE','deadline cannot be extended');
insert into ctx select 'deadline',to_jsonb(media_expires_at) from public.scans where id=(select (data->>'id')::uuid from ctx where name='image');
set local role authenticated;
insert into ctx select 'fallback',public.mutate_scan(id,gen_random_uuid(),'manual',jsonb_build_object('expectedVersion',version,'imageRevision',image_revision)) from public.scans where id=(select (data->>'id')::uuid from ctx where name='image');
select is((select data->>'state' from ctx where name='fallback'),'needs_confirmation','manual fallback acknowledged');
set local role service_role;
select ok(not public.internal_scan_finish_job((select (data->>'jobId')::uuid from ctx where name='recognize'),(select (data->>'leaseToken')::uuid from ctx where name='recognize'),'{"assessment":"abstained","ingredients":[]}'),'late worker cannot overwrite manual fallback');
reset role;
select is(to_jsonb((select media_expires_at from public.scans where id=(select (data->>'id')::uuid from ctx where name='image'))),(select data from ctx where name='deadline'),'fallback does not extend media retention');

-- Merge transfers owner data but invalidates all source authority. Original paths remain private.
set local role authenticated;
select public.issue_account_merge_ticket(repeat('d',64),now()+interval '10 minutes');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.consume_account_merge_ticket(repeat('d',64),gen_random_uuid())$$,'account merge includes scans');
select is((select count(*) from public.scans),1::bigint,'target owns transferred scan');
select lives_ok($$select public.consume_account_merge_ticket(repeat('d',64),gen_random_uuid())$$,'merge retry does not duplicate transfer');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}',true);
select is((select count(*) from public.scans),0::bigint,'source immediately loses scan ownership');
select throws_ok($$select public.create_scan(gen_random_uuid(),'manual','[]')$$,'P0001','ACCOUNT_NOT_ACTIVE','claimed source cannot create new scans during Auth cleanup');
reset role;
delete from auth.users where id='51000000-0000-4000-8000-000000000003';
select is((select owner_id from public.scans where id=(select (data->>'id')::uuid from ctx where name='image')),'51000000-0000-4000-8000-000000000002'::uuid,'source Auth deletion preserves transferred scan');
select is(to_jsonb((select media_expires_at from public.scans where id=(select (data->>'id')::uuid from ctx where name='image'))),(select data from ctx where name='deadline'),'merge does not extend deadline');
select ok((select bool_and(owner_id='51000000-0000-4000-8000-000000000002') from private.scan_images),'inventory follows target despite source-prefixed paths');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','51000000-0000-4000-8000-000000000002','role','authenticated','is_anonymous',false,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
insert into ctx select 'account_delete',to_jsonb(public.request_account_deletion(gen_random_uuid()));
select is((select count(*) from public.scans),0::bigint,'account deletion immediately blocks all scans');
select throws_ok($$select public.create_scan(gen_random_uuid(),'manual','[]')$$,'P0001','ACCOUNT_NOT_ACTIVE','deletion pending denies new work');
reset role;
select ok((select bool_and(privacy_request_id is not null) from private.scan_images),'inventory attached to privacy receipt');
set local role service_role;
select ok(not public.internal_account_scan_cleanup_ready((select (data#>>'{}')::uuid from ctx where name='account_delete')),'unreconciled inventory prevents deletion completion');
select throws_ok($$select public.internal_complete_account_deletion((select (data#>>'{}')::uuid from ctx where name='account_delete'),true,null)$$,'P0001','ACCOUNT_CLEANUP_PENDING','cannot falsely complete privacy request');
insert into ctx select 'cleanup',public.internal_account_scan_cleanup((select (data#>>'{}')::uuid from ctx where name='account_delete'));
select ok(jsonb_array_length((select data from ctx where name='cleanup'))>0,'cleanup resolves old guest paths');
select ok(not public.internal_scan_ack_cleanup((select (data->0->>'imageId')::uuid from ctx where name='cleanup'),gen_random_uuid()),'wrong cleanup lease denied');
select ok(not public.internal_scan_ack_cleanup((select (data->0->>'imageId')::uuid from ctx where name='cleanup'),(select (data->0->>'token')::uuid from ctx where name='cleanup')),'early removal cannot retire a possible late writer');
reset role;
-- Advance only fixture writer deadlines; no production clock override exists.
update private.scan_images set write_deadline=clock_timestamp()-interval '1 second',cleanup_lease_until=null;
set local role service_role;
update ctx set data=public.internal_account_scan_cleanup((select (data#>>'{}')::uuid from ctx where name='account_delete')) where name='cleanup';
select ok(public.internal_scan_ack_cleanup((r->>'imageId')::uuid,(r->>'token')::uuid),'post-deadline deletion can retire inventory') from jsonb_array_elements((select data from ctx where name='cleanup')) r;
select ok(public.internal_account_scan_cleanup_ready((select (data#>>'{}')::uuid from ctx where name='account_delete')),'all registered media cleanup acknowledged');
reset role;
select ok((select bool_and(object_path='deleted/' || id::text and digest is null and byte_size is null and approved_at is null) from private.scan_images),'final cleanup removes paths and image metadata from inventory');
set local role service_role;
select lives_ok($$select public.internal_complete_account_deletion((select (data#>>'{}')::uuid from ctx where name='account_delete'),true,null)$$,'privacy completion allowed only after cleanup');
reset role;
delete from auth.users where id='51000000-0000-4000-8000-000000000002';
select is((select count(*) from private.scan_images),2::bigint,'minimized cleanup inventory survives Auth deletion');
select ok((select bool_and(owner_id is null and scan_id is null and original_scan_id is not null) from private.scan_images),'inventory loses live owner/FK but retains original scan locator');
select * from finish();
rollback;
