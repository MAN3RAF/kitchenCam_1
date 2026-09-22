-- Validation hardening after first local migration application.
create or replace function private.valid_scan_ingredients(p_rows jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare r jsonb; q jsonb; ids uuid[] := array[]::uuid[]; rid uuid;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return false; end if;
  if jsonb_array_length(p_rows) > 50 then return false; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' or not (r ?& array[
      'id','displayName','normalizedName','canonicalId','selected','quantity','provenance','detectionId'
    ]) or (r - array['id','displayName','normalizedName','canonicalId','selected','quantity','provenance','detectionId']) <> '{}'::jsonb then
      return false;
    end if;
    rid := (r->>'id')::uuid;
    if rid is null or rid = any(ids) then return false; end if;
    ids := array_append(ids, rid);
    if jsonb_typeof(r->'displayName') <> 'string'
      or char_length(btrim(r->>'displayName')) not between 1 and 120
      or r->'normalizedName' <> 'null'::jsonb or r->'canonicalId' <> 'null'::jsonb
      or jsonb_typeof(r->'selected') <> 'boolean'
      or r->>'provenance' not in ('manual','detection','corrected')
      or jsonb_typeof(r->'provenance') <> 'string'
    then return false; end if;
    if r->'detectionId' <> 'null'::jsonb then
      if (r->>'detectionId')::uuid is null or r->>'provenance' = 'manual' then return false; end if;
    elsif r->>'provenance' = 'detection' then return false;
    end if;
    q := r->'quantity';
    if q <> 'null'::jsonb then
      if jsonb_typeof(q) <> 'object' or not (q ?& array['value','unit','estimated'])
        or (q - array['value','unit','estimated']) <> '{}'::jsonb
        or jsonb_typeof(q->'value') <> 'string'
        or (q->>'value') !~ '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,3})?$'
        or (q->>'value')::numeric <= 0
        or jsonb_typeof(q->'unit') <> 'string'
        or q->>'unit' not in ('g','ml','each','clove','slice','can','package','bunch')
        or jsonb_typeof(q->'estimated') <> 'boolean'
      then return false; end if;
    end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Auth row, account controls, scan, work rows: use the same order for admission,
-- direct Auth removal, account deletion and merge. The initial Auth lock also
-- prevents FK checks during scan creation from inverting merge's source lock.
create or replace function private.lock_scan_account(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from auth.users where id = p_owner for key share;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  perform 1 from private.account_controls where user_id = p_owner and status = 'active' for update;
  if not found or exists(select 1 from private.account_merge_tickets where source_user_id=p_owner and consumed_at is not null)
    then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
end;
$$;

alter function public.request_account_deletion(uuid) rename to request_account_deletion_identity;
alter function public.request_account_deletion_identity(uuid) set schema private;
revoke all on function private.request_account_deletion_identity(uuid) from public, anon, authenticated, service_role;
create function public.request_account_deletion(p_correlation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id=auth.uid() for key share;
  return private.request_account_deletion_identity(p_correlation_id);
end;
$$;
revoke all on function public.request_account_deletion(uuid) from public, anon;
grant execute on function public.request_account_deletion(uuid) to authenticated;

alter function public.consume_account_merge_ticket(text,uuid) rename to consume_account_merge_ticket_identity;
alter function public.consume_account_merge_ticket_identity(text,uuid) set schema private;
revoke all on function private.consume_account_merge_ticket_identity(text,uuid) from public, anon, authenticated, service_role;
create function public.consume_account_merge_ticket(p_token_hash text,p_correlation_id uuid)
returns table(source_user_id uuid,preference_review_id uuid,merge_ticket_id uuid)
language plpgsql security definer set search_path = '' as $$
declare source_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select t.source_user_id into source_id from private.account_merge_tickets t where token_hash=p_token_hash;
  -- The underlying function revalidates/locks the ticket and checks current identities.
  perform 1 from auth.users where id in (source_id,auth.uid()) order by id for update;
  return query select * from private.consume_account_merge_ticket_identity(p_token_hash,p_correlation_id);
end;
$$;
revoke all on function public.consume_account_merge_ticket(text,uuid) from public, anon;
grant execute on function public.consume_account_merge_ticket(text,uuid) to authenticated;

create function private.guard_scan_image_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.object_path is distinct from old.object_path or new.bucket_id is distinct from old.bucket_id
    or new.original_scan_id is distinct from old.original_scan_id or new.kind is distinct from old.kind
    or new.image_revision is distinct from old.image_revision or new.generation is distinct from old.generation
    or new.created_at is distinct from old.created_at or new.write_deadline > old.write_deadline
    or new.delete_by > old.delete_by then raise exception 'IMMUTABLE_IMAGE_TARGET'; end if;
  if old.approved_at is not null and
    (new.digest,new.byte_size,new.width,new.height,new.sanitizer_version,new.approved_at)
      is distinct from (old.digest,old.byte_size,old.width,old.height,old.sanitizer_version,old.approved_at)
    then raise exception 'IMMUTABLE_SANITIZER_APPROVAL'; end if;
  return new;
end;
$$;
create trigger scan_image_identity before update on private.scan_images for each row execute function private.guard_scan_image_identity();
revoke all on function private.guard_scan_image_identity() from public,anon,authenticated;
