create or replace function private.is_account_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.account_controls
    where user_id = p_user_id and status = 'active'
  );
$$;

create or replace function private.is_permanent_identity()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

revoke all on function private.is_account_active(uuid) from public;
revoke all on function private.is_permanent_identity() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_account_active(uuid) to authenticated;
grant execute on function private.is_permanent_identity() to authenticated;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;
alter table public.privacy_requests enable row level security;
alter table public.privacy_requests force row level security;
alter table public.preference_merge_reviews enable row level security;
alter table public.preference_merge_reviews force row level security;

create policy profiles_owner_select
on public.profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
);

create policy profiles_owner_update
on public.profiles
for update
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
);

create policy user_preferences_owner_select
on public.user_preferences
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
);

create policy user_preferences_owner_update
on public.user_preferences
for update
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
);

create policy privacy_requests_owner_select
on public.privacy_requests
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
);

create policy preference_merge_reviews_owner_select
on public.preference_merge_reviews
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_account_active(auth.uid()))
);
