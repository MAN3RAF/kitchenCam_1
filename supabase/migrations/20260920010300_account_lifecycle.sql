create or replace function public.request_account_deletion(p_correlation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_authenticated_at bigint;
  v_existing_id uuid;
  v_request_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select max(nullif(method ->> 'timestamp', '')::bigint)
  into v_authenticated_at
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as method;

  if v_authenticated_at is null
    or to_timestamp(v_authenticated_at) < now() - interval '10 minutes'
  then
    raise exception using errcode = 'P0001', message = 'RECENT_AUTH_REQUIRED';
  end if;

  perform 1
  from private.account_controls
  where user_id = v_user_id
  for update;

  select id into v_existing_id
  from public.privacy_requests
  where user_id = v_user_id
    and request_type = 'delete'
    and status in ('accepted', 'processing')
  order by requested_at desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  if not private.is_account_active(v_user_id) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_ACTIVE';
  end if;

  update private.account_controls
  set
    status = 'deletion_pending',
    deletion_requested_at = now(),
    blocked_at = null,
    updated_at = now()
  where user_id = v_user_id;

  insert into public.privacy_requests (
    user_id,
    request_type,
    status,
    target_completion_at,
    correlation_id
  )
  values (
    v_user_id,
    'delete',
    'accepted',
    now() + interval '30 days',
    p_correlation_id
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.internal_mark_account_deletion_processing(p_request_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.privacy_requests
  set status = 'processing'
  where id = p_request_id and status = 'accepted';
$$;

create or replace function public.internal_complete_account_deletion(
  p_request_id uuid,
  p_success boolean,
  p_safe_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_safe_error_code is not null and char_length(p_safe_error_code) > 80 then
    raise exception using errcode = 'P0001', message = 'INVALID_SAFE_ERROR_CODE';
  end if;

  update public.privacy_requests
  set
    status = case when p_success then 'completed'::public.privacy_request_status else 'failed'::public.privacy_request_status end,
    completed_at = now(),
    safe_error_code = case when p_success then null else p_safe_error_code end
  where id = p_request_id and status in ('accepted', 'processing');
end;
$$;

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

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false then
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

  delete from private.account_merge_tickets
  where source_user_id = v_user_id and completed_at is null;

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

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = true then
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
    select id into v_review_id
    from public.preference_merge_reviews
    where merge_ticket_id = v_ticket.id;
    return query select null::uuid, v_review_id, v_ticket.id;
    return;
  end if;

  if v_ticket.source_user_id is null then
    if v_ticket.target_user_id = v_target_user_id and v_ticket.consumed_at is not null then
      select id into v_review_id
      from public.preference_merge_reviews
      where merge_ticket_id = v_ticket.id;
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
    on conflict (merge_ticket_id) do nothing;

    select id into v_review_id
    from public.preference_merge_reviews
    where merge_ticket_id = v_ticket.id;
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

create or replace function public.internal_complete_account_merge(
  p_merge_ticket_id uuid,
  p_target_user_id uuid,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.account_merge_tickets
  set completed_at = coalesce(completed_at, now())
  where id = p_merge_ticket_id
    and target_user_id = p_target_user_id
    and consumed_at is not null
    and completed_at is null;

  if found then
    insert into private.account_merge_events (
      merge_ticket_id,
      source_user_id,
      target_user_id,
      outcome,
      correlation_id
    )
    select
      id,
      source_user_id,
      target_user_id,
      'completed'::private.account_merge_outcome,
      p_correlation_id
    from private.account_merge_tickets
    where id = p_merge_ticket_id;
  elsif not exists (
    select 1
    from private.account_merge_tickets
    where id = p_merge_ticket_id
      and target_user_id = p_target_user_id
      and consumed_at is not null
      and completed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'MERGE_COMPLETION_INVALID';
  end if;
end;
$$;

create or replace function public.resolve_preference_merge(
  p_review_id uuid,
  p_use_guest_values boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.preference_merge_reviews%rowtype;
begin
  if v_user_id is null or not private.is_account_active(v_user_id) then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select * into v_review
  from public.preference_merge_reviews
  where id = p_review_id and user_id = v_user_id
  for update;

  if v_review.id is null or v_review.resolved_at is not null then
    raise exception using errcode = 'P0001', message = 'PREFERENCE_REVIEW_UNAVAILABLE';
  end if;

  if p_use_guest_values then
    update public.user_preferences
    set
      measurement_system = v_review.guest_measurement_system,
      default_servings = v_review.guest_default_servings,
      notifications_enabled = v_review.guest_notifications_enabled
    where user_id = v_user_id;
  end if;

  update public.preference_merge_reviews
  set
    resolved_at = now(),
    used_guest_values = p_use_guest_values
  where id = p_review_id;
end;
$$;

revoke all on function public.request_account_deletion(uuid) from public, anon;
revoke all on function public.issue_account_merge_ticket(text, timestamptz) from public, anon;
revoke all on function public.consume_account_merge_ticket(text, uuid) from public, anon;
revoke all on function public.resolve_preference_merge(uuid, boolean) from public, anon;
revoke all on function public.internal_mark_account_deletion_processing(uuid) from public, anon, authenticated;
revoke all on function public.internal_complete_account_deletion(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.internal_complete_account_merge(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.request_account_deletion(uuid) to authenticated;
grant execute on function public.issue_account_merge_ticket(text, timestamptz) to authenticated;
grant execute on function public.consume_account_merge_ticket(text, uuid) to authenticated;
grant execute on function public.resolve_preference_merge(uuid, boolean) to authenticated;
grant execute on function public.internal_mark_account_deletion_processing(uuid) to service_role;
grant execute on function public.internal_complete_account_deletion(uuid, boolean, text) to service_role;
grant execute on function public.internal_complete_account_merge(uuid, uuid, uuid) to service_role;
