-- Phase B: durable data boundaries. No ingress, decoder, provider or scheduler is installed.
create type public.scan_state as enum (
  'awaiting_upload', 'sanitizing', 'queued', 'recognizing', 'needs_confirmation',
  'confirmed', 'failed', 'cancelled', 'expired'
);
create type public.scan_source as enum ('camera', 'gallery', 'manual');
create type public.scan_sanitization_state as enum (
  'not_started', 'pending', 'running', 'passed', 'rejected', 'failed', 'cancelled'
);

-- Exact public ingredient shape, with no arbitrary provider/storage fields. Taxonomy is
-- not installed: canonical/normalized claims are rejected rather than trusted.
create function private.valid_scan_ingredients(p_rows jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare r jsonb; q jsonb; ids uuid[] := '{}'; rid uuid;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return false; end if;
  if jsonb_array_length(p_rows) > 50 then return false; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' or not (r ?& array[
      'id','displayName','normalizedName','canonicalId','selected','quantity','provenance','detectionId'
    ]) or (r - array['id','displayName','normalizedName','canonicalId','selected','quantity','provenance','detectionId']) <> '{}'::jsonb then
      return false;
    end if;
    rid := (r->>'id')::uuid;
    if rid is null or rid = any(ids) then return false; end if;
    ids := array_append(ids, rid);
    if jsonb_typeof(r->'displayName') <> 'string'
      or char_length(btrim(r->>'displayName')) not between 1 and 120
      or r->'normalizedName' <> 'null'::jsonb or r->'canonicalId' <> 'null'::jsonb
      or jsonb_typeof(r->'selected') <> 'boolean'
      or r->>'provenance' not in ('manual','detection','corrected')
      or jsonb_typeof(r->'provenance') <> 'string'
    then return false; end if;
    if r->'detectionId' <> 'null'::jsonb then
      if (r->>'detectionId')::uuid is null or r->>'provenance' = 'manual' then return false; end if;
    elsif r->>'provenance' = 'detection' then return false;
    end if;
    q := r->'quantity';
    if q <> 'null'::jsonb then
      if jsonb_typeof(q) <> 'object' or not (q ?& array['value','unit','estimated'])
        or (q - array['value','unit','estimated']) <> '{}'::jsonb
        or jsonb_typeof(q->'value') <> 'string'
        or (q->>'value') !~ '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,3})?$'
        or (q->>'value')::numeric <= 0
        or jsonb_typeof(q->'unit') <> 'string'
        or q->>'unit' not in ('g','ml','each','clove','slice','can','package','bunch')
        or jsonb_typeof(q->'estimated') <> 'boolean'
      then return false; end if;
    end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source public.scan_source not null,
  state public.scan_state not null,
  version bigint not null default 1 check (version > 0),
  image_revision integer not null check (image_revision >= 0),
  draft_revision integer not null default 0 check (draft_revision >= 0),
  manual_fallback boolean not null default false,
  sanitization_state public.scan_sanitization_state not null default 'not_started',
  ingredients jsonb not null default '[]' check (private.valid_scan_ingredients(ingredients)),
  confirmed_ingredients jsonb check (confirmed_ingredients is null or private.valid_scan_ingredients(confirmed_ingredients)),
  confirmed_at timestamptz,
  assessment text check (assessment in ('food_detected','no_food','unusable','abstained')),
  safe_error_code text check (safe_error_code in (
    'IMAGE_INVALID','IMAGE_UNSUPPORTED','IMAGE_LIMIT_EXCEEDED','SANITIZER_TIMEOUT',
    'SANITIZER_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE',
    'PROVIDER_INVALID_OUTPUT','RECOGNITION_UNAVAILABLE','SCAN_EXPIRED'
  )),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  first_uploaded_at timestamptz,
  media_expires_at timestamptz,
  deleted_at timestamptz,
  constraint scan_source_revision check (
    (source = 'manual' and image_revision = 0 and manual_fallback and sanitization_state = 'not_started')
    or (source <> 'manual' and image_revision > 0)
  ),
  constraint scan_manual_state check (not manual_fallback or (
    state not in ('awaiting_upload','sanitizing','queued','recognizing') and assessment is null
  )),
  constraint scan_trust_gate check (
    (state not in ('queued','recognizing') and assessment is null) or sanitization_state = 'passed'
  ),
  constraint scan_confirmation check (
    (state = 'confirmed' and confirmed_at is not null and confirmed_ingredients is not null
      and jsonb_array_length(confirmed_ingredients) > 0 and draft_revision > 0)
    or (state <> 'confirmed' and confirmed_at is null and confirmed_ingredients is null)
  ),
  constraint scan_failure_reason check (state <> 'failed' or safe_error_code is not null),
  constraint scan_media_deadline check (
    (first_uploaded_at is null and media_expires_at is null) or
    (first_uploaded_at is not null and media_expires_at is not null
      and media_expires_at = first_uploaded_at + interval '24 hours')
  )
);
create index scans_owner_history on public.scans(owner_id, created_at desc) where deleted_at is null;
create index scans_media_expiry on public.scans(media_expires_at) where deleted_at is null;

create table public.scan_deletions (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique,
  owner_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz not null default clock_timestamp(),
  media_delete_by timestamptz not null,
  completed_at timestamptz
);
create index scan_deletions_owner on public.scan_deletions(owner_id);

create table private.scan_controls (
  scan_id uuid primary key references public.scans(id) on delete cascade,
  generation bigint not null default 1 check (generation > 0)
);

-- This inventory survives scan/Auth deletion. Record a target BEFORE any external
-- write. A cleanup acknowledgment before the final writer deadline cannot retire it.
create table private.scan_images (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid references public.scans(id) on delete set null,
  original_scan_id uuid not null,
  owner_id uuid references auth.users(id) on delete set null,
  privacy_request_id uuid references public.privacy_requests(id),
  image_revision integer not null check (image_revision > 0),
  generation bigint not null,
  kind text not null check (kind in ('raw','sanitized','retained')),
  bucket_id text not null check (bucket_id in ('scan-raw-private','scan-retained-private')),
  object_path text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  write_deadline timestamptz not null,
  delete_by timestamptz not null,
  delete_requested_at timestamptz,
  cleaned_at timestamptz,
  digest text check (digest ~ '^[0-9a-f]{64}$'),
  byte_size integer check (byte_size between 1 and 4194304),
  width integer check (width between 256 and 2048),
  height integer check (height between 256 and 2048),
  sanitizer_version text check (sanitizer_version ~ '^[a-z0-9.-]{1,40}$'),
  approved_at timestamptz,
  cleanup_token uuid,
  cleanup_lease_until timestamptz,
  constraint scan_image_deadlines check (
    write_deadline <= created_at + interval '600 seconds' and delete_by >= write_deadline
    and (kind = 'retained' or delete_by <= created_at + interval '24 hours')
  ),
  constraint scan_image_approval check (approved_at is null or (
    kind in ('sanitized','retained') and digest is not null and byte_size is not null
    and width is not null and height is not null and sanitizer_version is not null
  ))
);
create index scan_images_scan on private.scan_images(scan_id, image_revision);
create index scan_images_original_scan on private.scan_images(original_scan_id);
create index scan_images_privacy_request on private.scan_images(privacy_request_id);
create index scan_images_cleanup on private.scan_images(delete_by, delete_requested_at) where cleaned_at is null;
create index scan_images_owner on private.scan_images(owner_id);

create table private.scan_upload_authorizations (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  image_id uuid not null unique references private.scan_images(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  generation bigint not null,
  image_revision integer not null,
  notice_version text not null check (notice_version ~ '^[a-z0-9.-]{1,40}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '600 seconds'),
  check (completed_at is null or claimed_at is not null)
);
create index scan_uploads_scan on private.scan_upload_authorizations(scan_id);
create unique index scan_uploads_one_live_revision on private.scan_upload_authorizations(scan_id, image_revision)
  where revoked_at is null;

create table private.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  image_id uuid not null references private.scan_images(id),
  image_revision integer not null,
  generation bigint not null,
  stage text not null check (stage in ('sanitize','recognize')),
  state text not null default 'pending' check (state in ('pending','running','completed','cancelled','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_until timestamptz,
  deadline timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(scan_id, image_revision, generation, stage)
);
create index scan_jobs_claim on private.scan_jobs(state, deadline);

create table private.scan_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  resource_id uuid not null,
  key uuid not null,
  payload_hash text not null,
  scan_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id, operation, resource_id, key)
);
create index scan_operations_scan on private.scan_operations(scan_id);

-- Admission stays closed until a future deployed processing stack explicitly opens it.
create table private.scan_processing_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  notice_version text not null default 'phase-a-v1'
);
insert into private.scan_processing_policy default values;

alter table public.scans enable row level security;
alter table public.scans force row level security;
alter table public.scan_deletions enable row level security;
alter table public.scan_deletions force row level security;
revoke all on public.scans, public.scan_deletions from public, anon, authenticated;
grant select on public.scans, public.scan_deletions to authenticated;
create policy scans_owner_read on public.scans for select to authenticated using (
  owner_id = (select auth.uid()) and deleted_at is null and private.is_account_active((select auth.uid()))
);
create policy scan_deletions_owner_read on public.scan_deletions for select to authenticated using (
  owner_id = (select auth.uid()) and private.is_account_active((select auth.uid()))
);
revoke all on private.scan_controls, private.scan_images, private.scan_upload_authorizations,
  private.scan_jobs, private.scan_operations, private.scan_processing_policy from public, anon, authenticated;
revoke all on function private.valid_scan_ingredients(jsonb) from public, anon, authenticated;

comment on table private.scan_images is 'Server-only write/cleanup inventory surviving Auth deletion; never expose paths or digests to clients.';
comment on table public.scans is 'Owner-readable scan state; every write goes through revisioned lifecycle functions.';
