begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

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
    '20000000-0000-4000-8000-000000000001',
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
    '20000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'permanent@example.test',
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'other@example.test',
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    now(),
    now()
  );

update public.user_preferences
set measurement_system = 'us', default_servings = 6, notifications_enabled = true
where user_id = '20000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  format(
    '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true,"amr":[{"method":"anonymous","timestamp":%s}]}',
    extract(epoch from now())::bigint
  ),
  true
);

select lives_ok(
  $$select public.issue_account_merge_ticket(
    repeat('a', 64),
    now() + interval '10 minutes'
  )$$,
  'anonymous account can request a bounded merge ticket'
);

select is(
  (select count(*) from private.account_merge_tickets where token_hash = repeat('a', 64)),
  1::bigint,
  'only the ticket hash is persisted'
);

select set_config(
  'request.jwt.claims',
  format(
    '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false,"amr":[{"method":"otp","timestamp":%s}]}',
    extract(epoch from now())::bigint
  ),
  true
);

select lives_ok(
  $$select * from public.consume_account_merge_ticket(
    repeat('a', 64),
    '20000000-0000-4000-8000-000000000010'
  )$$,
  'permanent account can claim the merge ticket'
);

select is(
  (select target_user_id from private.account_merge_tickets where token_hash = repeat('a', 64)),
  '20000000-0000-4000-8000-000000000002'::uuid,
  'ticket is bound to the authenticated permanent account'
);
select is(
  (select count(*) from public.preference_merge_reviews where user_id = '20000000-0000-4000-8000-000000000002'),
  1::bigint,
  'different guest preferences require explicit review'
);
select is(
  (select default_servings from public.user_preferences where user_id = '20000000-0000-4000-8000-000000000002'),
  2::smallint,
  'permanent preferences win before explicit review'
);

select set_config(
  'request.jwt.claims',
  format(
    '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false,"amr":[{"method":"otp","timestamp":%s}]}',
    extract(epoch from now())::bigint
  ),
  true
);
select throws_ok(
  $$select * from public.consume_account_merge_ticket(
    repeat('a', 64),
    '20000000-0000-4000-8000-000000000011'
  )$$,
  'P0001',
  'MERGE_TICKET_ALREADY_CLAIMED',
  'another account cannot steal a claimed merge ticket'
);

select set_config(
  'request.jwt.claims',
  format(
    '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false,"amr":[{"method":"otp","timestamp":%s}]}',
    extract(epoch from now())::bigint
  ),
  true
);
select lives_ok(
  $$select public.resolve_preference_merge(
    (select id from public.preference_merge_reviews where user_id = auth.uid()),
    false
  )$$,
  'owner can explicitly keep permanent preferences'
);
select ok(
  (select resolved_at is not null from public.preference_merge_reviews where user_id = auth.uid()),
  'preference review records an explicit resolution'
);

select set_config(
  'request.jwt.claims',
  format(
    '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false,"amr":[{"method":"otp","timestamp":%s}]}',
    extract(epoch from now() - interval '20 minutes')::bigint
  ),
  true
);
select throws_ok(
  $$select public.request_account_deletion('20000000-0000-4000-8000-000000000020')$$,
  'P0001',
  'RECENT_AUTH_REQUIRED',
  'stale authentication cannot request deletion'
);

select set_config(
  'request.jwt.claims',
  format(
    '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false,"amr":[{"method":"otp","timestamp":%s}]}',
    extract(epoch from now())::bigint
  ),
  true
);
select lives_ok(
  $$select public.request_account_deletion('20000000-0000-4000-8000-000000000021')$$,
  'recently authenticated owner can irreversibly request deletion'
);
select is(
  (select status::text from private.account_controls where user_id = '20000000-0000-4000-8000-000000000003'),
  'deletion_pending',
  'deletion immediately disables the account'
);
select is(
  (select status::text from public.privacy_requests where correlation_id = '20000000-0000-4000-8000-000000000021'),
  'accepted',
  'cleanup can continue asynchronously from a durable request'
);

select * from finish();
rollback;
