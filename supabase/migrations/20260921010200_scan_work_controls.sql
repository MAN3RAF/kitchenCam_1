-- Service-only control plane for a future authenticated ingress and isolated worker.
-- Every external write must use a pre-registered immutable target. No bytes are handled here.
create function public.internal_scan_upload(
  p_owner uuid, p_scan uuid, p_key uuid, p_operation text, p_body jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.scans; a private.scan_upload_authorizations; im private.scan_images;
  op private.scan_operations; g bigint; h text; deadline timestamptz; t timestamptz;
begin
  perform private.lock_scan_account(p_owner);
  select * into s from public.scans where id = p_scan and owner_id = p_owner and deleted_at is null for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if p_key is null or p_operation is null or p_operation not in ('authorize','claim','complete')
    or p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'VALIDATION'; end if;
  h := private.scan_payload_hash(p_body);
  select * into op from private.scan_operations where owner_id = p_owner and operation = 'upload:' || p_operation
    and resource_id = p_scan and key = p_key;
  if op.key is not null and op.payload_hash <> h then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if s.state in ('cancelled','expired') or s.manual_fallback then raise exception 'CANCELLED'; end if;
  if s.media_expires_at <= clock_timestamp() then raise exception 'SCAN_EXPIRED'; end if;
  select generation into g from private.scan_controls where scan_id = p_scan;
  if p_operation = 'authorize' then
    if not (p_body ?& array['expectedVersion','imageRevision','tokenHash','noticeVersion']) or
      p_body - array['expectedVersion','imageRevision','tokenHash','noticeVersion'] <> '{}'::jsonb then raise exception 'VALIDATION'; end if;
    if op.key is not null then
      select * into a from private.scan_upload_authorizations where scan_id = p_scan and token_hash = p_body->>'tokenHash';
      if a.id is null or a.expires_at <= clock_timestamp() or a.revoked_at is not null or a.claimed_at is not null
        or a.generation <> g then raise exception 'UPLOAD_EXPIRED'; end if;
      return jsonb_build_object('uploadId',a.id,'expiresAt',a.expires_at);
    end if;
    if not exists(select 1 from private.scan_processing_policy where enabled) then raise exception 'RECOGNITION_UNAVAILABLE'; end if;
    if not exists(select 1 from private.scan_processing_policy where notice_version = p_body->>'noticeVersion') then raise exception 'CONSENT_REQUIRED'; end if;
    if (p_body->>'expectedVersion')::bigint is distinct from s.version or (p_body->>'imageRevision')::integer is distinct from s.image_revision
      or s.state <> 'awaiting_upload' then raise exception 'VERSION_CONFLICT'; end if;
    -- An expired authorization can be replaced, never reopened. Fence and retain its target.
    if exists(select 1 from private.scan_upload_authorizations where scan_id = p_scan and revoked_at is null and expires_at > clock_timestamp())
      then raise exception 'VERSION_CONFLICT'; end if;
    perform private.fence_scan(p_scan);
    select generation into g from private.scan_controls where scan_id = p_scan;
    t := clock_timestamp();
    deadline := least(t + interval '600 seconds', coalesce(s.media_expires_at,t + interval '24 hours'));
    insert into private.scan_images(scan_id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,created_at,write_deadline,delete_by)
      values(p_scan,p_scan,p_owner,s.image_revision,g,'raw','scan-raw-private',p_owner::text || '/' || gen_random_uuid()::text,
        t,deadline,coalesce(s.media_expires_at,t + interval '24 hours')) returning * into im;
    insert into private.scan_upload_authorizations(scan_id,image_id,token_hash,generation,image_revision,notice_version,created_at,expires_at)
      values(p_scan,im.id,p_body->>'tokenHash',g,s.image_revision,p_body->>'noticeVersion',t,deadline) returning * into a;
    update public.scans set safe_error_code = null where id = p_scan;
  else
    if not (p_body ?& array['uploadId','tokenHash']) then raise exception 'VALIDATION'; end if;
    select * into a from private.scan_upload_authorizations where id = (p_body->>'uploadId')::uuid and scan_id = p_scan for update;
    if a.id is null or a.token_hash is distinct from p_body->>'tokenHash' then raise exception 'NOT_FOUND'; end if;
    if a.generation <> g or a.image_revision <> s.image_revision or a.revoked_at is not null then raise exception 'UPLOAD_EXPIRED'; end if;
    if op.key is not null and p_operation = 'complete' and a.completed_at is not null then
      return jsonb_build_object('scanId',p_scan,'completed',true);
    end if;
    if a.expires_at <= clock_timestamp() then raise exception 'UPLOAD_EXPIRED'; end if;
    if p_operation = 'claim' then
      if p_body - array['uploadId','tokenHash'] <> '{}'::jsonb then raise exception 'VALIDATION'; end if;
      -- Even same-key replay cannot give a second stream permission to write.
      if a.claimed_at is not null or s.state <> 'awaiting_upload' then raise exception 'UPLOAD_EXPIRED'; end if;
      update private.scan_upload_authorizations set claimed_at = clock_timestamp() where id = a.id;
      t := clock_timestamp();
      update public.scans set first_uploaded_at = coalesce(first_uploaded_at,t),
        media_expires_at = coalesce(media_expires_at,t + interval '24 hours') where id = p_scan;
    else
      if not (p_body ?& array['bytes','width','height','digest','mime'])
        or p_body - array['uploadId','tokenHash','bytes','width','height','digest','mime'] <> '{}'::jsonb
        or p_body->>'mime' is distinct from 'image/jpeg' then raise exception 'VALIDATION'; end if;
      if a.claimed_at is null or a.completed_at is not null or s.state <> 'awaiting_upload' then raise exception 'UPLOAD_INCOMPLETE'; end if;
      update private.scan_images set byte_size = (p_body->>'bytes')::integer, width = (p_body->>'width')::integer,
        height = (p_body->>'height')::integer, digest = p_body->>'digest' where id = a.image_id;
      if (p_body->>'bytes') is null or (p_body->>'width') is null or (p_body->>'height') is null or (p_body->>'digest') is null then raise exception 'VALIDATION'; end if;
      update private.scan_upload_authorizations set completed_at = clock_timestamp() where id = a.id;
      insert into private.scan_jobs(scan_id,image_id,image_revision,generation,stage,deadline)
        values(p_scan,a.image_id,s.image_revision,g,'sanitize',s.media_expires_at);
      update public.scans set state = 'sanitizing', sanitization_state = 'pending' where id = p_scan;
    end if;
  end if;
  insert into private.scan_operations(owner_id,operation,resource_id,key,payload_hash,scan_id)
    values(p_owner,'upload:' || p_operation,p_scan,p_key,h,p_scan);
  if p_operation = 'claim' then
    select * into im from private.scan_images where id = a.image_id;
    return jsonb_build_object('uploadId',a.id,'bucket',im.bucket_id,'path',im.object_path,'writeDeadline',im.write_deadline);
  elsif p_operation = 'authorize' then return jsonb_build_object('uploadId',a.id,'expiresAt',a.expires_at);
  else return jsonb_build_object('scanId',p_scan,'completed',true); end if;
end;
$$;

create function public.internal_scan_claim_job(p_scan uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.scans; j private.scan_jobs; im private.scan_images; target private.scan_images; owner uuid; g bigint; t timestamptz;
begin
  select owner_id into owner from public.scans where id = p_scan;
  perform private.lock_scan_account(owner);
  select * into s from public.scans where id = p_scan and owner_id = owner and deleted_at is null for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if p_stage is null or p_stage not in ('sanitize','recognize') then raise exception 'VALIDATION'; end if;
  if s.manual_fallback or s.media_expires_at <= clock_timestamp() then raise exception 'SCAN_EXPIRED'; end if;
  if p_stage = 'recognize' and not exists(select 1 from private.scan_processing_policy where enabled) then raise exception 'RECOGNITION_UNAVAILABLE'; end if;
  select generation into g from private.scan_controls where scan_id = p_scan;
  select * into j from private.scan_jobs where scan_id = p_scan and generation = g and image_revision = s.image_revision and stage = p_stage for update;
  if j.id is null or j.state not in ('pending','running') or j.attempts >= 3 or j.deadline <= clock_timestamp()
    or (j.state = 'running' and j.lease_until > clock_timestamp()) then raise exception 'JOB_UNAVAILABLE'; end if;
  select * into im from private.scan_images where id = j.image_id;
  if im.cleaned_at is not null or im.delete_requested_at is not null or im.delete_by <= clock_timestamp()
    or (p_stage = 'recognize' and (s.sanitization_state <> 'passed' or im.approved_at is null)) then raise exception 'JOB_UNAVAILABLE'; end if;
  if (p_stage = 'sanitize' and s.state <> 'sanitizing') or (p_stage = 'recognize' and s.state not in ('queued','recognizing')) then raise exception 'JOB_UNAVAILABLE'; end if;
  t := clock_timestamp();
  update private.scan_jobs set state = 'running', attempts = attempts + 1, lease_token = gen_random_uuid(),
    lease_until = least(t + interval '60 seconds',deadline) where id = j.id returning * into j;
  if p_stage = 'sanitize' then
    -- Every attempt has a different output path; even a timed-out child cannot overwrite its successor.
    update private.scan_images set delete_requested_at = coalesce(delete_requested_at,t)
      where scan_id = p_scan and kind = 'sanitized' and approved_at is null;
    insert into private.scan_images(scan_id,original_scan_id,owner_id,image_revision,generation,kind,bucket_id,object_path,created_at,write_deadline,delete_by)
      values(p_scan,p_scan,owner,s.image_revision,g,'sanitized','scan-raw-private',owner::text || '/' || gen_random_uuid()::text,t,j.lease_until,least(s.media_expires_at,im.delete_by)) returning * into target;
    update public.scans set sanitization_state = 'running' where id = p_scan;
  else update public.scans set state = 'recognizing' where id = p_scan;
  end if;
  return jsonb_build_object('jobId',j.id,'leaseToken',j.lease_token,'leaseUntil',j.lease_until,
    'imageRevision',j.image_revision,'generation',g,'input',jsonb_build_object('id',im.id,'bucket',im.bucket_id,'path',im.object_path,'digest',im.digest),
    'output',case when target.id is null then null else jsonb_build_object('id',target.id,'bucket',target.bucket_id,'path',target.object_path) end);
end;
$$;

create function public.internal_scan_finish_job(p_job uuid, p_lease uuid, p_body jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j private.scan_jobs; s public.scans; im private.scan_images; owner uuid; sid uuid; g bigint; err text;
begin
  select scan_id into sid from private.scan_jobs where id = p_job;
  select owner_id into owner from public.scans where id = sid;
  if owner is null then return false; end if;
  perform private.lock_scan_account(owner);
  select * into s from public.scans where id = sid and owner_id = owner for update;
  select * into j from private.scan_jobs where id = p_job for update;
  select generation into g from private.scan_controls where scan_id = sid;
  if s.deleted_at is not null or s.manual_fallback or s.state in ('confirmed','cancelled','expired')
    or j.generation <> g or j.image_revision <> s.image_revision or j.lease_token is distinct from p_lease
    or j.state <> 'running' or j.lease_until <= clock_timestamp() or j.deadline <= clock_timestamp() then return false; end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'VALIDATION'; end if;
  if p_body ? 'error' then
    err := p_body->>'error';
    if p_body - array['error'] <> '{}'::jsonb or err is null or err not in (
      'IMAGE_INVALID','IMAGE_UNSUPPORTED','IMAGE_LIMIT_EXCEEDED','SANITIZER_TIMEOUT','SANITIZER_UNAVAILABLE',
      'PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_INVALID_OUTPUT'
    ) then raise exception 'VALIDATION'; end if;
    if (j.stage = 'sanitize' and err like 'PROVIDER_%') or (j.stage = 'recognize' and err not like 'PROVIDER_%') then raise exception 'VALIDATION'; end if;
    if err in ('SANITIZER_TIMEOUT','SANITIZER_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE') and j.attempts < 3 then
      update private.scan_jobs set state = 'pending', lease_token = null, lease_until = null where id = p_job;
      update public.scans set state = case when j.stage = 'sanitize' then 'sanitizing'::public.scan_state else 'queued'::public.scan_state end,
        sanitization_state = case when j.stage = 'sanitize' then 'pending'::public.scan_sanitization_state else 'passed'::public.scan_sanitization_state end where id = sid;
    else
      update private.scan_jobs set state = 'failed', lease_token = null, lease_until = null where id = p_job;
      perform private.fence_scan(sid);
      update public.scans set state = 'failed', safe_error_code = err,
        sanitization_state = case when j.stage = 'sanitize' then 'failed'::public.scan_sanitization_state else 'passed'::public.scan_sanitization_state end where id = sid;
    end if;
    return true;
  end if;
  if j.stage = 'sanitize' then
    if not (p_body ?& array['imageId','digest','bytes','width','height','sanitizerVersion'])
      or p_body - array['imageId','digest','bytes','width','height','sanitizerVersion'] <> '{}'::jsonb then raise exception 'VALIDATION'; end if;
    select * into im from private.scan_images where id = (p_body->>'imageId')::uuid and scan_id = sid and kind = 'sanitized' for update;
    if im.id is null or im.generation <> g or im.image_revision <> s.image_revision or im.delete_requested_at is not null
      or im.write_deadline <= clock_timestamp() or im.approved_at is not null then return false; end if;
    update private.scan_images set digest = p_body->>'digest', byte_size = (p_body->>'bytes')::integer,
      width = (p_body->>'width')::integer, height = (p_body->>'height')::integer,
      sanitizer_version = p_body->>'sanitizerVersion', approved_at = clock_timestamp() where id = im.id;
    update private.scan_images set delete_requested_at = clock_timestamp() where id = j.image_id;
    insert into private.scan_jobs(scan_id,image_id,image_revision,generation,stage,deadline)
      values(sid,im.id,s.image_revision,g,'recognize',least(s.media_expires_at,im.delete_by));
    update public.scans set sanitization_state = 'passed', state = 'queued' where id = sid;
  else
    if not (p_body ?& array['assessment','ingredients']) or p_body - array['assessment','ingredients'] <> '{}'::jsonb
      or p_body->>'assessment' is null or p_body->>'assessment' not in ('food_detected','no_food','unusable','abstained')
      or not private.valid_scan_ingredients(p_body->'ingredients') then raise exception 'VALIDATION'; end if;
    if (p_body->>'assessment' = 'food_detected') <> (jsonb_array_length(p_body->'ingredients') > 0) then raise exception 'VALIDATION'; end if;
    update public.scans set state = 'needs_confirmation', ingredients = p_body->'ingredients',
      draft_revision = draft_revision + 1, assessment = p_body->>'assessment' where id = sid;
    update private.scan_images set delete_requested_at = coalesce(delete_requested_at,clock_timestamp()) where scan_id = sid and kind <> 'retained';
  end if;
  update private.scan_jobs set state = 'completed', lease_token = null, lease_until = null where id = p_job;
  return true;
end;
$$;

create function public.internal_scan_expire(p_scan uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s public.scans; owner uuid;
begin
  select owner_id into owner from public.scans where id = p_scan;
  if owner is null then return false; end if;
  perform private.lock_scan_account(owner);
  select * into s from public.scans where id = p_scan and owner_id = owner for update;
  if s.deleted_at is not null then return false; end if;
  if s.media_expires_at <= clock_timestamp() then
    perform private.fence_scan(p_scan);
    -- Ingredient history remains usable; expiry of media does not erase confirmed/manual data.
    if s.state not in ('confirmed','needs_confirmation','cancelled','expired') then
      update public.scans set state = 'expired', safe_error_code = 'SCAN_EXPIRED', assessment = null where id = p_scan;
    end if;
    return true;
  end if;
  if exists(select 1 from private.scan_jobs where scan_id = p_scan and state = 'running' and attempts = 3 and lease_until <= clock_timestamp()) then
    perform private.fence_scan(p_scan);
    update public.scans set state = 'failed', safe_error_code = case when s.state = 'sanitizing' then 'SANITIZER_TIMEOUT' else 'PROVIDER_TIMEOUT' end where id = p_scan;
    return true;
  end if;
  return false;
end;
$$;

create function public.internal_scan_claim_cleanup(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION'; end if;
  with candidates as (
    select id from private.scan_images where cleaned_at is null
      and (delete_requested_at is not null or delete_by <= clock_timestamp())
      and (cleanup_lease_until is null or cleanup_lease_until <= clock_timestamp())
      order by delete_by, id for update skip locked limit p_limit
  ), claimed as (
    update private.scan_images i set cleanup_token = gen_random_uuid(), cleanup_lease_until = clock_timestamp() + interval '60 seconds'
    from candidates c where i.id = c.id returning i.*
  ) select coalesce(jsonb_agg(jsonb_build_object('imageId',id,'bucket',bucket_id,'path',object_path,'token',cleanup_token)), '[]') into result from claimed;
  return result;
end;
$$;

create function public.internal_scan_ack_cleanup(p_image uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare im private.scan_images;
begin
  select * into im from private.scan_images where id = p_image for update;
  if im.id is null or im.cleanup_token is distinct from p_token or p_token is null or im.cleanup_lease_until <= clock_timestamp() then return false; end if;
  update private.scan_images set
    cleaned_at = case when write_deadline <= clock_timestamp() then clock_timestamp() else null end,
    cleanup_token = null, cleanup_lease_until = case when write_deadline > clock_timestamp() then write_deadline else null end
    where id = p_image;
  return im.write_deadline <= clock_timestamp();
end;
$$;

create function public.internal_scan_reconcile_deletions() returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.scan_deletions d set completed_at = clock_timestamp() where completed_at is null
    and not exists(select 1 from private.scan_images i where i.original_scan_id = d.scan_id and i.cleaned_at is null);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.internal_scan_upload(uuid,uuid,uuid,text,jsonb),
  public.internal_scan_claim_job(uuid,text), public.internal_scan_finish_job(uuid,uuid,jsonb),
  public.internal_scan_expire(uuid), public.internal_scan_claim_cleanup(integer),
  public.internal_scan_ack_cleanup(uuid,uuid), public.internal_scan_reconcile_deletions() from public, anon, authenticated;
grant execute on function public.internal_scan_upload(uuid,uuid,uuid,text,jsonb),
  public.internal_scan_claim_job(uuid,text), public.internal_scan_finish_job(uuid,uuid,jsonb),
  public.internal_scan_expire(uuid), public.internal_scan_claim_cleanup(integer),
  public.internal_scan_ack_cleanup(uuid,uuid), public.internal_scan_reconcile_deletions() to service_role;
