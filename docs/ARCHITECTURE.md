# KitchenCam Technical Architecture

Status: approved MVP baseline; seven owner decisions remain open  
Architecture style: feature-oriented mobile client plus a server-mediated backend-for-frontend

## System context

```text
React Native / Expo app
  |-- Supabase Auth (publishable key, user JWT)
  |-- Supabase Data API (narrow RLS-protected user data)
  |-- Supabase Storage (signed/private media access)
  `-- KitchenCam API (all privileged and third-party operations)
          |-- Postgres / Storage / queue
          |-- configurable vision AI provider/model
          |-- licensed recipe provider or owned catalog
          |-- USDA FoodData Central
          |-- RevenueCat webhooks/API
          `-- analytics, crash reporting, moderation tools

App stores <-> RevenueCat SDK/service <-> KitchenCam entitlement mirror
AdMob + UMP -> app, gated by consent and the Premium entitlement
```

The mobile app never receives OpenAI, USDA, recipe-provider, Supabase service-role, RevenueCat secret, webhook, or Sentry source-map credentials. Expo public configuration may contain only identifiers intended for distribution, such as the Supabase URL/publishable key, RevenueCat public SDK key, AdMob application/unit IDs, and Sentry DSN.

## Recommended stack

| Layer | Recommendation |
|---|---|
| Mobile | React Native, Expo development builds, TypeScript strict mode, Expo Router |
| UI | React Native primitives, `StyleSheet` and semantic design tokens, Expo Image, one vector icon family |
| Server state | TanStack Query with controlled persistence and invalidation |
| Local state | Component/reducer state first; Zustand only for cross-route transient workflows such as a scan draft |
| Validation | Zod schemas shared as generated or dependency-free contract packages where practical |
| Backend | Supabase Postgres, Auth, Storage, Realtime only where valuable, and Edge Functions as the BFF |
| Jobs | Durable `scan_jobs` records plus a Supabase queue/Edge Function worker when benchmarks show it is suitable; preserve a dedicated-worker migration path |
| AI | Server-side AI through a provider adapter; benchmark suitable vision models and keep provider/model configurable |
| Recipes | Provider adapter over a contractually licensed API or owned catalog; do not bind domain models to one vendor |
| Nutrition | Recipe-provider values when licensed and attributable; otherwise a versioned USDA FoodData Central calculator |
| Purchases | StoreKit/Google Play Billing through RevenueCat, with signed webhooks and a server entitlement mirror |
| Ads | Google Mobile Ads/AdMob with UMP consent, integrated through a maintained React Native bridge and Expo config plugin |
| Analytics | PostHog for consent-aware product events; no photos, ingredient lists, allergy values, or review text in events |
| Crashes | Sentry for React Native crashes, release health, and performance with PII scrubbing and source maps |
| Testing | Jest/jest-expo, React Native Testing Library, Supabase database tests, API integration tests, Maestro E2E |
| Delivery | EAS Build/Submit/Update with separate development, preview, staging, and production profiles/channels |

## Mobile architecture

The approved Phase 1 mobile foundation is now implemented; see `ENGINEERING_FOUNDATION.md` for the current file tree and route reservations. It has no API consumers or persistence yet, so TanStack Query and Zustand remain deferred until needed. The five mobile tabs use native tabs and native stacks; the web-only layout is a development preview, not a new launch platform.

Expo Router route files should stay thin: route parameters, screen composition, and navigation only. Features own UI, domain types, hooks, validation, and service adapters. Shared components expose explicit variants or compound APIs rather than accumulating behavior flags.

Server state belongs in TanStack Query. Authentication state belongs to the Supabase session provider. Short-lived form and interaction state stays local. A scan draft may use one narrowly scoped provider/store because camera, confirmation, and results span routes. Derived state is computed rather than synchronized through effects.

Long recipe/review/history lists use virtualization, stable item components, cached image dimensions, and `expo-image`. Navigation uses native stacks and platform-correct tabs. Native ads are list item types, not arbitrary overlays. Camera, purchase, and ad SDKs require development builds; Expo Go is insufficient.

## Backend architecture

The approved local identity foundation is implemented in `supabase/`: forward migrations, explicit grants/RLS, private scan buckets with no client object policies, and JWT-verified Edge Functions for merge-ticket issuance, account merge, and account deletion. The mobile client supports lazy anonymous sessions and six-digit email OTP/magic-link callbacks using only a publishable key. Local runtime replay and integration tests passed as recorded in `BACKEND_VALIDATION.md`; no remote project exists. See `BACKEND_FOUNDATION.md`.

[Phase B](research/SCAN_PHASE_B.md) adds owner-safe scan state, constrained drafts/confirmation snapshots, private upload/job/cleanup ledgers, revisioned mutations, lease fencing and transactional scan integration with account merge/deletion. All writes use controlled functions; client table access is read-only. Processing admission remains closed, and these database controls do not deploy ingress, sanitization, recognition, scheduling or mobile scan UI.

The backend has two access paths:

1. The app may use the Supabase client directly for simple user-owned data where grants and RLS fully express authorization, such as reading a user's favorites.
2. All privileged logic, quotas, third-party calls, moderation, subscription processing, recipe ranking, and nutrition calculation go through versioned Edge Function endpoints.

Functions authenticate the bearer JWT, derive the user ID from verified claims, validate input, enforce quotas, and attach a correlation ID. Service-role access exists only in server secrets. Long AI work is represented by a durable job so a dropped mobile connection does not lose state. Start with a Supabase queue/Edge Function worker only if Phase 0 benchmarks validate its runtime, reliability, and p95 latency. The worker claims jobs atomically, uses bounded retries with jitter, and sends failures to a dead-letter state for support/replay. The job contract remains runtime-neutral so long-running work can move to a dedicated worker service later.

Keep normalization, ranking, quota, safety, entitlement, and provider-port logic in testable domain modules rather than embedding it in Supabase-specific handlers.

## Image upload and storage

The [Phase A scan contracts](research/SCAN_CONTRACTS.md) and [runtime/security evidence](research/SCAN_PHASE_A.md) refine this previously unimplemented path. The owner provisionally approved a 25 MiB source / 12 MP full-decode ceiling, upright metadata-free prepared JPEG with a long edge no greater than 2048 px and a 4 MiB byte cap. The existing storage hard ceiling remains unchanged. The 12 MP ceiling is an engineering safety limit, not a permanent product requirement: physical Android/device testing may justify a revision if bounded downsampling safely handles larger images. Native-device validation is not complete.

Create the scan separately from upload authorization. Verify active ownership, notice, limits and processing availability before issuing an upload. Complete-upload verification queues sanitization; recognition can use only immutable sanitizer-approved bytes for the same revision. Provider references, storage paths and upload capabilities stay out of public scan status and navigation.

**Owner-approved architecture:** authenticated bounded upload ingress plus an isolated Node + Sharp/libvips sanitizer worker. Decoding/re-encoding must use enforceable process/OS resource limits. Supabase retains auth, private Storage and durable state; Edge Functions handle appropriate lightweight authentication, admission and coordination, not heavy sanitization. Production hosting/runtime selection remains unresolved; provisioning is not authorized. This changes the original direct-to-Storage upload assumption. The tested SDK mechanism fails the ten-minute expiry requirement; the tested S3 mechanism expires but permits overwrite, including signed conditional requests. Deleting an object does not revoke either upload capability, and both remain usable after Auth deletion. Neither is approved as the product upload mechanism.

Raw/transient media expires within 24 hours of first upload, with earlier cleanup after approval/rejection/cancellation. Jobs must be fenced on account/scan deletion; late writes require a durable cleanup inventory. History stores ingredients/results by default. Explicitly retained photos use separate sanitized derivatives. Review photos remain version 1.1; licensed recipe media follows its separate rights policy. No scan ingress, sanitizer service, storage policy, retention job or AI integration was deployed in Phase A.

## AI ingredient-recognition pipeline

```text
capture -> preprocess -> private upload -> quota/idempotency check
-> vision structured output -> schema validation -> deterministic normalization
-> duplicate grouping -> safety flags -> persisted draft -> user confirmation
```

The structured result contains a canonical candidate, display label, optional location, optional quantity estimate, a `likely` or `uncertain` label, and evidence notes. Do not expose uncalibrated probability percentages. Zod/server validation rejects unknown shapes. A versioned ingredient taxonomy and alias table perform deterministic normalization after AI output. Model, prompt, schema, latency, and token usage are recorded without logging the image or sensitive user attributes.

Confirmed ingredients, not raw detections, feed recipe search. Maintain a consented, de-identified evaluation set across lighting, packaging, occlusion, cuisine, and device quality. Release gates measure precision/recall and allergen-related false reassurance. Provider and model ID are configuration selected after accuracy, latency, and cost benchmarking; neither is hardcoded into domain logic. KitchenCam/provider failures automatically release or refund reserved scan quota.

## Recipe retrieval and ranking

Use a `RecipeProvider` port with search, detail, nutrition, attribution, and caching-rights capabilities. Retrieve provider/owned candidates first, apply hard exclusions deterministically, then score:

```text
score = ingredient coverage
      - missing ingredient penalty
      + time/difficulty/equipment fit
      + preference fit
      + nutrition-goal fit
      + quality signal
```

Allergy conflicts remove a recipe; they are not a negative weight. Unknown allergen status is surfaced as unknown. Allergen filtering is deterministic rather than AI-based. AI may generate a concise match explanation or rerank ties, but the base result remains reproducible. AI-generated recipes are excluded from MVP.

Full instructions, imagery, attribution, and caching require a properly licensed source, making content licensing a launch blocker. Keep the `RecipeProvider` replaceable and do not select a paid provider until licensing and pricing are investigated. Tutorial video is optional and cannot block recipe completion. Offline recipe availability is not promised for MVP.

## Nutrition architecture

Normalize ingredient quantity to grams/milliliters through a versioned unit converter. Map each ingredient to a provider food ID or USDA FDC ID, calculate nutrient totals, retain source IDs and source release, and scale from the recipe yield to the selected serving count. Store an immutable nutrition snapshot with completeness and confidence metadata so historical displays remain reproducible after source updates.

Prefer provider-supplied recipe nutrition when its method and rights are acceptable. Use USDA FoodData Central for transparent ingredient-level fallback. A branded-food match must not silently replace a generic ingredient. Micronutrients with incomplete coverage are omitted or marked incomplete, never treated as zero.

## Search and filtering

Postgres full-text search plus `pg_trgm` handles title, ingredient, and cuisine search for the expected MVP catalog. Structured filters are normalized columns/join tables with B-tree or GIN indexes. Use cursor pagination and a stable tie-breaker. Search results include a match explanation and filter provenance.

Move to Algolia, Typesense, or OpenSearch only after measured relevance/latency or catalog scale justifies another system. The provider adapter protects the app from that migration.

## Favorites, history, reviews, and planning

- Favorites and collection membership are idempotent unique relationships.
- View/cook history is append-only, paginated, user-deletable, and governed by retention settings.
- Ratings, text reviews, helpful votes, and reports require a permanent verified account; one active review per user/recipe is recommended.
- Helpful votes are unique per voter/review. Reports create moderation cases and never auto-delete content solely from count.
- Public review data is separated from private account and dietary data.
- Review photos, Planner, and grocery data use the same ownership/RLS model but remain disabled until version 1.1.
- A remote community kill switch can disable writes and/or public surfaces when operational moderation is unavailable.

## Advertising architecture

An `AdPolicy` service combines consent, age/region restrictions, entitlement, remote placement configuration, session frequency, and current route. Premium always resolves to no ads. UMP consent is refreshed at launch and ads initialize only when `canRequestAds` is true. ATT denial on iOS must leave the app usable with non-personalized/limited ads where allowed.

Allowed MVP placements are banners in appropriate non-camera content and clearly labeled native cards in recipe results. Interstitial and rewarded formats are disabled for MVP. Never request or render ads on camera capture, ingredient confirmation, checkout, active cooking, timers, or safety/allergen warnings. Premium users make no ad requests rather than merely hiding rendered placements.

## Subscription architecture

Create monthly and annual products in one store subscription group and map both to the RevenueCat `premium` entitlement. Do not hardcode final prices; `$9.99/month` and `$79.99/year` remain hypotheses until unit economics are complete. The app fetches offerings and localized prices from RevenueCat/storefront. The RevenueCat SDK handles purchase UI state, but the backend's webhook-derived entitlement mirror is authoritative for server quotas and protected API behavior.

Webhooks are signature-verified, idempotent by event ID, stored before processing, and update subscription and entitlement records transactionally. Model active, future-trial-capable, grace-period, billing-issue, expired, and revoked states, but do not offer a free trial initially. Never infer entitlement from a client boolean or purchase receipt supplied without verification.

Premium MVP benefits are no advertisements, higher scan quotas, and approved Premium filters/features that are actually implemented. Final quotas and pricing remain open. Purchases do not require a KitchenCam account; use RevenueCat-supported anonymous identity/alias/transfer behavior and encourage account linking for cross-device continuity.

### Restore purchases

1. User taps Restore Purchases from Profile or the paywall.
2. App invokes RevenueCat restore and displays an in-progress state.
3. RevenueCat re-queries the store and returns updated customer information.
4. App refreshes the backend entitlement; webhook delivery remains the eventual authority.
5. Show one of: restored and active, no purchases found, signed into a different account, pending store action, or retryable failure.
6. Resolve anonymous-to-account alias/transfer rules explicitly and log support-safe identifiers.

Plan changes and cancellation open the native store management surface. Monthly/annual upgrades and downgrades follow store proration rules; KitchenCam does not invent billing dates.

## Caching and offline strategy

- Persist only a bounded, versioned TanStack Query allowlist: recipe metadata, favorites, confirmed scan summary, and user preferences.
- Store auth tokens in platform secure storage; never place secrets or sensitive health preferences in unencrypted generic storage.
- Cache images with `expo-image` under provider license and user privacy rules.
- Queue idempotent mutations such as favorite toggles; require connectivity for scans, purchases, reviews, reports, and authoritative allergen/nutrition refresh.
- Show stale time and offline status. Do not present stale entitlement, allergen, or nutrition data as freshly verified.
- Offline recipes are not promised in MVP. A version 1.1 implementation requires explicit licensing approval and encrypted app-local storage where practical.

## Error handling

Use typed domain errors with a stable code, safe user message, correlation ID, retryability, and optional field issues. Distinguish validation, authentication, authorization, quota, consent, provider timeout, provider unavailable, moderation, conflict, and internal failures. Retry only idempotent operations, honor `Retry-After`, and use exponential backoff with jitter.

The UI preserves user edits after failures, offers a concrete next action, and never turns an unknown allergy/nutrition state into a positive assertion. Circuit breakers and provider timeouts prevent one dependency from exhausting the API.

## Performance strategy

- Resize photos before upload; use the owner-approved bounded ingress architecture recorded in Phase A.
- Parallelize independent provider/database work; avoid request waterfalls.
- Cache normalized ingredient and recipe-provider lookups within licensing terms.
- Virtualize result/review/history lists and memoize only measured expensive item work.
- Defer analytics, ads, and noncritical SDK initialization until consent and first render permit.
- Use database query plans, indexes, cursor pagination, and payload field selection.
- Track cold start, screen-ready time, upload duration, recognition latency, search latency, image bytes, and JS/native crashes by release.

## Major technology and service assessment

Costs below are planning snapshots checked 2026-09-19 and must be rechecked before procurement.

| Service | Why / where | Advantages | Disadvantages | Alternatives | Expected cost |
|---|---|---|---|---|---|
| React Native + Expo | Client-side app and native build toolchain | One TypeScript codebase, strong camera/update/build ecosystem | Native SDKs require development builds and upgrade discipline | Bare React Native, Flutter, native Swift/Kotlin | Expo SDK/CLI are open source; EAS Free includes limited builds/updates, Starter is $19/month, Production $199/month plus usage ([Expo](https://expo.dev/pricing)) |
| Supabase | Cloud backend plus client SDK for Auth/Data/Storage | Postgres, RLS, auth, storage, functions in one platform | Platform coupling; careful grants/RLS required; storage backups differ from DB | Firebase, AWS Amplify, custom Postgres/API | Free: 50k MAU, 500 MB DB, 1 GB storage; Pro starts $25/month plus overages ([Supabase](https://supabase.com/pricing)) |
| OpenAI API | Server-side image understanding and optional explanations | Strong multimodal structured output; configurable models | Variable cost/latency, non-determinism, retention/vendor considerations | Google Vertex/Gemini, AWS Rekognition plus classifier, self-hosted CV | Usage metered by model and tokens/image detail; no app free tier should be assumed. Benchmark and cap spend ([models/pricing](https://platform.openai.com/docs/models/gpt-4-turbo-and-gpt-4)) |
| Recipe content provider | Server-side recipe search/detail and licensed media | Faster catalog launch, filters and metadata | Licensing, attribution, caching/offline and instruction restrictions | Owned/licensed corpus, Spoonacular, Edamam, FatSecret | Edamam examples range $9/$99/$399 monthly, with material rights differences ([Edamam](https://developer.edamam.com/edamam-recipe-api)); enterprise quote may be needed |
| USDA FoodData Central | Server-side nutrition source | Public-domain/CC0, transparent IDs, broad US data | US bias; mapping/portion ambiguity; not a medical guarantee | Edamam Nutrition, Nutritionix, FatSecret, regional datasets | No fee; key required; default 1,000 requests/hour/IP ([USDA](https://fdc.nal.usda.gov/api-guide/)) |
| RevenueCat | Client SDK and cloud subscription authority | Normalizes stores, entitlements, webhooks, restore behavior | Another billing dependency and revenue-based fee; store setup still required | Direct StoreKit/Play Billing, Adapty, Qonversion | Free to $2,500 monthly tracked revenue, then 1% of tracked revenue; store commissions separate ([RevenueCat](https://www.revenuecat.com/pricing/)) |
| Google AdMob + UMP | Client-side ads and consent, Google ad service | Large demand, native/banner/rewarded support, integrated consent | Privacy/compliance burden, UX/performance risk, revenue volatility | AppLovin MAX, Unity LevelPlay, no ads | No normal upfront SDK fee; business model is ad revenue share. Revenue is not guaranteed; account/policy compliance required |
| PostHog | Client/server product analytics | Event analytics, funnels, flags, transparent usage pricing | Requires consent/data discipline; another data processor | Firebase Analytics, Amplitude, Mixpanel | Free up to 1M events/month, then usage pricing starting $0.00005/event ([PostHog](https://posthog.com/)) |
| Sentry | Client/server crash and performance telemetry | Mature React Native/Expo support, source maps, release health | Can collect PII without scrubbing; quotas/pricing | Firebase Crashlytics, Bugsnag, Expo Observe | Developer $0 with 5k errors; Team $26/month; Business $80/month, plus usage ([Sentry](https://sentry.io/pricing/)) |
| EAS + app stores | Build, signing, submission, OTA channels | Reproducible managed mobile delivery | Native changes still require store build; OTA policy constraints | GitHub Actions/Fastlane/Bitrise | Apple Developer Program $99/year ([Apple](https://developer.apple.com/programs/enroll/)); Google account and regional fees must be verified at enrollment; store commissions apply |
| TanStack Query, Zod, Zustand, Maestro | Client data/cache, validation, narrow state, E2E | Established OSS tools and clear responsibilities | Dependency maintenance and misuse risk | React Context/reducers, RTK Query, Valibot, Detox | Open-source; hosted test infrastructure may add EAS/CI usage cost |

## Folder architecture

This is a proposed future structure, not a request to create it yet.

```text
app/                         # Expo Router route composition only
  (auth)/
  (tabs)/
  scans/
  recipes/
  subscription/
src/
  features/
    auth/
    capture/
    ingredients/
    recipes/
    nutrition/
    cooking/
    favorites/
    community/
    planner/
    monetization/
    profile/
  components/                # cross-feature design-system components
  hooks/                     # truly shared hooks
  lib/                       # configured clients and infrastructure adapters
  navigation/
  state/                     # narrowly shared app state
  theme/                     # tokens, typography, spacing, motion
  types/                     # cross-feature contracts only
  utils/
assets/
supabase/
  functions/
    _shared/
    api/
    revenuecat-webhook/
    scan-worker/
  migrations/
  seed/
  tests/
tests/
  e2e/
  fixtures/
  ai-evals/
docs/
```

Avoid broad barrel exports, business logic in route/screens, provider response types escaping adapters, and one global state store.

## Scope and unresolved decisions

The approved MVP targets English-language Android and iOS phones for a general 18+ audience, portrait-first with landscape where useful for cooking/video. Navigation is Home, Recipes, Saved, Community, and Profile. Planner, grocery lists, review photos, and any licensed offline recipe capability remain version 1.1.

Only these owner decisions remain open: exact recipe provider/licensing contract, final AI vision model, final Free/Premium scan quotas, final monthly/annual pricing, exact launch countries, final legal/privacy/nutrition review requirements, and production operating budget.
