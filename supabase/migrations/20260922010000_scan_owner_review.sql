-- Independent owner review: prevent a pre-deadline physical sweep from becoming
-- final merely because its acknowledgement arrives after the writer deadline.
-- The token binds the start of the deletion attempt, not just its acknowledgement.
alter table private.scan_images add column cleanup_started_at timestamptz;
-- Invalidate any outstanding old-protocol claims; their paths remain available.
update private.scan_images set cleanup_token = null, cleanup_lease_until = null
  where cleaned_at is null;

-- Supabase default ACLs included these unnecessary non-DML table privileges.
-- Server callers use the explicit SECURITY DEFINER RPCs, including all reads.
revoke all on public.scans, public.scan_deletions from service_role;

create or replace function public.internal_scan_claim_cleanup(p_limit integer default 100)
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
    update private.scan_images i set cleanup_token = gen_random_uuid(), cleanup_started_at = clock_timestamp(), cleanup_lease_until = clock_timestamp() + interval '60 seconds'
    from candidates c where i.id = c.id returning i.*
  ) select coalesce(jsonb_agg(jsonb_build_object('imageId',id,'bucket',bucket_id,'path',object_path,'token',cleanup_token)), '[]') into result from claimed;
  return result;
end;
$$;

create or replace function public.internal_account_scan_cleanup(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.privacy_requests where id = p_request and request_type = 'delete' and status in ('accepted','processing')) then raise exception 'NOT_FOUND'; end if;
  with candidates as (
    select id from private.scan_images where privacy_request_id = p_request and cleaned_at is null
      and (cleanup_lease_until is null or cleanup_lease_until <= clock_timestamp())
      order by delete_by, id for update skip locked limit 100
  ), claimed as (
    update private.scan_images i set cleanup_token = gen_random_uuid(), cleanup_started_at = clock_timestamp(), cleanup_lease_until = clock_timestamp() + interval '60 seconds'
    from candidates c where i.id = c.id returning i.*
  ) select coalesce(jsonb_agg(jsonb_build_object('imageId',id,'bucket',bucket_id,'path',object_path,'token',cleanup_token)), '[]') into result from claimed;
  return result;
end;
$$;

create or replace function public.internal_scan_ack_cleanup(p_image uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare im private.scan_images; retiring boolean;
begin
  select * into im from private.scan_images where id=p_image for update;
  if im.id is null or im.cleanup_token is distinct from p_token or p_token is null or im.cleanup_lease_until <= clock_timestamp() then return false; end if;
  retiring := im.cleanup_started_at is not null and im.cleanup_started_at >= im.write_deadline;
  update private.scan_images set
    cleaned_at = case when retiring then clock_timestamp() else null end,
    object_path = case when retiring then 'deleted/' || id::text else object_path end,
    digest = case when retiring then null else digest end,
    byte_size = case when retiring then null else byte_size end,
    width = case when retiring then null else width end,
    height = case when retiring then null else height end,
    sanitizer_version = case when retiring then null else sanitizer_version end,
    approved_at = case when retiring then null else approved_at end,
    cleanup_token = null, cleanup_started_at = null,
    cleanup_lease_until = case when retiring then null else write_deadline end
    where id=p_image;
  return retiring;
end;
$$;

-- Raw inventory can expire before the scan clock (authorization precedes intake).
-- Bound the actual job and writer lease by that earlier input deadline.
create or replace function public.internal_scan_claim_job(p_scan uuid, p_stage text)
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
    deadline = least(deadline,im.delete_by),
    lease_until = least(t + interval '60 seconds',deadline,im.delete_by) where id = j.id returning * into j;
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
