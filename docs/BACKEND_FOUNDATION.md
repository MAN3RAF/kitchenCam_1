# Phase 1 Local Backend and Authentication Foundation

Status: local backend runtime validation completed on Arch Linux on 2026-09-20; owner review remains required before checkpointing. See [the validation report](BACKEND_VALIDATION.md) for evidence, defects repaired, and remaining gates. No remote or production infrastructure was created, and no Phase 0 gate was closed.

## Scope implemented

- Local Supabase CLI configuration for PostgreSQL 17, Auth, Storage, Inbucket email capture, and Edge Functions.
- Forward-only identity, preference, privacy, RLS, storage, and account-lifecycle migrations.
- Lazy anonymous identity, six-digit email OTP, strict magic-link callback handling, secure native session persistence, and guest-to-account merge.
- Private raw/retained scan buckets as future storage boundaries, with no client read or write policy.
- Immediately irreversible account deletion after explicit UI confirmation and a database-enforced recent-authentication check.
- pgTAP schema, grants, RLS, lifecycle, and storage tests plus static client/server boundary tests.
- Local/CI commands for zero-state replay, database tests/lint, and generated TypeScript types.

Google and Apple providers are disabled. Their credentials, final app identifiers, remote projects, SMTP, production secrets, and operational ownership remain deferred.

## Migration order

1. `20260920010000_identity_foundation.sql` creates public `profiles`, `user_preferences`, `privacy_requests`, and `preference_merge_reviews`; private `account_controls`, `account_merge_tickets`, and `account_merge_events`; constrained enums; lifecycle triggers; and least-privilege grants.
2. `20260920010100_identity_rls.sql` forces RLS on every exposed table. Owners can read/update only their active account rows; privacy and merge reviews are read-only to clients.
3. `20260920010200_private_storage.sql` creates private `scan-raw-private` and `scan-retained-private` buckets with a 10 MiB limit and JPEG/PNG/WebP allowlist. It deliberately grants no client object access.
4. `20260920010300_account_lifecycle.sql` adds recent-auth deletion, merge-ticket issue/consume/complete, explicit preference resolution, and service-only completion functions.
5. `20260920010400_runtime_validation_fixes.sql` resolves ambiguous merge columns, checks live Auth identity when issuing/consuming tickets, serializes source claims against upgrades, prevents replacement or upgrade of a claimed source, and permits service-only inspection of minimized deletion records. Original migrations remain unchanged.

Only these foundation entities are created. Scans, ingredients, recipes, nutrition, favorites, community, subscriptions, ads, analytics, quotas, and provider payloads remain absent.

## Authentication and account lifecycle

The app explores signed out. It creates an anonymous Supabase user only when a future server-backed action calls `ensureGuestSession`. A six-digit code is the primary email flow. An unclaimed email upgrades the anonymous identity through Supabase email change; an existing permanent account uses a 10-minute random merge token whose SHA-256 hash is stored server-side. The token is issued to the authenticated guest and can be consumed only by an authenticated permanent account. The database checks the current Auth identity as well as the JWT; an upgraded source cannot be consumed, and a claimed guest cannot upgrade or replace the ticket during cleanup. Permanent preferences remain authoritative until the user explicitly chooses guest values in an ambiguous preference review.

Email equality alone never authorizes a merge. Merge claim/completion operations are transactionally bound to source and target identities and tolerate bounded retry. The raw token is returned once and retained only as a short-lived pending-auth record in native secure storage (session storage in the non-production web preview), allowing OTP entry or a magic-link app switch to complete the same merge. It is removed after success or expiry.

Deletion requires the user to type `DELETE`, have an authentication-method (`amr`) timestamp within 10 minutes, and invoke the JWT-verified deletion function. Access-token refresh does not count as recent authentication. The database immediately marks the account `deletion_pending`, blocking user data access. Cleanup deletes private objects and the Auth user, then completes a minimized privacy record. There is no cancellation window. A transient cleanup error leaves durable pending state for future operational retry; production retry ownership remains deferred.

## Storage and EXIF boundary

Buckets are private and inaccessible directly to `anon` and `authenticated` roles. No signed upload endpoint is implemented in this milestone. The future scan endpoint must accept only a separately encoded image whose orientation is corrected and EXIF/GPS metadata has been removed before upload, then verify decoded MIME, size, dimensions, ownership, and an unpredictable single-object path server-side. Raw and retained images remain separate; retention is opt-in and must use a metadata-free derivative. This foundation does not claim that the future client preprocessing or 24-hour deletion job exists.

## Secrets and observability

The app accepts only the public Supabase URL and publishable key. Metro, ESLint, static tests, and configuration parsing reject server modules or unapproved public variables. Edge Functions read `SUPABASE_URL`, local legacy anon key, and `SUPABASE_SERVICE_ROLE_KEY` only from their runtime. No secret values are committed.

Function logs use an allowlisted event name, UUID request ID, safe status/code, and duration. They exclude email, tokens, photos, object names, preferences, and request bodies. Provider telemetry is not installed.

## Local validation

Prerequisite: Docker Desktop or a compatible Docker API runtime running locally.

```sh
pnpm backend:start
pnpm db:reset
pnpm db:test
pnpm db:lint
pnpm backend:test
pnpm db:types
pnpm db:types:check
pnpm check
pnpm deps:check
pnpm run doctor
pnpm export:check
pnpm backend:stop
```

`db:reset` recreates the database from zero and replays all five migrations. `db:test` runs 71 pgTAP schema/RLS/lifecycle/storage assertions. `backend:test` runs ten local-only integration tests using real anonymous/permanent sessions, captured six-digit email OTP, Edge Functions, populated private buckets, and account cleanup. Local email confirmation is enabled; the pinned CLI uses Mailpit behind its Inbucket-compatible URL. `db:lint` fails on warnings or errors. `db:types` writes only after successful CLI output; `db:types:check` verifies byte-for-byte schema consistency without writing. CI also requires that the generated file is tracked and unchanged.

After function edits, run `pnpm backend:functions` in another terminal before runtime tests. Deno checks should finish before runtime tests because creating a lockfile triggers the function watcher to restart. Runtime tests use disposable local fixtures and never read remote project credentials. Native secure-store hardware and actual app deep-link handling require device validation.

The former Windows Docker blocker is resolved. Database replay, pgTAP, storage denial, live Auth, Edge Function runtime, database lint, and generated-schema comparison have passed locally. The detailed report records the remaining native/remote gates and the owner-controlled Git checkpoint requirement.

## Still open

- Owner review and checkpoint, including the newly generated database types and Deno dependency lockfile.
- Remote development Supabase project/region, staging/production projects, production secrets, SMTP, backup/restore, alerts, and named operational owners.
- Google Cloud and Apple Developer credentials plus final iOS/Android identifiers.
- Real-device secure storage, deep-link, OTP, VoiceOver/TalkBack, Android/iOS signed build, and provider sign-in validation.
- Account export, abandoned-anonymous-user cleanup schedule, and an operational retry worker for deletion/merge cleanup.
- Every Phase 0 blocked gate and all later providers/features listed in `ROADMAP.md`.
