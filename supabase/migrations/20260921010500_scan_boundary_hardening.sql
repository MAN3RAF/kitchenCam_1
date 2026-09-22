-- Keep malformed mutation values out of raw PostgreSQL error text.
alter function public.mutate_scan(uuid,uuid,text,jsonb) rename to mutate_scan_validated;
alter function public.mutate_scan_validated(uuid,uuid,text,jsonb) set schema private;
revoke all on function private.mutate_scan_validated(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.mutate_scan(p_scan uuid,p_key uuid,p_operation text,p_body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare field text;
begin
  if p_body is null or octet_length(p_body::text)>65536 then raise exception 'VALIDATION'; end if;
  foreach field in array array['expectedVersion','expectedDraftRevision','imageRevision','draftRevision'] loop
    if p_body ? field and (jsonb_typeof(p_body->field) <> 'number' or (p_body->>field) !~ '^[0-9]+$') then raise exception 'VALIDATION'; end if;
  end loop;
  return private.mutate_scan_validated(p_scan,p_key,p_operation,p_body);
exception when data_exception then raise exception 'VALIDATION';
end;
$$;
revoke all on function public.mutate_scan(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.mutate_scan(uuid,uuid,text,jsonb) to authenticated;

-- After the final possible writer has ended and physical deletion is acknowledged,
-- retain only the cleanup receipt identifiers/times. Remove the path, image digest,
-- dimensions and sanitizer metadata from the surviving inventory row.
create or replace function private.guard_scan_image_identity() returns trigger
language plpgsql set search_path = '' as $$
declare retiring boolean := old.cleaned_at is null and new.cleaned_at is not null;
begin
  if new.bucket_id is distinct from old.bucket_id or new.original_scan_id is distinct from old.original_scan_id
    or new.kind is distinct from old.kind or new.image_revision is distinct from old.image_revision
    or new.generation is distinct from old.generation or new.created_at is distinct from old.created_at
    or new.write_deadline > old.write_deadline or new.delete_by > old.delete_by
    then raise exception 'IMMUTABLE_IMAGE_TARGET'; end if;
  if retiring then
    if new.write_deadline > clock_timestamp() or new.object_path <> 'deleted/' || new.id::text
      or new.digest is not null or new.byte_size is not null or new.width is not null or new.height is not null
      or new.sanitizer_version is not null or new.approved_at is not null then raise exception 'CLEANUP_NOT_FINAL'; end if;
  else
    if new.object_path is distinct from old.object_path then raise exception 'IMMUTABLE_IMAGE_TARGET'; end if;
    if old.approved_at is not null and
      (new.digest,new.byte_size,new.width,new.height,new.sanitizer_version,new.approved_at)
        is distinct from (old.digest,old.byte_size,old.width,old.height,old.sanitizer_version,old.approved_at)
      then raise exception 'IMMUTABLE_SANITIZER_APPROVAL'; end if;
    if old.cleaned_at is not null and (new.cleaned_at is distinct from old.cleaned_at or new.digest is not null
      or new.byte_size is not null or new.width is not null or new.height is not null or new.approved_at is not null
      or new.sanitizer_version is not null) then raise exception 'CLEANUP_NOT_FINAL'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.internal_scan_ack_cleanup(p_image uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare im private.scan_images; retiring boolean;
begin
  select * into im from private.scan_images where id=p_image for update;
  if im.id is null or im.cleanup_token is distinct from p_token or p_token is null or im.cleanup_lease_until <= clock_timestamp() then return false; end if;
  retiring := im.write_deadline <= clock_timestamp();
  update private.scan_images set
    cleaned_at = case when retiring then clock_timestamp() else null end,
    object_path = case when retiring then 'deleted/' || id::text else object_path end,
    digest = case when retiring then null else digest end,
    byte_size = case when retiring then null else byte_size end,
    width = case when retiring then null else width end,
    height = case when retiring then null else height end,
    sanitizer_version = case when retiring then null else sanitizer_version end,
    approved_at = case when retiring then null else approved_at end,
    cleanup_token = null,
    cleanup_lease_until = case when retiring then null else write_deadline end
    where id=p_image;
  return retiring;
end;
$$;
