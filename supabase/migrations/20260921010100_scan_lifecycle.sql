-- Lock order for scan operations: account_controls, scans, then private work rows.
-- Account merge locks both account controls in UUID order before moving any scans.
create function private.lock_scan_account(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from private.account_controls where user_id = p_owner and status = 'active' for update;
  if not found or exists (select 1 from private.account_merge_tickets
    where source_user_id = p_owner and consumed_at is not null) then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;
end;
$$;

create function private.touch_scan() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.first_uploaded_at is not null and
    (new.first_uploaded_at is distinct from old.first_uploaded_at or new.media_expires_at is distinct from old.media_expires_at)
  then raise exception 'IMMUTABLE_MEDIA_DEADLINE'; end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger scans_touch before update on public.scans for each row execute function private.touch_scan();

create function private.fence_scan(p_scan uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.scan_controls set generation = generation + 1 where scan_id = p_scan;
  update private.scan_upload_authorizations set revoked_at = coalesce(revoked_at, clock_timestamp()) where scan_id = p_scan;
  update private.scan_jobs set state = 'cancelled', lease_token = null, lease_until = null
    where scan_id = p_scan and state in ('pending','running');
  update private.scan_images set delete_requested_at = coalesce(delete_requested_at, clock_timestamp())
    where scan_id = p_scan and kind <> 'retained';
end;
$$;

create function private.delete_scan(p_scan uuid) returns public.scan_deletions
language plpgsql security definer set search_path = '' as $$
declare s public.scans; receipt public.scan_deletions;
begin
  select * into s from public.scans where id = p_scan for update;
  select * into receipt from public.scan_deletions where scan_id = p_scan;
  if receipt.id is not null then return receipt; end if;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  perform private.fence_scan(p_scan);
  update private.scan_images set delete_requested_at = coalesce(delete_requested_at, clock_timestamp()) where scan_id = p_scan;
  update public.scans set deleted_at = clock_timestamp(), state = 'cancelled', ingredients = '[]',
    confirmed_ingredients = null, confirmed_at = null, assessment = null, safe_error_code = null
    where id = p_scan;
  insert into public.scan_deletions(scan_id, owner_id, media_delete_by)
    values(p_scan, s.owner_id, least(coalesce(s.media_expires_at, clock_timestamp() + interval '24 hours'), clock_timestamp() + interval '24 hours'))
    returning * into receipt;
  return receipt;
end;
$$;

create function private.scan_payload_hash(p_payload jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function public.create_scan(p_key uuid, p_source public.scan_source, p_ingredients jsonb default '[]')
returns public.scans language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); op private.scan_operations; s public.scans; h text;
begin
  perform private.lock_scan_account(owner);
  if p_key is null or p_source is null or not private.valid_scan_ingredients(p_ingredients)
    or (p_source <> 'manual' and p_ingredients <> '[]'::jsonb)
    or exists(select 1 from jsonb_array_elements(p_ingredients) r where r->>'provenance' <> 'manual')
  then raise exception 'VALIDATION'; end if;
  h := private.scan_payload_hash(jsonb_build_object('source',p_source,'ingredients',p_ingredients));
  select * into op from private.scan_operations where owner_id = owner and operation = 'create'
    and resource_id = owner and key = p_key;
  if op.key is not null then
    if op.payload_hash <> h then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into s from public.scans where id = op.scan_id and owner_id = owner and deleted_at is null;
    if s.id is null then raise exception 'NOT_FOUND'; end if;
    return s;
  end if;
  insert into public.scans(owner_id,source,state,image_revision,draft_revision,manual_fallback,ingredients)
    values(owner,p_source,case when p_source = 'manual' then 'needs_confirmation'::public.scan_state else 'awaiting_upload'::public.scan_state end,
      case when p_source = 'manual' then 0 else 1 end, case when p_source = 'manual' then 1 else 0 end, p_source = 'manual',p_ingredients)
    returning * into s;
  insert into private.scan_controls(scan_id) values(s.id);
  insert into private.scan_operations(owner_id,operation,resource_id,key,payload_hash,scan_id)
    values(owner,'create',owner,p_key,h,s.id);
  return s;
end;
$$;

-- SQL control API; an HTTP adapter can map these explicit operations to Phase A routes.
-- JSON is accepted only with operation-specific exact keys and bounded ingredient shape.
create function public.mutate_scan(p_scan uuid, p_key uuid, p_operation text, p_body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); s public.scans; op private.scan_operations; h text;
  expected bigint; dr integer; selected_rows jsonb; receipt public.scan_deletions; allowed text[];
begin
  perform private.lock_scan_account(owner);
  if p_key is null or p_scan is null or p_operation is null or p_body is null or jsonb_typeof(p_body) <> 'object'
    then raise exception 'VALIDATION'; end if;
  allowed := case p_operation
    when 'ingredients' then array['expectedVersion','expectedDraftRevision','ingredients']
    when 'confirm' then array['expectedVersion','draftRevision']
    when 'manual' then array['expectedVersion','imageRevision']
    when 'replace' then array['expectedVersion']
    when 'cancel' then array['expectedVersion']
    when 'delete' then array['expectedVersion'] end;
  if allowed is null or not (p_body ?& allowed) or p_body - allowed <> '{}'::jsonb then raise exception 'VALIDATION'; end if;
  expected := (p_body->>'expectedVersion')::bigint;
  if expected is null or expected < 1 then raise exception 'VALIDATION'; end if;
  select * into s from public.scans where id = p_scan and owner_id = owner for update;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if s.deleted_at is not null and p_operation <> 'delete' then raise exception 'NOT_FOUND'; end if;
  h := private.scan_payload_hash(p_body);
  select * into op from private.scan_operations where owner_id = owner and operation = p_operation and resource_id = p_scan and key = p_key;
  if op.key is not null then
    if op.payload_hash <> h then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if p_operation = 'delete' then
      select * into receipt from public.scan_deletions where scan_id = p_scan and owner_id = owner;
      return to_jsonb(receipt);
    end if;
    return to_jsonb(s);
  end if;
  if s.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  if expected <> s.version then raise exception 'VERSION_CONFLICT'; end if;
  if p_operation = 'delete' then
    receipt := private.delete_scan(p_scan);
  else
    if s.state in ('cancelled','expired') then raise exception 'CANCELLED'; end if;
    if p_operation in ('replace','manual') and s.state = 'confirmed' then raise exception 'VERSION_CONFLICT'; end if;
    if p_operation = 'ingredients' then
      dr := (p_body->>'expectedDraftRevision')::integer;
      if dr is null or dr <> s.draft_revision then raise exception 'VERSION_CONFLICT'; end if;
      if s.state not in ('needs_confirmation','confirmed') then raise exception 'VERSION_CONFLICT'; end if;
      if not private.valid_scan_ingredients(p_body->'ingredients') then raise exception 'VALIDATION'; end if;
      -- Clients may preserve a trusted detection reference, but cannot invent one.
      if exists(select 1 from jsonb_array_elements(p_body->'ingredients') r
        where r->'detectionId' <> 'null'::jsonb and not exists(
          select 1 from jsonb_array_elements(s.ingredients) old_row
          where old_row->'id' = r->'id' and old_row->'detectionId' = r->'detectionId'
        )) then raise exception 'VALIDATION'; end if;
      perform private.fence_scan(p_scan);
      update public.scans set ingredients = p_body->'ingredients', draft_revision = draft_revision + 1,
        state = 'needs_confirmation', confirmed_ingredients = null, confirmed_at = null where id = p_scan;
    elsif p_operation = 'confirm' then
      dr := (p_body->>'draftRevision')::integer;
      if dr is null or dr < 1 or dr <> s.draft_revision or s.state <> 'needs_confirmation' then raise exception 'VERSION_CONFLICT'; end if;
      select coalesce(jsonb_agg(r), '[]'::jsonb) into selected_rows from jsonb_array_elements(s.ingredients) r where (r->>'selected')::boolean;
      if jsonb_array_length(selected_rows) = 0 then raise exception 'VALIDATION'; end if;
      if exists(select 1 from jsonb_array_elements(selected_rows) r group by lower(btrim(r->>'displayName')) having count(*) > 1)
        then raise exception 'DUPLICATE_INGREDIENTS'; end if;
      perform private.fence_scan(p_scan);
      update public.scans set state = 'confirmed', confirmed_at = clock_timestamp(), confirmed_ingredients = selected_rows where id = p_scan;
    elsif p_operation = 'manual' then
      if s.source = 'manual' or (p_body->>'imageRevision')::integer is distinct from s.image_revision then raise exception 'VERSION_CONFLICT'; end if;
      perform private.fence_scan(p_scan);
      update public.scans set manual_fallback = true, state = 'needs_confirmation',
        draft_revision = greatest(1,draft_revision), assessment = null, safe_error_code = null,
        sanitization_state = 'cancelled' where id = p_scan;
    elsif p_operation = 'replace' then
      if s.source = 'manual' or s.manual_fallback then raise exception 'VERSION_CONFLICT'; end if;
      if s.media_expires_at <= clock_timestamp() then raise exception 'SCAN_EXPIRED'; end if;
      perform private.fence_scan(p_scan);
      update public.scans set image_revision = image_revision + 1, draft_revision = draft_revision + 1,
        ingredients = '[]', state = 'awaiting_upload', sanitization_state = 'not_started', assessment = null,
        safe_error_code = null where id = p_scan;
    elsif p_operation = 'cancel' then
      if s.state = 'confirmed' then raise exception 'VERSION_CONFLICT'; end if;
      perform private.fence_scan(p_scan);
      update public.scans set state = 'cancelled', assessment = null,
        sanitization_state = case when source = 'manual' then 'not_started'::public.scan_sanitization_state else 'cancelled'::public.scan_sanitization_state end
        where id = p_scan;
    end if;
  end if;
  insert into private.scan_operations(owner_id,operation,resource_id,key,payload_hash,scan_id)
    values(owner,p_operation,p_scan,p_key,h,p_scan);
  if p_operation = 'delete' then return to_jsonb(receipt); end if;
  select * into s from public.scans where id = p_scan;
  return to_jsonb(s);
end;
$$;

revoke all on function private.lock_scan_account(uuid), private.touch_scan(), private.fence_scan(uuid),
  private.delete_scan(uuid), private.scan_payload_hash(jsonb) from public, anon, authenticated;
revoke all on function public.create_scan(uuid,public.scan_source,jsonb), public.mutate_scan(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_scan(uuid,public.scan_source,jsonb), public.mutate_scan(uuid,uuid,text,jsonb) to authenticated;
