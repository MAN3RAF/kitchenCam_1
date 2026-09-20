begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select is(
  (select public from storage.buckets where id = 'scan-raw-private'),
  false,
  'raw scan bucket is private'
);
select is(
  (select public from storage.buckets where id = 'scan-retained-private'),
  false,
  'retained scan bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'scan-raw-private'),
  10485760::bigint,
  'raw bucket has a 10 MiB limit'
);
select ok(
  (select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp'] from storage.buckets where id = 'scan-raw-private'),
  'raw bucket has an explicit image MIME allowlist'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles && array['authenticated'::name]
      and cmd in ('INSERT', 'ALL')
  ),
  0::bigint,
  'authenticated clients have no direct upload policy'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles && array['authenticated'::name]
      and cmd in ('SELECT', 'ALL')
  ),
  0::bigint,
  'authenticated clients have no direct read policy'
);

insert into auth.users (
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
values (
  '30000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  '{"provider":"anonymous","providers":[]}',
  '{}',
  true,
  now(),
  now()
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',
  true
);
select is((select count(*) from storage.objects), 0::bigint, 'client cannot enumerate storage objects');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('scan-raw-private', 'forged/path.jpg', auth.uid()::text)$$,
  '42501',
  null,
  'client cannot forge a direct raw-object upload'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('scan-retained-private', 'forged/path.jpg', auth.uid()::text)$$,
  '42501',
  null,
  'client cannot forge a retained-object upload'
);

select * from finish();
rollback;
