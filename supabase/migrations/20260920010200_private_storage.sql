insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'scan-raw-private',
    'scan-raw-private',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'scan-retained-private',
    'scan-retained-private',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Deliberately create no anon/authenticated policies on storage.objects.
-- Raw and retained images are reachable only through narrowly scoped server operations.
-- The future scan milestone must add signed, single-object upload issuance and sanitization
-- before an object can move from the raw bucket to the retained bucket or an AI worker.
