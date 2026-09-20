begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, aud, role, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', true, '{}', '{}', now(), now()),
  ('40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', false, '{}', '{}', now(), now()),
  ('40000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', true, '{}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$select * from private.account_controls$$, '42501', null, 'clients cannot inspect account controls');
select throws_ok($$select * from private.account_merge_events$$, '42501', null, 'clients cannot inspect merge events');
select throws_ok(
  $$select public.issue_account_merge_ticket(repeat('d', 64), now() + interval '16 minutes')$$,
  'P0001', 'INVALID_MERGE_TICKET', 'ticket lifetime cannot exceed the bound'
);
select lives_ok(
  $$select public.issue_account_merge_ticket(repeat('d', 64), now() + interval '10 minutes')$$,
  'guest can issue an upgrade-race fixture'
);
reset role;
update auth.users set is_anonymous = false where id = '40000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.issue_account_merge_ticket(repeat('e', 64), now() + interval '10 minutes')$$,
  'P0001', 'ANONYMOUS_ACCOUNT_REQUIRED', 'stale guest JWT cannot issue a ticket after upgrade'
);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}', true);
select throws_ok(
  $$select * from public.consume_account_merge_ticket(repeat('d', 64), gen_random_uuid())$$,
  'P0001', 'ANONYMOUS_ACCOUNT_REQUIRED', 'ticket cannot consume an upgraded permanent identity'
);
select throws_ok(
  $$select * from public.consume_account_merge_ticket(repeat('f', 64), gen_random_uuid())$$,
  'P0001', 'MERGE_TICKET_INVALID', 'unknown ticket is denied'
);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
select public.issue_account_merge_ticket(repeat('e', 64), now() + interval '10 minutes');
reset role;
update private.account_merge_tickets set expires_at = now() - interval '1 second' where token_hash = repeat('e', 64);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}', true);
select throws_ok(
  $$select * from public.consume_account_merge_ticket(repeat('e', 64), gen_random_uuid())$$,
  'P0001', 'MERGE_TICKET_INVALID', 'expired ticket is denied'
);
reset role;
update private.account_merge_tickets set expires_at = now() + interval '10 minutes' where token_hash = repeat('e', 64);
set local role authenticated;
select lives_ok(
  $$select * from public.consume_account_merge_ticket(repeat('e', 64), gen_random_uuid())$$,
  'permanent owner can claim a live guest'
);
select lives_ok(
  $$select * from public.consume_account_merge_ticket(repeat('e', 64), gen_random_uuid())$$,
  'same owner can retry an unfinished claim'
);
reset role;
select throws_ok(
  $$update auth.users set is_anonymous = false where id = '40000000-0000-4000-8000-000000000003'$$,
  'P0001', 'MERGE_SOURCE_CLAIMED', 'claimed source cannot upgrade between claim and Auth deletion'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}', true);
select throws_ok(
  $$select public.issue_account_merge_ticket(repeat('f', 64), now() + interval '10 minutes')$$,
  'P0001', 'MERGE_SOURCE_CLAIMED', 'guest cannot replace a ticket after it is claimed'
);
reset role;
select is((select count(*) from private.account_merge_events where source_user_id = '40000000-0000-4000-8000-000000000003'), 1::bigint, 'retry does not duplicate the transfer event');
select * from finish();
rollback;
