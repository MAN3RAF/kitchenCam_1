begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_schema('private', 'private server-only schema exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'user_preferences', 'user preferences table exists');
select has_table('public', 'privacy_requests', 'privacy requests table exists');
select has_table('public', 'preference_merge_reviews', 'preference merge reviews table exists');
select has_table('private', 'account_controls', 'account controls table exists');
select has_table('private', 'account_merge_tickets', 'merge tickets table exists');
select has_table('private', 'account_merge_events', 'merge events table exists');
select col_is_pk('public', 'profiles', 'user_id', 'profile user ID is the primary key');
select col_is_pk('public', 'user_preferences', 'user_id', 'preference user ID is the primary key');
select has_fk('public', 'profiles', 'profiles reference Auth users');
select has_fk('public', 'user_preferences', 'preferences reference Auth users');
select has_check('public', 'profiles', 'profiles validate user-facing fields');
select has_check('public', 'user_preferences', 'preferences validate serving range');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles have RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles force RLS for table owners'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_preferences'::regclass),
  'preferences have RLS enabled'
);
select has_function('public', 'request_account_deletion', array['uuid'], 'deletion request function exists');
select has_function(
  'public',
  'consume_account_merge_ticket',
  array['text', 'uuid'],
  'merge consumption function exists'
);
select has_function(
  'public',
  'resolve_preference_merge',
  array['uuid', 'boolean'],
  'preference review resolution function exists'
);

select * from finish();
rollback;
