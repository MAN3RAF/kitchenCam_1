# KitchenCam Security and Privacy Design

Status: approved MVP engineering baseline; final legal/privacy/nutrition review remains open.

Phase C manual ingredients are untrusted user input. The mobile adapter uses owner-authenticated Phase B RPCs with revision checks and idempotency; direct table mutations remain prohibited. Ingredient text stays out of navigation, analytics, crash metadata, and application logging. Account changes discard temporary scan caches/editors and fence late callbacks; each request can use only the matching account's token. Phase D requests camera access only after an explicit choice, uses a private app-owned local copy for preview, blocks microphone/barcode/broad library permissions, and sends no image to a provider. Image URIs, filenames, metadata, and bytes stay out of telemetry and navigation. See [Phase D](research/SCAN_PHASE_D.md) for the capture boundary and native-device gates.

## Security objectives

- Keep all privileged credentials and provider keys out of application bundles and over-the-air updates.
- Prevent one user from reading or changing another user's scans, preferences, purchases, history, or private media.
- Avoid false reassurance about allergens, nutrition, or food safety.
- Minimize collection and retention of household photos and sensitive dietary information.
- Keep purchases, entitlements, quotas, reviews, and moderation resistant to client tampering and replay.

## Trust boundaries and secrets

The Phase 1 shell enforces a public environment-name allowlist, Zod validation, explicit Expo app-config output, lint restrictions, and a Metro resolver boundary for local server/build-only modules. The local backend adds explicit grants, forced RLS, denial-by-default private storage, JWT-verified Edge Functions, safe correlation IDs, and redacted structured logs. See `ENGINEERING_FOUNDATION.md` and `BACKEND_FOUNDATION.md`. Local RLS/storage/auth evidence is recorded in `BACKEND_VALIDATION.md`; provider integrations remain unimplemented.

The shipped app is untrusted. Decompilation, local storage inspection, proxying, rooted devices, and forged requests are expected. Public identifiers in the app are scoped accordingly.

Server secret stores hold all AI provider keys, including any OpenAI key, plus the Supabase service-role/secret key, USDA and recipe-provider keys, RevenueCat webhook/API secret, moderation credentials, and Sentry source-map token. EAS secret variables are used only at build/release time and never copied into `EXPO_PUBLIC_*`. Rotate by environment, owner, and purpose; audit access; never log values.

The Supabase publishable key is intentionally distributable but grants no authority by itself. Database grants and RLS remain mandatory. Service-role access bypasses RLS and is prohibited in the client.

## Authentication and authorization

- Use lazy Supabase anonymous auth for guest continuity and six-digit email OTP as the primary mobile experience; retain a strict allowlisted magic-link callback. Google and Sign in with Apple remain disabled until credentials and final identifiers are approved.
- Store sessions with platform secure storage and follow refresh/revocation behavior.
- Require recent authentication for account deletion, identity changes, and other destructive account actions.
- Treat anonymous users as `authenticated` with an `is_anonymous` claim; restrictive policies prevent public posting and other abuse-prone operations.
- Guest-to-existing-account linking uses a short-lived, random, hash-at-rest merge ticket bound to both authenticated users. Permanent values win direct conflicts, safe set-like data may be unioned in later schemas, and ambiguous preferences require explicit review. Never merge accounts only because email addresses match.
- Derive object ownership from verified JWT claims. Test grants and RLS for anonymous, authenticated owner, authenticated non-owner, moderator, and service roles.

Apple's review rules make an equivalent privacy-preserving login option relevant when Google login is offered. Supabase supports anonymous users and identity linking, but automatic cleanup is not provided; schedule verified cleanup for abandoned anonymous accounts.

## Image and media privacy

[Phase B validation](research/SCAN_PHASE_B.md) now covers database scan ownership, server-only image paths/digests/authorizations/jobs, immutable approved artifacts, revision and lease fencing, and account lifecycle races. Account deletion checks registered media paths even after a guest merge. Cleanup remains pending until the final possible writer deadline passes and deletion is acknowledged; final inventory records discard paths and image metadata. A scheduled physical cleanup executor and enforceable ingress/worker writer deadlines are still required before uploads can be enabled. Default processing policy is closed, and storage client policies are unchanged.

- Ask camera/gallery permission in context and explain whether server/third-party processing occurs.
- Remove GPS/EXIF, downsize locally, validate magic bytes, MIME, dimensions, and size, and generate unpredictable object names.
- Store scans in private buckets. Use short-lived signed access only for the processing job or owning user.
- Separate scan images, review quarantine, approved public review images, and licensed recipe media into buckets with different policies.
- Do not put photo URLs, ingredients, faces, addresses, barcodes, or raw AI prompts in analytics or crash breadcrumbs.
- Detect and handle non-food/unsupported images; add abuse controls and a process for illegal-content reports.
- Automatically delete raw/transient scan photos within 24 hours of first upload, including failure, cancellation and abandonment; retries do not extend the deadline.
- Store detected ingredients/results, not the original image, in scan history by default. Opt-in image retention creates a separately processed, metadata-free derivative; the raw upload is still deleted.

OpenAI API data is not used for model training by default, but default abuse-monitoring logs may retain content for up to 30 days and image inputs have special retention caveats. The privacy notice must name this processing and legal should assess Modified Abuse Monitoring/Zero Data Retention eligibility ([OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)).

## Food, allergy, and AI safety

- Detected ingredients are suggestions until confirmed by the user.
- Model confidence is not treated as calibrated safety confidence.
- Allergy rules are deterministic hard exclusions; `unknown` never becomes `safe`.
- Substitutions that affect allergens are explicit and require confirmation.
- Preserve provider/source evidence and show estimate/provenance labels.
- Run a versioned AI evaluation set before changing model, prompt, image preprocessing, taxonomy, or schema.
- If AI-generated cooking content is introduced after the MVP, validate it against a curated food-safety rule set; high-risk uncertainty must block generation or ask the user to verify. The MVP does not generate recipes with AI.
- Nutrition and reviews are informational and do not claim diagnosis, treatment, or medical suitability.

## API and infrastructure controls

- TLS only, strict schema validation, payload limits, timeouts, and safe content-type handling.
- Per-user/device/IP rate limits, scan quota reservation, abuse detection, and spend caps.
- Idempotency and replay protection for jobs, purchases, webhooks, votes, and account actions.
- Signature verification for RevenueCat before parsing; least-privilege webhook endpoint.
- Parameterized queries and database functions; no user-controlled SQL or storage path.
- CORS is not a mobile security boundary. Authorization is always enforced server/database side.
- Dependency pinning, lockfile review, vulnerability/license scanning, signed builds, protected production credentials, and two-person production access where feasible.
- Separate dev/staging/prod; synthetic data outside production; backups and restore drills.

## Mobile hardening

Do not rely on obfuscation for secrets. Disable sensitive verbose logs in release builds. Avoid screenshots of purchase/account screens in app-switcher previews where practical. Redact PII from Sentry and disable session replay throughout the MVP. Deep links use an allowlist and validate every parameter.

Root/jailbreak detection may inform risk signals but must not be the sole security boundary or lock out legitimate users without an approved policy.

## Ads, analytics, and consent

- Use Google UMP and request current consent information at launch before requesting ads.
- Provide a persistent privacy-options entry point where required.
- On iOS, request ATT only with clear purpose; denial cannot block core app use.
- Do not use allergy, dietary, photo, recipe history, or nutrition-goal data for ad personalization.
- Analytics uses pseudonymous IDs, an event allowlist, retention limits, and opt-out/consent based on jurisdiction.
- Never send photos, allergies, ingredient lists, tokens, receipts, or sensitive free text to analytics or crash reporting.
- Premium removes all ad requests, not merely visible ad components.
- KitchenCam targets a general 18+ audience and does not target children. Exact launch countries and their consent requirements remain open.

## Privacy rights and retention

Provide accessible privacy/terms links before account creation, processing explanations, consent records, history deletion, data export, and in-app account deletion. Deletion cascades through user tables and storage, revokes sessions, unlinks push tokens, and requests deletion from downstream processors where applicable. Financial/fraud or moderation records retained by law are minimized and documented.

Launch markets determine GDPR/UK GDPR, CCPA/CPRA, Moroccan and other local obligations, international transfer mechanisms, cookie/ad consent, and data residency. A lawyer or qualified privacy professional must review final notices and processor agreements.

## Threat-driven test checklist

- Cross-user read/write attempts for every table, view, function, and storage path.
- Forged/expired JWTs, anonymous claim bypass, insecure direct object references, and privilege escalation.
- Oversized/polyglot/corrupt image uploads, object overwrite, signed URL leakage, and deletion propagation.
- Quota races, duplicate recognition, provider retry storms, and cost-exhaustion attacks.
- Forged/replayed/out-of-order RevenueCat webhooks and client-forged Premium state.
- Review spam, vote brigading, abusive photos/text, mass anonymous accounts, and report abuse.
- Prompt injection in labels/provider content, malformed AI output, unsafe recipe generation, and allergen false negatives.
- PII leakage in logs, analytics, crash reports, push notifications, exports, backups, and support tools.

## Incident readiness

Maintain severity levels, owners, paging, provider contacts, key-rotation playbooks, user-notification/legal assessment, and an audit trail. Alert on error/latency/cost thresholds, entitlement mismatch, elevated auth failures, queue backlog, moderation backlog, and unusual storage egress. Run a tabletop incident and restore exercise before launch.

## Phase A scan review

[The Phase A report](research/SCAN_PHASE_A.md) records local expiry, replay, overwrite, cross-user and deletion findings plus the bounded sanitizer corpus. Private bucket denial passed; service-issued bearer uploads still bypass live user deletion checks. Object deletion is not upload-capability revocation. The owner-approved authenticated bounded ingress must bind authorization to a live owner and revision, consume it atomically, enforce the real ten-minute deadline and byte cap, restrict type and request/body size, support idempotent reconciliation/cleanup, and fence in-flight completion on cancellation/deletion. The SDK two-hour upload capability and direct S3 presigned PUT are excluded as the final security boundary. Sanitizer approval binds immutable bytes/digest, not a mutable object path. These controls and retention workers are requirements, not deployed safeguards.

Metadata removal does not remove visible faces, documents or other sensitive pixels. The UX must disclose processing and permit preview/retake/manual entry; no household uploads are authorized while recognition is unavailable. No real provider received any image in Phase A.
