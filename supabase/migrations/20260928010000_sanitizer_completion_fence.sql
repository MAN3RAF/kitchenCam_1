-- Phase F owner-authorized narrow repair. Signature, grants and non-sanitizer paths unchanged.
create or replace function public.internal_scan_finish_job(p_job uuid, p_lease uuid, p_body jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j private.scan_jobs; s public.scans; im private.scan_images; owner uuid; sid uuid; g bigint; err text; raw_image private.scan_images; checked_at timestamptz;
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
    begin
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
    -- Terminal error fencing may itself wait on inventory locks. Preserve retry
    -- semantics, but reject and roll back a sanitizer result that expired there.
    if j.stage = 'sanitize' and clock_timestamp() >= least(j.lease_until,j.deadline,s.media_expires_at) then
      raise exception using errcode = 'ZF001', message = 'SANITIZER_FENCE_EXPIRED';
    end if;
    return true;
    exception when sqlstate 'ZF001' then return false;
    end;
  end if;
  if j.stage = 'sanitize' then
    if not (p_body ?& array['imageId','digest','bytes','width','height','sanitizerVersion'])
      or p_body - array['imageId','digest','bytes','width','height','sanitizerVersion'] <> '{}'::jsonb then raise exception 'VALIDATION'; end if;
    -- Account, scan and job locks above serialize lifecycle/reclaim operations.
    -- Lock BOTH inventory rows before checking time. Cleanup can hold the raw row.
    -- UUID order agrees for every sanitizer attempt; cleanup uses SKIP LOCKED.
    perform 1 from private.scan_images
      where id in (j.image_id, (p_body->>'imageId')::uuid) order by id for update;
    select * into raw_image from private.scan_images where id = j.image_id;
    select * into im from private.scan_images where id = (p_body->>'imageId')::uuid
      and scan_id = sid and kind = 'sanitized';
    checked_at := clock_timestamp();
    -- All mutable authority is protected by the locks held until transaction end.
    -- clock_timestamp observes elapsed time during waits; now() would not.
    if s.id is null or j.id is null or g is null or p_lease is null or j.lease_until is null
      or s.media_expires_at is null or s.deleted_at is not null or s.manual_fallback or s.state <> 'sanitizing'
      or s.media_expires_at <= checked_at or j.generation <> g
      or j.image_revision <> s.image_revision or j.lease_token is distinct from p_lease
      or j.state <> 'running' or j.lease_until <= checked_at or j.deadline <= checked_at
      or raw_image.id is null or raw_image.scan_id is distinct from sid
      or raw_image.generation <> g or raw_image.image_revision <> s.image_revision
      or raw_image.cleaned_at is not null or raw_image.delete_requested_at is not null
      or raw_image.delete_by <= checked_at
      or im.id is null or im.generation <> g or im.image_revision <> s.image_revision
      or im.delete_requested_at is not null or im.cleaned_at is not null
      or im.write_deadline <= checked_at or im.delete_by <= checked_at
      or im.approved_at is not null then return false; end if;
    begin
      update private.scan_images set digest = p_body->>'digest', byte_size = (p_body->>'bytes')::integer,
        width = (p_body->>'width')::integer, height = (p_body->>'height')::integer,
        sanitizer_version = p_body->>'sanitizerVersion', approved_at = checked_at where id = im.id;
      update private.scan_images set delete_requested_at = checked_at where id = j.image_id;
      insert into private.scan_jobs(scan_id,image_id,image_revision,generation,stage,deadline)
        values(sid,im.id,s.image_revision,g,'recognize',least(s.media_expires_at,im.delete_by));
      update public.scans set sanitization_state = 'passed', state = 'queued' where id = sid;
      update private.scan_jobs set state = 'completed', lease_token = null, lease_until = null where id = p_job;
      -- Also fence time spent in writes/triggers/index waits. Raising inside this
      -- subtransaction rolls back ALL tentative approval/queue/cleanup mutations.
      -- No potentially blocking database operation follows the final check.
      if clock_timestamp() >= least(j.lease_until,j.deadline,im.write_deadline,
        im.delete_by,raw_image.delete_by,s.media_expires_at) then
        raise exception using errcode = 'ZF001', message = 'SANITIZER_FENCE_EXPIRED';
      end if;
      return true;
    exception when sqlstate 'ZF001' then return false;
    end;
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
