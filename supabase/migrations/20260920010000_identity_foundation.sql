create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create type public.measurement_system as enum ('metric', 'us');
create type public.onboarding_state as enum ('not_started', 'in_progress', 'completed');
create type public.privacy_request_type as enum ('export', 'delete');
create type public.privacy_request_status as enum ('accepted', 'processing', 'completed', 'failed');
create type public.account_status as enum ('active', 'deletion_pending', 'blocked');
create type private.account_merge_outcome as enum (
  'claimed',
  'review_required',
  'completed',
  'failed'
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'en',
  onboarding_state public.onboarding_state not null default 'not_started',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  constraint profiles_display_name_length check (
    display_name is null or char_length(btrim(display_name)) between 1 and 80
  ),
  constraint profiles_english_mvp_locale check (locale = 'en'),
  constraint profiles_onboarding_completion check (
    (onboarding_state = 'completed' and onboarding_completed_at is not null)
    or (onboarding_state <> 'completed' and onboarding_completed_at is null)
  )
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  measurement_system public.measurement_system not null default 'metric',
  default_servings smallint not null default 2,
  notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  constraint user_preferences_default_servings_range check (default_servings between 1 and 24)
);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  request_type public.privacy_request_type not null,
  status public.privacy_request_status not null default 'accepted',
  requested_at timestamptz not null default now(),
  target_completion_at timestamptz not null,
  completed_at timestamptz,
  safe_error_code text,
  correlation_id uuid not null unique,
  constraint privacy_requests_error_code_length check (
    safe_error_code is null or char_length(safe_error_code) between 1 and 80
  ),
  constraint privacy_requests_completion_state check (
    (status in ('completed', 'failed') and completed_at is not null)
    or (status in ('accepted', 'processing') and completed_at is null)
  )
);

create unique index privacy_requests_one_open_delete_per_user
  on public.privacy_requests (user_id)
  where request_type = 'delete' and status in ('accepted', 'processing');

create table private.account_controls (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status public.account_status not null default 'active',
  deletion_requested_at timestamptz,
  blocked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint account_controls_status_timestamps check (
    (status = 'active' and deletion_requested_at is null and blocked_at is null)
    or (status = 'deletion_pending' and deletion_requested_at is not null and blocked_at is null)
    or (status = 'blocked' and blocked_at is not null)
  )
);

create table private.account_merge_tickets (
  id uuid primary key default gen_random_uuid(),
  source_user_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint account_merge_ticket_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint account_merge_distinct_users check (
    target_user_id is null or source_user_id <> target_user_id
  ),
  constraint account_merge_completion_order check (
    completed_at is null or consumed_at is not null
  )
);

create index account_merge_tickets_source_expiry
  on private.account_merge_tickets (source_user_id, expires_at desc);

create table public.preference_merge_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merge_ticket_id uuid not null unique references private.account_merge_tickets (id) on delete cascade,
  guest_measurement_system public.measurement_system not null,
  guest_default_servings smallint not null,
  guest_notifications_enabled boolean not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  used_guest_values boolean,
  constraint preference_merge_review_resolution check (
    (resolved_at is null and used_guest_values is null)
    or (resolved_at is not null and used_guest_values is not null)
  ),
  constraint preference_merge_review_servings_range check (
    guest_default_servings between 1 and 24
  )
);

create index preference_merge_reviews_user_unresolved
  on public.preference_merge_reviews (user_id, created_at desc)
  where resolved_at is null;

create table private.account_merge_events (
  id uuid primary key default gen_random_uuid(),
  merge_ticket_id uuid references private.account_merge_tickets (id) on delete set null,
  source_user_id uuid references auth.users (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  outcome private.account_merge_outcome not null,
  safe_reason_code text,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  constraint account_merge_reason_length check (
    safe_reason_code is null or char_length(safe_reason_code) between 1 and 80
  )
);

create index account_merge_events_correlation
  on private.account_merge_events (correlation_id, created_at desc);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger user_preferences_touch_updated_at
before update on public.user_preferences
for each row execute function private.touch_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.user_preferences (user_id) values (new.id);
  insert into private.account_controls (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

comment on schema private is 'Server-only KitchenCam state; never expose through the Data API.';
comment on table public.profiles is 'Private user-owned profile data. Email and provider identity remain in Supabase Auth.';
comment on table public.user_preferences is 'Stable MVP preferences only; allergy and nutrition preference schemas are deferred.';
comment on table public.privacy_requests is 'Minimized export/deletion lifecycle record without request payloads or sensitive content.';
comment on table public.preference_merge_reviews is 'Explicit owner review when guest and permanent preferences differ.';

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on type public.measurement_system to authenticated;
grant usage on type public.onboarding_state to authenticated;
grant usage on type public.privacy_request_type to authenticated;
grant usage on type public.privacy_request_status to authenticated;
grant usage on type public.account_status to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, onboarding_state, onboarding_completed_at) on public.profiles to authenticated;
grant select on public.user_preferences to authenticated;
grant update (
  measurement_system,
  default_servings,
  notifications_enabled
) on public.user_preferences to authenticated;
grant select on public.privacy_requests to authenticated;
grant select on public.preference_merge_reviews to authenticated;
