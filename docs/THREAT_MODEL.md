# KitchenCam Privacy and Security Threat Model

Status: Phase 0 practical threat model; implementation and penetration testing remain pending.  
Checked: 2026-09-19

## Assets and trust boundaries

High-value assets are household photos, identity/session tokens, dietary and allergen preferences, scan history, private storage objects, AI/recipe credentials, quota ledger, reviews/reports, subscription entitlements, webhook secrets, and production telemetry.

Trust boundaries are the untrusted mobile device, public API gateway, Supabase Auth/Data/Storage, privileged Edge Functions/workers, third-party AI/recipe services, RevenueCat/app stores, AdMob/UMP, and PostHog/Sentry. The client is never authoritative for ownership, quota, moderation, or Premium state.

## Threat register

| Area | Practical threats | Required mitigations | Verification |
|---|---|---|---|
| Household photos | EXIF/GPS leak, unintended faces/documents, over-retention, support/log copies | Strip metadata before upload, downsize, contextual consent, private bucket, opaque names, no telemetry, raw deletion within 24h, opt-in sanitized derivative only | EXIF fixtures, deletion audit, log scan, cross-user URL tests |
| Authentication | Token theft, anonymous-account abuse, account-link takeover, magic-link interception | Secure platform storage, short sessions/refresh rotation, verified redirect allowlist, recent auth for destructive actions, server-controlled merge with conflict rules, rate limits | Forged/expired JWT and account-link test matrix |
| API abuse | Credential stuffing, scraping, IDOR, payload bombs, automated cost exhaustion | JWT/RLS, object ownership from claims, schema/size limits, per-user/device/IP controls, spend caps, circuit breakers, pagination caps | Fuzzing, IDOR suite, load/rate-limit tests |
| AI endpoints | Prompt/image injection, malformed output, model data leakage, runaway retries, provider-key theft | Server-only keys, fixed prompts/schema, strict parser, bounded repair/retry, provider timeout, output normalization, no secrets/user profile in prompt, model allowlist | Adversarial image set, malformed JSON, retry and secret scans |
| Signed uploads | Path substitution, overwrite, leaked URL, polyglot/oversized files, abandoned upload | Server-minted owner path, one-use/short expiry, content-length/MIME/magic-byte/dimension validation, no overwrite, post-upload verification, abandoned-object cleanup | Upload corpus, replay/expiry/path tests |
| Storage | Public bucket, RLS/storage-policy bypass, stale copies/backups | Private buckets by purpose, least privilege, owner-prefix policies, service-role isolation, inventory/deletion jobs, documented backup behavior | Policy tests for every role and object path |
| Database/RLS | Cross-tenant reads/writes, unsafe views/functions, service-role leakage | Deny by default, RLS on exposed tables, invoker-safe views, reviewed security-definer functions, server-only protected columns, migration tests | Anonymous/owner/non-owner/moderator/service-role matrix |
| Reviews/community | Spam, harassment, brigading, malicious links, report abuse, no moderation capacity | Verified permanent account, rate limits, text limits/sanitization, one review per recipe, unique votes, moderation queue/audit, remote kill switch | Abuse scenarios, moderator authorization, kill-switch drill |
| Subscriptions | Forged Premium flag, receipt replay, account transfer confusion, restore mismatch | RevenueCat SDK plus signature-verified/idempotent webhook, server entitlement mirror, event ordering, anonymous alias/transfer policy, never trust client boolean | Replay/out-of-order/refund/restore/alias tests |
| Webhooks | Forgery, replay, secret exposure, denial of service | Raw-body signature verification where supported, timestamp/replay window, event-ID uniqueness, store-before-process, isolated endpoint, secret rotation | Recorded fixtures and replay/fuzz tests |
| Quotas/jobs | Race/double charge, failure not refunded, queue duplication, bypass via guest accounts | Atomic reserve/finalize/release ledger, idempotency keys, lease/attempt records, device/IP risk signals, provider/KitchenCam auto-release | Concurrency and forced-failure tests |
| Telemetry | Photos, ingredients, allergies, tokens, receipts, review text, signed URLs, or free text leaked | Event/property allowlist, denylist scrubber, pseudonymous IDs, environment separation, sampling, no session replay, release-log review | Automated payload tests and dashboard sampling |

## Abuse and privacy controls

- Use kill switches for scanning, provider adapters, recipe provider, community writes, ads, and purchasing entry points.
- Default all third-party telemetry and advertising to no request until the applicable consent/entitlement state is known.
- Do not use image recognition for identity or face analysis.
- Treat dietary/allergen preferences as sensitive product data even where a statute does not classify them as health data.
- Provide export, history deletion, account deletion, consent withdrawal, and privacy options without requiring support contact.
- Keep production access least-privileged, MFA-protected, audited, and separate from development/staging.

## Incident priorities

P0 examples are public scan images, cross-account access, leaked provider/service key, entitlement system-wide bypass, or telemetry containing prohibited sensitive payloads. Immediate actions are kill switch, credential rotation, evidence preservation without copying sensitive content, processor contact, legal notification assessment, and user remediation.

Before launch, run a tabletop for image exposure, AI spend attack, compromised moderator, and forged RevenueCat events. Complete a database restore and a separate Storage recovery/export drill because database backups do not automatically cover Storage objects.

## Residual risks

- A photo may contain sensitive material that local metadata stripping cannot recognize.
- AI can omit visible ingredients; mandatory confirmation reduces but does not eliminate risk.
- Provider contracts and cross-border processing terms depend on launch countries.
- Community text creates moderation and legal workload even without review photos.
- Anonymous purchase transfer behavior can surprise users without clear account-link messaging.

These risks require product copy, operational runbooks, and legal review, not only code.

## Sources

- Supabase database backup/storage distinction: https://supabase.com/docs/guides/database/overview
- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits
- RevenueCat pricing/service context: https://www.revenuecat.com/pricing/
- Google AdMob consent requirements: https://support.google.com/admob/answer/7666519
- UK privacy by design guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/
- California CCPA overview: https://www.oag.ca.gov/privacy/ccpa

Sources checked 2026-09-19. This document is engineering analysis, not legal advice.
