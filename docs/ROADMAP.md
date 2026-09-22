# KitchenCam Delivery Roadmap

Status: approved MVP planning baseline. The owner authorized the Phase 1 mobile foundation on 2026-09-19 and the local backend/authentication foundation on 2026-09-20. Phase 0 is NOT fully closed; all blocked gates below remain visible and unresolved. The separately approved Camera + Ingredient Scan Journey **Phase A** covers contracts, UX/security review and local runtime spikes only; see [its evidence report](research/SCAN_PHASE_A.md). Owner review approved bounded authenticated ingress, an isolated Node + Sharp/libvips sanitizer with enforceable process/OS limits, and provisional preparation ceilings. Production hosting/runtime selection and native-device validation remain open. Phase B scan schema and lifecycle controls are reviewed and checkpointed. Phase C implements the manual ingredient journey against those contracts; see [the Phase C report](research/SCAN_PHASE_C.md) for validation and remaining device gates. Camera, recognition, recipes, production integrations, and Phase D remain future work.

## Phase 0 - decisions, contracts, and risk spikes

- Investigate recipe/content licensing and pricing without committing to a provider until instructions, images, attribution, caching, and required rights are verified.
- Benchmark suitable server-side vision models on a representative, consented image set for accuracy, latency, reliability, and per-scan cost.
- Validate the Supabase queue/Edge Function path under concurrency, timeout, retry, backgrounding, and p95 latency; document a dedicated-worker migration threshold.
- Measure AI cost per scan, recipe API cost, storage/egress, expected ad revenue, store fees, and RevenueCat cost, then propose sustainable Free/Premium quotas and pricing.
- Define the ingredient taxonomy, deterministic allergen rules, food-safety constraints, USDA/provider nutrition method, and explicit unknown-state behavior.
- Prepare the threat model, privacy data map, processor list, PostHog event allowlist, Sentry scrubbing rules, moderation runbook/kill switch, and retention jobs.
- Determine candidate launch countries and obtain the required legal/privacy/nutrition review plan and production operating budget.
- Prepare low-fidelity flows and accessibility acceptance criteria for the locked navigation and core scan-to-cook journey.

Exit gate: technical spikes have evidence-backed results; a viable recipe licensing path is verified; the seven remaining owner decisions have enough evidence for approval; performance, safety, and spending guardrails are accepted.

### Phase 0 evidence status (2026-09-19)

| Gate | Status | Evidence / remaining work |
|---|---|---|
| AI benchmark method | Design passed | `research/AI_BENCHMARK.md`; benchmark execution and final model remain blocked |
| Recipe provider research | Research passed, selection blocked | `research/RECIPE_PROVIDERS.md`; no public self-serve offer clearly meets all rights, so quotes/contracts and sample evaluation are required |
| Unit economics model | Planning passed, final inputs blocked | `research/UNIT_ECONOMICS.md`; AI invoices, provider quote, beta usage/Ads ARPU, and operating budget remain unknown |
| Supabase AI runtime | Design conditionally passed | `research/AI_RUNTIME_SPIKE.md`; load/fault execution must prove latency, recovery, and resource limits |
| Food data/safety method | Technical design passed | `NUTRITION_METHODOLOGY.md`; qualified legal/nutrition review remains required |
| Threat model | Design passed | `THREAT_MODEL.md`; implementation tests, tabletop, and restore drills remain |
| Launch-market analysis | Strategy comparison passed | `research/LAUNCH_MARKETS.md`; owner country selection and jurisdiction review remain |
| UX foundation | Design passed | `UX_FOUNDATION.md`; clickable prototype and representative-user validation remain |

Phase 1 may prepare repository/tooling foundations after explicit owner approval, but production feature work should not depend on a final AI model. Phase 2 remains blocked by a viable recipe-content contract and empirical AI/runtime results.

## Phase 1 - engineering foundation

Implemented scope: mobile shell, strict TypeScript, Expo Router, semantic UI primitives, public configuration boundaries, local Supabase migrations, identity RLS, private storage denial-by-default, local email/anonymous auth flows, account merge/deletion functions, and CI definitions. See `ENGINEERING_FOUNDATION.md` and `BACKEND_FOUNDATION.md`. No remote Supabase project, production credentials, social provider credentials, or production integrations exist.

Local database replay, pgTAP/RLS/storage tests, local auth integration, database lint, and generated database-type verification passed; see [BACKEND_VALIDATION.md](BACKEND_VALIDATION.md). CI is configured to run them. Native signed builds and hosted CI evidence also remain open.

- Initialize Expo only after owner approval, then establish strict TypeScript, Expo Router, development builds, environments, CI, lint/type/test scripts, and design tokens.
- Create separate remote Supabase development/staging/production projects, production secret ownership, and backup policy only after their deferred owner inputs are available. Local migrations, RLS tests, and private buckets are implemented.
- Complete real-device auth validation plus Google/Apple provider setup after identifiers and provider credentials are approved. Anonymous, email OTP/magic-link, guest merge, and irreversible deletion foundations are implemented locally.
- Establish API contracts, typed errors, request IDs, logging redaction, Sentry, analytics consent, and feature/ad policy configuration.

Exit gate: signed development builds on iOS/Android, CI green, no secrets in bundles, RLS denial tests pass.

## Phase 2 - camera-to-recipe vertical slice

- Camera/gallery/manual entry, local preprocessing, signed upload, durable recognition job, confirmation/editor.
- Ingredient normalization, quotas, retries, deletion schedule, and AI evaluation harness.
- Licensed recipe retrieval, deterministic safety filters/ranking, results, filters, detail, and provenance.
- USDA/provider nutrition calculation with serving scaling and uncertainty.
- Accessible step-by-step cooking and video adapter.

Exit gate: the launch-success journey works on real devices and weak networks; AI/safety/performance budgets pass.

## Phase 3 - identity, retention, and community

- Favorites, collections, history, cook sessions, profile preferences, notification controls.
- Ratings/text reviews, helpful votes, reports, moderation queue, remote community kill switch, and runbook. Review photos remain version 1.1.
- Account export/deletion and downstream media cleanup.

Exit gate: privacy lifecycle and moderation tests pass; abuse limits and support tooling are operational.

## Phase 4 - monetization

- Store products, monthly/annual offering, localized paywall without an initial free trial, RevenueCat anonymous/account identity mapping, signed webhook processing, entitlement mirror, and benchmarked quota policy.
- Restore, manage, upgrade/downgrade, pending, grace period, billing issue, cancellation, expiration, and refund/revocation flows.
- UMP/ATT consent, banners in appropriate non-camera content, clearly labeled native result ads, remote caps, and Premium suppression before any ad request. Interstitial and rewarded ads are excluded from MVP.

Exit gate: Apple/Google sandbox matrices pass, webhook replay tests pass, server rejects forged Premium, and no ad request occurs for Premium or before consent permits.

## Phase 5 - launch hardening

- Accessibility audit, localization readiness, device/OS matrix, performance profiling, offline/stale states, resilience/chaos tests, penetration review.
- Store metadata/privacy labels/data safety, support/incident playbooks, dashboards, alerts, budgets, backups and restore drill.
- Internal testing, TestFlight/Play closed testing, staged rollout, rollback and kill-switch rehearsal.

Exit gate: release checklist signed by product, engineering, design/accessibility, privacy/legal, moderation/support, and finance/monetization owners.

## Version 1.1

Meal planner, consolidated grocery list, personalization, substitutions, review photos, stronger moderation, and potentially licensed Premium offline recipes. Offline recipes remain conditional on explicit content rights. Each feature reuses the approved privacy, safety, and entitlement boundaries.

## Testing strategy

| Layer | Coverage |
|---|---|
| Unit | Normalization, units/nutrition, ranking, allergen exclusion, quotas, entitlement state machine, error mapping |
| Component | Every screen state, Dynamic Type, accessibility roles/names/state, forms, ad placeholders, paywall/restore |
| Database | Migrations, constraints, grants, RLS allow/deny matrix, functions, idempotency, concurrency |
| API/integration | Auth, validation, provider adapters, timeouts/retries, signed uploads, webhook signatures/replay/order |
| AI evaluation | Precision/recall by ingredient/category/condition, unknown handling, unsafe output, model/prompt regression, cost/latency |
| E2E | Guest/account, scan-confirm-search-cook-save, offline/retry, review/report, monthly/annual purchase and restore |
| Manual mobile | Camera permissions, background/resume, weak network, VoiceOver/TalkBack, largest text, reduced motion, store sandboxes |
| Security | OWASP-style API/mobile tests, RLS/storage isolation, secret scan, dependency/license scan, abuse/cost scenarios |

No live ad IDs are used in development/test. Purchase tests cover Apple and Google sandbox accounts, interrupted/deferred/pending flows, expiration, refund, billing retry/grace, reinstall, cross-device restore, anonymous-to-account transition, and webhook delay.

## Analytics and crash reporting

Approved analytics uses PostHog. Recommended MVP events are `scan_started`, `scan_uploaded`, `scan_completed`, `scan_failed`, `ingredient_edited`, `recipe_search_completed`, `recipe_opened`, `recipe_saved`, `cook_started`, `cook_completed`, `review_submitted`, `paywall_viewed`, `purchase_started`, `purchase_completed`, `restore_completed`, and aggregate ad events. `grocery_list_generated` is reserved for version 1.1.

Each event has a documented purpose, owner, properties allowlist, retention, consent basis, and removal date. Never send photos, ingredient names, allergy/diet values, recipe/review free text, precise location, access tokens, or store receipts. Advertising clicks/impressions should primarily use provider reporting rather than duplicate invasive tracking.

Approved crash monitoring uses Sentry. It records release/build/update channel, route, safe state, and correlation ID with PII scrubbing. Session replay is disabled for MVP. Upload source maps using server/build secrets. Define crash-free, ANR, API error, queue delay, recognition latency, provider error, subscription mismatch, ad policy, and cost alerts before rollout.

## Android and iOS deployment

- Use EAS development, preview, staging, and production profiles tied to separate API/backend environments.
- Build native artifacts for camera, ads, RevenueCat, Sentry, and any config-plugin change. Use EAS Update only for compatible JS/assets under store policy and runtime-version controls.
- Sign with organization-owned Apple/Google accounts, least-privilege team access, 2FA, documented recovery, and protected credentials.
- Test through internal/closed tracks, then phased/staged rollout with server feature flags and ad/AI kill switches.
- Maintain store screenshots/copy, privacy nutrition labels/data safety, permission strings, age rating, support URL, privacy policy, terms, account deletion, and subscription metadata.
- Review minimum OS versions from candidate launch-country device data. Test at least one low/mid-tier Android, one small iPhone, and one current device. Phones are the MVP target; portrait is primary and landscape is tested where useful for cooking/video.

## Operational cost gates

Before beta, model cost per successful scan and recipe session using actual image detail/token usage, provider calls, storage/egress, analytics, crash events, expected ad revenue, and support/moderation. Set bounded daily/monthly provider budgets and alerts. Premium price must be evaluated net of store commission, RevenueCat fee, tax, AI usage, content license, infrastructure, and refunds.

The specification's $9.99 monthly and $79.99 annual prices are hypotheses. At 12 monthly payments the annual discount is about 33%; approve it only after unit economics and regional storefront analysis.

## Decisions requiring owner approval

Only these decisions remain open:

1. Exact recipe provider and licensing contract.
2. Final AI vision model after benchmarking.
3. Final Free and Premium scan quotas after unit economics.
4. Final monthly and annual pricing after unit economics; `$9.99/month` and `$79.99/year` remain hypotheses.
5. Exact launch countries.
6. Final legal, privacy, and nutrition review requirements.
7. Production operating budget.
