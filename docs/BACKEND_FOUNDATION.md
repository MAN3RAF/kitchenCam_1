# Phase 1 Local Backend and Authentication Foundation

Status: implemented for owner review; runtime database/auth validation is blocked on this workstation until a Docker-compatible runtime is available. This milestone creates no remote or production infrastructure and does not close any Phase 0 gate.

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

Only these foundation entities are created. Scans, ingredients, recipes, nutrition, favorites, community, subscriptions, ads, analytics, quotas, and provider payloads remain absent.

## Authentication and account lifecycle

The app explores signed out. It creates an anonymous Supabase user only when a future server-backed action calls `ensureGuestSession`. A six-digit code is the primary email flow. An unclaimed email upgrades the anonymous identity through Supabase email change; an existing permanent account uses a 10-minute random merge token whose SHA-256 hash is stored server-side. The token is issued to the authenticated guest and can be consumed only by an authenticated permanent account. Permanent preferences remain authoritative until the user explicitly chooses guest values in an ambiguous preference review.

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
pnpm db:types
pnpm check
pnpm deps:check
pnpm doctor
pnpm export:check
pnpm backend:stop
```

`db:reset` must recreate the database from zero and replay all migrations. `db:test` runs pgTAP schema/RLS/lifecycle/storage denial tests. The still-open local Auth integration check must exercise anonymous sign-in and Inbucket OTP without external delivery once the stack runs. `db:types` writes only after successful CLI output and the generated file must be reviewed/committed with its migration. CI starts the local stack and requires a clean generated-type diff.

On 2026-09-20, mobile TypeScript, lint, formatting, Jest, and static boundary/security tests pass. The runtime commands above cannot yet execute because this Windows host has no Docker-compatible runtime. Consequently database replay, pgTAP, storage access, live local Auth, database lint, Edge runtime, and generated-type verification remain open and must not be described as passing.

## Still open

- Docker-backed runtime validation and generated database types.
- Remote development Supabase project/region, staging/production projects, production secrets, SMTP, backup/restore, alerts, and named operational owners.
- Google Cloud and Apple Developer credentials plus final iOS/Android identifiers.
- Real-device secure storage, deep-link, OTP, VoiceOver/TalkBack, Android/iOS signed build, and provider sign-in validation.
- Account export, abandoned-anonymous-user cleanup schedule, and an operational retry worker for deletion/merge cleanup.
- Every Phase 0 blocked gate and all later providers/features listed in `ROADMAP.md`.
