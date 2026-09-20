-- Runtime validation fixes; preserve the original migration history.

create or replace function public.issue_account_merge_ticket(
  p_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ticket_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  -- Lock the live identity; an older guest JWT cannot authorize an upgraded account.
  perform 1 from auth.users where id = v_user_id and is_anonymous is true for update;
  if not found or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
    raise exception using errcode = 'P0001', message = 'ANONYMOUS_ACCOUNT_REQUIRED';
  end if;

  if not private.is_account_active(v_user_id) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_ACTIVE';
  end if;

  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now() + interval '1 minute'
    or p_expires_at > now() + interval '15 minutes'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_MERGE_TICKET';
  end if;

  if exists (
    select 1 from private.account_merge_tickets
    where source_user_id = v_user_id and consumed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'MERGE_SOURCE_CLAIMED';
  end if;

  delete from private.account_merge_tickets
  where source_user_id = v_user_id and consumed_at is null;

  insert into private.account_merge_tickets (
    source_user_id,
    token_hash,
    expires_at
  )
  values (v_user_id, p_token_hash, p_expires_at)
  returning id into v_ticket_id;

  return v_ticket_id;
end;
$$;

create or replace function public.consume_account_merge_ticket(
  p_token_hash text,
  p_correlation_id uuid
)
returns table (source_user_id uuid, preference_review_id uuid, merge_ticket_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_user_id uuid := auth.uid();
  v_ticket private.account_merge_tickets%rowtype;
  v_guest_preferences public.user_preferences%rowtype;
  v_target_preferences public.user_preferences%rowtype;
  v_review_id uuid;
  v_first_consumption boolean;
begin
  if v_target_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = true
    or not exists (select 1 from auth.users where id = v_target_user_id and is_anonymous is false)
  then
    raise exception using errcode = 'P0001', message = 'PERMANENT_ACCOUNT_REQUIRED';
  end if;

  if not private.is_account_active(v_target_user_id) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_ACTIVE';
  end if;

  select * into v_ticket
  from private.account_merge_tickets
  where token_hash = p_token_hash
    and expires_at > now()
  for update;

  if v_ticket.id is null then
    raise exception using errcode = 'P0001', message = 'MERGE_TICKET_INVALID';
  end if;

  if v_ticket.completed_at is not null then
    if v_ticket.target_user_id <> v_target_user_id then
      raise exception using errcode = 'P0001', message = 'MERGE_TICKET_ALREADY_CLAIMED';
    end if;
    select review.id into v_review_id
    from public.preference_merge_reviews as review
    where review.merge_ticket_id = v_ticket.id;
    return query select null::uuid, v_review_id, v_ticket.id;
    return;
  end if;

  if v_ticket.source_user_id is null then
    if v_ticket.target_user_id = v_target_user_id and v_ticket.consumed_at is not null then
      select review.id into v_review_id
      from public.preference_merge_reviews as review
      where review.merge_ticket_id = v_ticket.id;
      return query select null::uuid, v_review_id, v_ticket.id;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'MERGE_SOURCE_UNAVAILABLE';
  end if;

  if v_ticket.source_user_id = v_target_user_id then
    raise exception using errcode = 'P0001', message = 'MERGE_TARGET_INVALID';
  end if;

  if v_ticket.target_user_id is not null and v_ticket.target_user_id <> v_target_user_id then
    raise exception using errcode = 'P0001', message = 'MERGE_TICKET_ALREADY_CLAIMED';
  end if;

  -- Serialize claim against email upgrade. The trigger below protects the interval
  -- between this transaction and the Edge Function's Auth cleanup.
  perform 1 from auth.users
  where id = v_ticket.source_user_id and is_anonymous is true
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ANONYMOUS_ACCOUNT_REQUIRED';
  end if;

  if not private.is_account_active(v_ticket.source_user_id) then
    raise exception using errcode = 'P0001', message = 'MERGE_SOURCE_NOT_ACTIVE';
  end if;

  v_first_consumption := v_ticket.consumed_at is null;

  update private.account_merge_tickets
  set
    target_user_id = v_target_user_id,
    consumed_at = coalesce(consumed_at, now())
  where id = v_ticket.id;

  select * into v_guest_preferences
  from public.user_preferences
  where user_id = v_ticket.source_user_id;

  select * into v_target_preferences
  from public.user_preferences
  where user_id = v_target_user_id;

  if (
    v_guest_preferences.measurement_system,
    v_guest_preferences.default_servings,
    v_guest_preferences.notifications_enabled
  ) is distinct from (
    v_target_preferences.measurement_system,
    v_target_preferences.default_servings,
    v_target_preferences.notifications_enabled
  ) then
    insert into public.preference_merge_reviews (
      user_id,
      merge_ticket_id,
      guest_measurement_system,
      guest_default_servings,
      guest_notifications_enabled
    )
    values (
      v_target_user_id,
      v_ticket.id,
      v_guest_preferences.measurement_system,
      v_guest_preferences.default_servings,
      v_guest_preferences.notifications_enabled
    )
    on conflict on constraint preference_merge_reviews_merge_ticket_id_key do nothing;

    select review.id into v_review_id
    from public.preference_merge_reviews as review
    where review.merge_ticket_id = v_ticket.id;
  end if;

  if v_first_consumption then
    insert into private.account_merge_events (
      merge_ticket_id,
      source_user_id,
      target_user_id,
      outcome,
      correlation_id
    )
    values (
      v_ticket.id,
      v_ticket.source_user_id,
      v_target_user_id,
      case
        when v_review_id is null then 'claimed'::private.account_merge_outcome
        else 'review_required'::private.account_merge_outcome
      end,
      p_correlation_id
    );
  end if;

  return query select v_ticket.source_user_id, v_review_id, v_ticket.id;
end;
$$;

create or replace function private.guard_claimed_merge_source_upgrade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_anonymous is true and new.is_anonymous is not true
    and exists (
      select 1 from private.account_merge_tickets
      where source_user_id = old.id and consumed_at is not null
    )
  then
    raise exception using errcode = 'P0001', message = 'MERGE_SOURCE_CLAIMED';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_claimed_merge_source_upgrade() from public, anon, authenticated;
create trigger guard_claimed_merge_source_upgrade
before update of is_anonymous on auth.users
for each row execute function private.guard_claimed_merge_source_upgrade();

-- Required for the service's minimized deletion-state inspection and operational retry.
grant select on public.privacy_requests to service_role;
