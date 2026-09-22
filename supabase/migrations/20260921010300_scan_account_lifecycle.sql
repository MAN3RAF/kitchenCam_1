-- Extend existing entry points transactionally, without a second merge/delete API.
create function private.merge_scan_lifecycle() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.scans;
begin
  if old.consumed_at is not null or new.consumed_at is null then return new; end if;
  perform 1 from private.account_controls where user_id in (new.source_user_id,new.target_user_id)
    order by user_id for update;
  if not private.is_account_active(new.source_user_id) or not private.is_account_active(new.target_user_id) then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  for s in select * from public.scans where owner_id = new.source_user_id order by id for update loop
    perform private.fence_scan(s.id);
    update public.scans set owner_id = new.target_user_id,
      state = case when state in ('awaiting_upload','sanitizing','queued','recognizing') then 'failed'::public.scan_state else state end,
      safe_error_code = case when state in ('awaiting_upload','sanitizing','queued','recognizing') then 'RECOGNITION_UNAVAILABLE' else safe_error_code end
      where id = s.id;
  end loop;
  update public.scan_deletions set owner_id = new.target_user_id where owner_id = new.source_user_id;
  update private.scan_images set owner_id = new.target_user_id where owner_id = new.source_user_id;
  -- Keep the source namespace isolated: transferring keys can collide with target keys.
  -- Source records disappear with Auth cleanup; claimed sources cannot replay/create.
  return new;
end;
$$;
create trigger account_merge_scan_transfer before update of consumed_at on private.account_merge_tickets
  for each row execute function private.merge_scan_lifecycle();

create function private.delete_account_scans() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if new.status = 'deletion_pending' and old.status <> 'deletion_pending' then
    for sid in select id from public.scans where owner_id = new.user_id order by id for update loop
      perform private.delete_scan(sid);
    end loop;
    update private.scan_images set delete_requested_at = coalesce(delete_requested_at,clock_timestamp()) where owner_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger account_delete_scan_fence before update of status on private.account_controls
  for each row execute function private.delete_account_scans();

create function private.attach_scan_privacy_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.request_type = 'delete' then
    update private.scan_images set privacy_request_id = new.id where owner_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger privacy_request_scan_inventory after insert on public.privacy_requests
  for each row execute function private.attach_scan_privacy_request();

-- Direct administrative Auth removal must also fence/inventory, including test fixture
-- cleanup. Retained inventory carries no content, credential, provider payload or ingredient.
create function private.auth_delete_scan_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  perform 1 from private.account_controls where user_id = old.id for update;
  for sid in select id from public.scans where owner_id = old.id order by id for update loop
    perform private.delete_scan(sid);
  end loop;
  update private.scan_images set delete_requested_at = coalesce(delete_requested_at,clock_timestamp()) where owner_id = old.id;
  return old;
end;
$$;
create trigger auth_delete_scan_inventory before delete on auth.users
  for each row execute function private.auth_delete_scan_inventory();

create function public.internal_account_scan_cleanup(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.privacy_requests where id = p_request and request_type = 'delete' and status in ('accepted','processing')) then raise exception 'NOT_FOUND'; end if;
  with candidates as (
    select id from private.scan_images where privacy_request_id = p_request and cleaned_at is null
      and (cleanup_lease_until is null or cleanup_lease_until <= clock_timestamp())
      order by delete_by, id for update skip locked limit 100
  ), claimed as (
    update private.scan_images i set cleanup_token = gen_random_uuid(), cleanup_lease_until = clock_timestamp() + interval '60 seconds'
    from candidates c where i.id = c.id returning i.*
  ) select coalesce(jsonb_agg(jsonb_build_object('imageId',id,'bucket',bucket_id,'path',object_path,'token',cleanup_token)), '[]') into result from claimed;
  return result;
end;
$$;

create function public.internal_account_scan_cleanup_ready(p_request uuid) returns boolean
language sql security definer set search_path = '' as $$
  select exists(select 1 from public.privacy_requests where id = p_request and request_type = 'delete')
    and not exists(select 1 from private.scan_images where privacy_request_id = p_request and cleaned_at is null);
$$;

-- Never turn an incomplete late-write cleanup into a successful privacy receipt.
create function private.guard_scan_privacy_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.request_type = 'delete' and new.status = 'completed'
    and not public.internal_account_scan_cleanup_ready(new.id) then raise exception 'ACCOUNT_CLEANUP_PENDING'; end if;
  return new;
end;
$$;
create trigger privacy_request_scan_completion before update of status on public.privacy_requests
  for each row execute function private.guard_scan_privacy_completion();

revoke all on function private.merge_scan_lifecycle(), private.delete_account_scans(),
  private.attach_scan_privacy_request(), private.auth_delete_scan_inventory(), private.guard_scan_privacy_completion(),
  public.internal_account_scan_cleanup(uuid), public.internal_account_scan_cleanup_ready(uuid) from public, anon, authenticated;
grant execute on function public.internal_account_scan_cleanup(uuid), public.internal_account_scan_cleanup_ready(uuid) to service_role;
