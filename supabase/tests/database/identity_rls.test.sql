begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    null,
    '{"provider":"anonymous","providers":[]}',
    '{}',
    true,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'owner@example.test',
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    now(),
    now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',
  true
);

select is((select count(*) from public.profiles), 1::bigint, 'anonymous owner sees one profile');
select is(
  (select user_id from public.profiles),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'anonymous owner sees only their profile'
);
select is((select count(*) from public.user_preferences), 1::bigint, 'owner sees one preference row');

update public.profiles set display_name = 'Guest Cook'
where user_id = '10000000-0000-4000-8000-000000000001';
select is(
  (select display_name from public.profiles),
  'Guest Cook',
  'owner can update an allowed profile column'
);

update public.profiles set display_name = 'Not allowed'
where user_id = '10000000-0000-4000-8000-000000000002';
select is(
  (select display_name from public.profiles where user_id = '10000000-0000-4000-8000-000000000002'),
  null,
  'non-owner profile remains invisible and unchanged'
);

select throws_ok(
  $$insert into public.profiles (user_id) values ('10000000-0000-4000-8000-000000000003')$$,
  '42501',
  null,
  'clients cannot insert profiles directly'
);

select throws_ok(
  $$delete from public.user_preferences where user_id = '10000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'clients cannot delete preferences'
);

select ok(private.is_account_active(auth.uid()), 'active owner passes account-state check');
select ok(not private.is_permanent_identity(), 'anonymous JWT is not permanent');

reset role;
update private.account_controls
set status = 'deletion_pending', deletion_requested_at = now()
where user_id = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

select is((select count(*) from public.profiles), 0::bigint, 'deletion-pending profile is inaccessible');
select is((select count(*) from public.user_preferences), 0::bigint, 'deletion-pending preferences are inaccessible');

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',
  true
);
select ok(private.is_permanent_identity(), 'verified JWT is permanent');

select * from finish();
rollback;
