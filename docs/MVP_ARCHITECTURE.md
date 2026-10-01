# KitchenCam simplified MVP: product and architecture

Reviewed: 2026-10-01. Status: owner-requested product reset; the product/architecture review is complete; MVP-1 is authorized after the documentation checkpoint is pushed. **The old Phase G plan is stopped.** This document is the current product authority, replacing the previous broad MVP and Phase G sequence. The subsequent owner instruction authorizes a documentation-only checkpoint and push, then MVP-1. Backend/accounting, AI and ad implementation remain deferred.

## Status vocabulary and precedence

- **ACTIVE MVP**: included in the new product scope; does not mean implemented.
- **PRESERVED INTERNAL INFRASTRUCTURE**: retain working code and security guarantees; expose only what the simple journey needs.
- **DEFERRED**: excluded from this MVP or from this review's implementation scope.
- **FUTURE**: optional extension after the MVP, requiring a separate decision.
- **OWNER DECISION**: proposal or launch input requiring review, not a silent permanent default.

This document and the revised [roadmap](ROADMAP.md) take precedence over older planning, research, route reservations, and skill descriptions concerning product scope. Dated Phase A–F and Android reports remain evidence for their recorded scope, not authorization to resume their old next phase. In particular, historical claims that AI-generated recipes or rewarded ads are excluded, subscriptions are required, or five tabs are locked no longer describe the MVP. Security invariants remain applicable.

## Product scope — ACTIVE MVP

Home offers **Take a Photo** and **Enter Ingredients Manually**. Gallery remains a secondary option within the photo flow. Either input leads to **Generate Recipe → one Recipe Result**. No account creation is required: lazily establish or restore the existing anonymous backend session.

The result contains provided/detected ingredients, one dish name, a short description, optional missing ingredients, estimated total preparation/cooking minutes, ordered steps, and a YouTube search action. No nutrition, ratings, browsing feed, profile, or save requirement. A dish image is **FUTURE**; use a quiet visual placeholder or omit the visual, never pretend an unrelated image is the generated dish.

One banner placement and voluntary rewarded ads are the intended monetization model. Their SDK implementation is **DEFERRED** in this review, as are all live AI calls. No subscriptions, premium plans, paywall, or RevenueCat integration.

## Current repository audit

The working tree was already dirty when this review began. Its Phase G upload edits are preserved byte-for-byte and are **stopped, unvalidated work in progress**, not newly approved infrastructure. This checkpoint changes documentation only; existing tabs remain at runtime. The 28 Phase G files have since been isolated on local branch `archive/stopped-phase-g-20261001`, preserving stash snapshot `6a79e503988fe1655df6a79288c83bae2c9e6e49` and its untracked-file parent. They are excluded from main.

| Area and current evidence                                                                                                                                               | Disposition                                             | Migration action                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app/_layout.tsx`, `app/(tabs)/`, `src/navigation/app-tabs*`, `src/constants/navigation.ts`: five-tab shell                                                             | Simplify — ACTIVE MVP                                   | Replace active tab composition with a native stack; preserve route compatibility deliberately                                       |
| `src/features/home/home-screen.tsx`: Add ingredients and Browse recipes                                                                                                 | Simplify — ACTIVE MVP                                   | Two primary entry actions and simple usage wording; remove browsing link                                                            |
| `src/features/capture/`, `modules/kitchencam-image/`: camera/gallery, preview, local preparation and cleanup                                                            | Keep — ACTIVE MVP                                       | Reuse acquisition, file lifetime, bounded preparation and manual fallback                                                           |
| Android launcher patch and camera size/acquisition fixes; [device evidence](ANDROID_DEVICE_TESTING.md)                                                                  | Keep — PRESERVED INTERNAL INFRASTRUCTURE                | Do not rebuild or replace these as part of navigation changes without relevant device checks                                        |
| `src/features/scans/`: real persisted manual drafts, editing, selection, confirmation, Ready and history                                                                | Simplify — ACTIVE MVP; retain internals                 | Reuse editing/validation/service logic; one manual screen and one generation action; hide draft/history/confirmation/Ready workflow |
| Recipes, Saved, Community screens currently show unavailable placeholders                                                                                               | Hide — DEFERRED                                         | No active tab, Home link or exposed unfinished deep link; retire placeholder files after migration checks                           |
| Profile currently exposes auth/link/delete actions                                                                                                                      | Hide profile — DEFERRED; preserve privacy/auth          | Move needed privacy/delete access to a small Home utility link; do not strand existing account deletion                             |
| `src/features/auth/`, `src/services/backend/`, account functions                                                                                                        | Keep — PRESERVED INTERNAL INFRASTRUCTURE                | Lazy anonymous session, secure storage, account isolation, merge/deletion safeguards; no signup gate                                |
| Scan migrations, private storage, grants/RLS, idempotency, leases/revisions, media inventory                                                                            | Keep — PRESERVED INTERNAL INFRASTRUCTURE                | Adapt through a backend coordinator; never weaken ownership or expose privileged RPCs                                               |
| `server/sanitizer/` and Phase F fence repair                                                                                                                            | Keep — PRESERVED INTERNAL INFRASTRUCTURE                | Reuse immutable approved output and bounded isolated execution; hosted scheduling remains a gate                                    |
| Dirty `src/features/uploads/`, `server/upload-ingress/`, `scan-upload` function, upload migration/tests, `tooling/phase-g-local.cjs`, and tracked wiring/config changes | Stop — PRESERVED INTERNAL INFRASTRUCTURE candidate only | Inventory and review separately; do not run, extend, revert or deploy the old Phase G plan during this review                       |
| Existing Jest, boundary, SQL, sanitizer and integration tests                                                                                                           | Keep — PRESERVED INTERNAL INFRASTRUCTURE                | Preserve security tests; update only UI expectations deliberately superseded by the product reset                                   |
| Live recipe generation, provider adapter, usage ledger, AdMob                                                                                                           | ACTIVE MVP planned; implementation DEFERRED             | These are not currently working product integrations                                                                                |

Evidence limits: Phase F records local sanitizer/security validation, not hosted readiness. The Mi 9 Android 10 report validates launch, cold camera preview, capture, Preview, Retake and camera re-entry. Gallery picker, Use Photo/preparation, orientation, permissions and background/resume still have device coverage gaps. Do not extrapolate camera success to the whole photo-to-recipe journey or iOS.

## Navigation and screen behavior — ACTIVE MVP

```text
Home
  ├─ Take a Photo → Camera → Preview → Generate Recipe → Result
  │                  └─ Choose photo → Gallery → Preview
  ├─ Enter Ingredients Manually → Manual Ingredients → Generate Recipe → Result
  └─ Privacy / data controls (utility link, no Profile tab)

Result → Generate another → Home
Result → Back → prior input, with no automatic regeneration
```

`Generate Recipe` is an action with an in-place progress state, not a job-management screen. On Preview, **Use Photo** approves/prepares the local photo, then exposes **Generate Recipe**. Upload starts only after the generation action and the processing notice. This keeps the requested sequence explicit without adding another screen. Camera capture may continue replacing Camera with Preview as today to release hardware; Preview provides Retake. Standard Back from Preview returns to Home if Camera was replaced.

Proposed routes: `/` Home; retain `/scans/camera`, `/scans/gallery`, `/scans/preview`, `/scans/manual`; add `/results/[generationId]`. Opaque IDs only in route parameters. No ingredients, local URIs, storage paths, provider names or secrets in navigation. Old `/recipes`, `/saved`, `/community`, `/profile` entry points redirect safely to Home after migration; auth callbacks and deletion links remain functional. Old scan draft links may resolve their owner's input into the manual editor or show an unavailable message; never bypass ownership checks. Do not redirect a historical Ready link into a new paid generation.

Manual entry permits add/edit/remove, trims and bounds names, merges exact normalized duplicates and requires at least one ingredient. Existing persisted drafts can remain behind the service boundary while the separate Save/Review/Ready screens disappear from the active journey. Submitting uses a snapshot of the current list. Unsaved changes are preserved in memory during ordinary Back/forward navigation; leaving with unsaved input offers explicit discard. No promise of cross-device history or offline generation.

Photo work retains camera/gallery permission recovery, private local files, retake, source inspection and native JPEG preparation. Backend intake authenticates ownership, bounds the stream, quarantines bytes, sanitizes independently, then resolves only immutable approved bytes to the AI adapter. No raw photo is sent directly from mobile to a provider. Internal revisions, authorizations, sanitizer jobs and leases are not UI vocabulary.

The result order is name, description, supplied/detected ingredients, optional missing ingredients (omit empty section), estimated minutes, numbered steps, **Search YouTube**, and Generate another/Home. A small visual may precede the name later. Both modes use the same component and contract. Show that time and ingredient detection are estimates; schema validation does not prove recipe quality or food safety. Do not claim allergy safety. Incorrect ingredients can be corrected through manual entry; a new generation is an explicit action with its actual usage cost shown.

| State           | Required behavior                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Loading         | Honest “Preparing photo” / “Generating your recipe” feedback, accessible announcement, duplicate-submit guard; no fabricated percentages |
| Error           | Preserve usable input, safe typed message, Retry/Home/manual recovery; clarify reservation release or still-pending outcome              |
| Empty           | Manual guidance, missing/expired photo recovery, or “No usable ingredients found”; no invented recipe                                    |
| Success         | Validated shared result plus fresh authoritative usage; no automatic second generation                                                   |
| Offline/stale   | Keep local editing/preview and an already displayed result readable; generation requires connectivity; cached balance is not authority   |
| Background/Back | Leaving progress does not imply server cancellation/refund; recover the same operation on return; no new key on timeout                  |

Use existing semantic tokens, reduced-motion handling and feedback components. Preserve native Back, large text, screen-reader order, 48dp Android/44pt iOS targets, safe areas and keyboard avoidance. Focus field errors on manual submission. Preserve camera release and identity-change cleanup when moving providers/routes.

## Provider-neutral architecture — ACTIVE MVP design

```text
Screens → recipe controller → generateRecipe(input)
                                ↓ authenticated KitchenCam API
             validation + usage reservation + generation coordinator
                   ├─ manual ingredient snapshot
                   └─ photo intake → isolated sanitizer → approved image
                                ↓
                    RecipeAIProvider interface
                                ↓
                    configured server adapter/model
                                ↓
              strict result validation → atomic result/debit → app
```

Keep route/UI, domain validation, controller state, service client, database transactions and provider adapter separate. Proposed mobile module `src/features/generation/` owns the controller/service and shared result view; keep the existing capture module. Provider implementations belong only in server code, never under mobile imports. Do not introduce a general workflow platform or a monorepo solely for this MVP.

Conceptual TypeScript boundary (documentation only):

```ts
type GenerateRecipeInput =
  { mode: 'manual'; ingredients: readonly string[] } | { mode: 'photo'; photoReference: string };

interface RecipeAIProvider {
  generateFromIngredients(
    ingredients: readonly string[],
    context: RecipeRunContext,
  ): Promise<RecipeResult>;
  generateFromImage(image: ApprovedImage, context: RecipeRunContext): Promise<RecipeResult>;
}

type RecipeRunContext = Readonly<{
  operationId: string;
  deadline: string;
  signal: AbortSignal;
}>;
// ApprovedImage is a server-only capability resolved from a verified artifact,
// never a user-supplied URL, path, or mobile claim of sanitization.
```

Each adapter owns its provider request format, SDK/HTTP transport, model capability checks, schema translation, bounded parsing and error mapping. It maps provider output to `RecipeResult`; the coordinator independently validates it again before persistence. The interface is a contract, not permission to trust a TypeScript annotation on network JSON. Common errors include unavailable, timeout, invalid output, no usable ingredients and rejected content. Raw provider text is never a public error.

Server configuration selects `AI_PROVIDER=gemini` initially and `AI_MODEL=<approved model>`. Exact model/tier is an **OWNER DECISION** after cost/quality evaluation. Allowlisted adapters advertise both image and text capability; reject unsupported combinations at startup. Snapshot provider/model/prompt/schema/config versions per operation for diagnostics. No model override in mobile requests. A future OpenAI/Claude/other adapter must pass the same contract/evaluation tests before selection; no mobile release should be needed for a compatible backend switch. No automatic cross-provider fallback in the initial MVP because it changes cost and data recipients.

Manual and photo generation are each one logical request and one result. Photo generation should use one vision-capable recipe call after sanitization, not require a separate paid recognition call followed by recipe search. Existing `tooling/scan-phase-a/recognition-port.ts` is a research recognition port, not this recipe implementation.

## Strict recipe contract — ACTIVE MVP design

Version 1 is intentionally small. `detectedIngredients` means the accepted supplied list in manual mode and the detected list in photo mode. The server sets the manual list from the validated request and requires the recipe to use it meaningfully; the AI cannot silently replace the user's list. New essential ingredients are not permitted under the label “optional”: reject a dish that depends on missing essentials. Quality evaluation is still needed beyond syntactic validation.

Example result body (transport metadata is outside this object):

```json
{
  "schemaVersion": 1,
  "detectedIngredients": ["tomato", "egg", "onion"],
  "recipe": {
    "name": "Tomato and Egg Skillet",
    "description": "A quick meal using the available ingredients.",
    "missingOptionalIngredients": ["parsley"],
    "estimatedMinutes": 20,
    "steps": [
      "Dice the onion and tomatoes.",
      "Cook the onion in a nonstick pan with a splash of water until softened.",
      "Add the tomatoes and cook until softened.",
      "Add the eggs and cook until the whites and yolks are firm."
    ],
    "youtubeSearchQuery": "tomato egg skillet recipe"
  }
}
```

Normative JSON Schema proposal; implement matching runtime validation in the contracts phase:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "KitchenCam RecipeResult v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "detectedIngredients", "recipe"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "detectedIngredients": {
      "type": "array",
      "minItems": 1,
      "maxItems": 30,
      "uniqueItems": true,
      "items": { "$ref": "#/$defs/ingredient" }
    },
    "recipe": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "description",
        "missingOptionalIngredients",
        "estimatedMinutes",
        "steps",
        "youtubeSearchQuery"
      ],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 120 },
        "description": { "type": "string", "minLength": 1, "maxLength": 400 },
        "missingOptionalIngredients": {
          "type": "array",
          "maxItems": 10,
          "uniqueItems": true,
          "items": { "$ref": "#/$defs/ingredient" }
        },
        "estimatedMinutes": { "type": "integer", "minimum": 1, "maximum": 480 },
        "steps": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": { "type": "string", "minLength": 1, "maxLength": 600 }
        },
        "youtubeSearchQuery": { "type": "string", "minLength": 1, "maxLength": 160 }
      }
    }
  },
  "$defs": {
    "ingredient": { "type": "string", "minLength": 1, "maxLength": 80 }
  }
}
```

Additional server rules: maximum 32 KiB provider result; reject duplicate JSON keys, unknown fields, null required values, numeric coercion, whitespace-only strings, control characters, URLs/HTML/Markdown payloads, and incomplete/truncated output. Normalize bounded Unicode/whitespace and case-insensitive ingredient duplicates before semantic checks; reject overlap between available and missing ingredients. Manual input is 1–30 names of 1–80 characters in a strictly discriminated request; no photo fields in manual mode or ingredients in photo mode. Reject unknown request fields and bodies above 16 KiB. Image bounds remain those of the existing preparation/intake contracts until separately reviewed.

No usable food produces a safe typed error, not an empty success object. Prefer provider structured-output facilities where supported, but never rely on them instead of KitchenCam validation. Do not extract arbitrary prose with regex or render markdown/provider exception bodies. Initial policy: **one provider attempt**, no repair call on malformed data. Explicit user retry after a terminal failure creates a new operation; replay of an ambiguous request retains its original key. A future bounded retry policy must distinguish definitely unexecuted requests from unknown execution and fit the operation deadline/budget.

The app constructs only `https://www.youtube.com/results?search_query=` plus URL-encoded validated `youtubeSearchQuery`. Label it **Search YouTube**, not a verified-video promise. Handle link-opening failure with a retry/copy-query option. No provider-generated URL, embed, thumbnail, autoplay or YouTube Data API.

## Server-only secrets and processing security

**PRESERVED INTERNAL INFRASTRUCTURE:** Supabase JWT verification, owner isolation/RLS, private storage, account lifecycle, sanitized-artifact fences, constrained native/worker resources, private media cleanup and bundle-boundary tests remain mandatory.

`GEMINI_API_KEY`, `OPENAI_API_KEY`, `OTHER_PROVIDER_API_KEY`, service-role credentials and AdMob administrative secrets belong in server secret storage only. Never use `EXPO_PUBLIC_*`, app config extras, source files, logs, navigation or public config responses for them. Mobile needs only public backend URL/publishable key and, later, public ad application/unit identifiers. This review does not edit `.env.example` or configure any real key.

Treat ingredients, images and provider output as untrusted data, not instructions. Fixed server prompts/schema; no tools, arbitrary URL fetch, SQL, external actions or secrets in the model context. Resolve photo references by JWT owner and immutable approved artifact; reject expired/deleted/replaced references. Recheck ownership and account state before result commit. Logs contain correlation IDs, bounded status/cost/latency and private provider version metadata, never photos, ingredient text, full output, access tokens or credentials.

Preserve the existing maximum 24-hour transient-media lifetime and early cleanup intent; actual hosted cleanup/reconciliation remains a release requirement. Recipe operation results have a proposed 24-hour recovery window, then result content is purged; keep minimal idempotency/accounting tombstones to prevent replay without retaining food text. Exact tombstone retention is an **OWNER DECISION** before launch. Account deletion must scrub results and fence pending generations/rewards as well as existing media. Do not erase replay protection before request-key validity expires.

## Remotely controlled economics — ACTIVE MVP design / OWNER DECISION values

Store a validated, versioned server policy with effective time; a trusted deployment/admin process changes it. No public configuration-write endpoint. Publish only the safe display subset via the usage endpoint. The backend computes balances and required-ad counts; mobile never treats bundled defaults, clock or AsyncStorage as authority. Invalid/missing policy fails closed for new paid work. A read-only cached snapshot can explain temporary unavailability.

| Setting                                                    | Proposed initial value                 | Meaning                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `FREE_GENERATIONS`                                         | `3`                                    | Lifetime introductory allotment for an anonymous/account identity; not a daily reset                    |
| `CREDITS_PER_REWARDED_AD`                                  | `1`                                    | Credits per verified completed ad                                                                       |
| `CREDITS_REQUIRED_PER_GENERATION`                          | `2`                                    | Credit cost when no introductory generation remains                                                     |
| `ADS_REQUIRED_PER_GENERATION`                              | configurable; proposed `2`             | Server policy value; validate against `ceil(CREDITS_REQUIRED_PER_GENERATION / CREDITS_PER_REWARDED_AD)` |
| `DAILY_REWARDED_AD_LIMIT`                                  | `5`                                    | Completed rewards plus active reserved ad slots per identity per UTC day                                |
| `DAILY_GENERATION_LIMIT`                                   | `5`                                    | Successful generations plus active reservations per UTC day                                             |
| `MAX_CONCURRENT_GENERATIONS_PER_IDENTITY`                  | `1`                                    | One active logical generation                                                                           |
| `GENERATION_STARTS_PER_MINUTE`                             | `3`                                    | New operation starts; also rate-limit failed attempts and anonymous signup                              |
| `PROVIDER_TIMEOUT_SECONDS`                                 | `30`                                   | Per-call limit; tune after measurement                                                                  |
| `GENERATION_DEADLINE_SECONDS`                              | `120`                                  | Bound the accepted operation including waiting/preparation on the server                                |
| `PROVIDER_MAX_ATTEMPTS`                                    | `1`                                    | No automatic ambiguous provider retry                                                                   |
| `BANNER_ENABLED`, `REWARDED_ENABLED`, `GENERATION_ENABLED` | `false` until each release gate passes | Independent server kill switches                                                                        |

All are proposals, not implemented defaults or claims of profitability. Also require a configured global provider spend ceiling and alerts before enabling calls; no numeric budget invented here. Counters use server UTC and responses include `resetAt`. Rejected/failed attempts do not consume successful-generation quota, but still count toward request/abuse limits and operational spend.

Given free remaining `F`, spendable credits `B`, credit cost `R` and credits per ad `C`: `availableGenerations = F + floor(B/R)`; if this is zero, `adsNeededForNextGeneration = ceil(max(0, R-B)/C)`. Exclude held funds from `F`/`B`. Expose daily remaining separately; `canGenerate` also accounts for limits, active work and availability. Keep leftover credits, including the fifth daily ad in the example. Show “You have 1 recipe generation available” or “Watch 2 ads to unlock another recipe” from actual server values with correct pluralization. If daily capacity is insufficient, show remaining progress and reset time without promising an immediate unlock.

Version changes must not double-grant introductory use: snapshot the free allotment once on identity initialization. New defaults apply to new identities; existing-user top-ups are explicit idempotent grants. Do not reset balances on reinstall, config change, refresh or identity linking. Lost anonymous credentials may create a new identity; acknowledge that abuse limit rather than invent device fingerprinting. Existing permanent sessions remain usable.

Existing credit units remain unchanged when rates change. New generation quotes use the new price, clearly reflected in balance/display; active generation reservations keep their original cost. A multi-ad offer pins the promised cost/reward/config and its validity window across its steps so an intervening configuration change cannot invalidate “watch N to unlock one.” Honor an accepted offer and refresh wording before another offer; no retroactive debit. Offer expiry and handling of already earned progress must be visible, with granted credits retained. The initial UI should describe partial progress plainly, not teach point arithmetic.

## Server-authoritative usage and accounting

Proposed minimal private records (not existing tables or migrations):

| Record                   | Responsibility                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage account            | Owner/anonymous identity, initial free allotment, free consumed/reserved, credit balance/holds, daily counters; locked transactional summary |
| Append-only usage ledger | Free grants, reward credit grants, generation reservations, settled consumption and releases; unique event/operation keys                    |
| Generation operation     | Owner, idempotency key/hash, immutable input snapshot/reference, policy/provider snapshot, deadline, state, reservation and validated result |
| Reward session/offer     | Owner, opaque nonce, pinned policy/reward, reserved daily slot, expiry, verified provider transaction and grant state; introduced with ads   |
| Economy policy           | Version, effective time, allowed bounded values, switches; server writes only                                                                |

Use database constraints and one transaction for accounting transitions, not read-then-write mobile logic. Private tables have no client writes; owner-safe projections may be returned only through authenticated endpoints. Ledger uniqueness protects retries even if a summary update is retried. RLS remains on any exposed projection. Reuse the existing account lock ordering to avoid races with merge/deletion; define and test the new ledger integration before re-enabling those paths for new data. Linking cannot stack duplicate introductory grants. Rewarded credits may transfer exactly once during an approved merge; introductory remainder must be capped to one entitlement.

Generation lifecycle:

1. Validate JWT/active owner, request shape/limits, policy version, idempotency and photo authority. Invalid, unavailable, expired, rate-limited or insufficient-balance requests do not execute AI or debit usage.
2. Atomically create one operation and reserve one free generation, else `R` credits, plus daily/concurrency capacity. Prefer free usage first. Reservations reduce displayed availability but are not final charges. Photo sanitization failure releases the hold before any AI call.
3. Claim execution once under a durable lease/fence, recheck deadlines and approved image/identity, then invoke the selected adapter. Persist execution-start before dispatch. A crash after that boundary has an ambiguous provider outcome: do not blindly resend. Provider costs may have occurred despite no usable output.
4. Validate result. Atomically store success and settle exactly one reservation/debit with the result. Client disconnect does not refund a successful persisted result; its retry retrieves that result without another call or charge.
5. On provider refusal, no food, invalid output, timeout or terminal infrastructure failure: mark terminal, release the reservation exactly once and return a safe error. KitchenCam absorbs upstream cost. Background reconciliation expires abandoned operations, releases holds and fences all late completions. No successful result may commit after a terminal release.

Use `(owner, idempotencyKey)` uniqueness and a canonical request hash. Same key/same input returns existing state/result; different input is `409 IDEMPOTENCY_CONFLICT`. Unknown pending outcomes never trigger a fresh key automatically. Proposed UUIDv7 operation keys carry a 24-hour admission window: a previously unseen stale key is rejected; retained tombstones block replay after content deletion. Validate server-observed clock bounds; the timestamp is not authority for quota. Intentional “Generate another” uses a new key and the same ordinary admission rules. Global budgets, bounded attempts, per-owner concurrency and server request limits contain deliberate new-key abuse; no claim of exactly-once provider billing.

## Smallest backend surface

Conceptual `/v1` paths below; Supabase Edge deployment names may differ behind one typed client adapter. Existing Auth/account/privacy APIs and private RPCs remain; they are not reimplemented as new MVP endpoints.

| Interface                                            | Contract and purpose                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/generate-recipe`                           | JWT + `Idempotency-Key`; strict manual/photo union above; optional `expectedEconomyVersion` for consent to current cost. One stable operation for both modes                                                                                                        |
| `GET /v1/usage`                                      | JWT; usage, safe economics/config version, enabled actions, `availableGenerations`, `adsNeededForNextGeneration`, pending operations/rewards, daily remaining/reset time and quote validity. Combines balance and configuration; no separate config endpoint needed |
| `POST /v1/photos`                                    | JWT + idempotency; bounded streamed photo intake; opaque `photoReference` only, no internal storage paths. Narrow transport needed for bytes, not a second AI API. Reuse reviewed ingress controls through an adapter                                               |
| `POST /v1/reward-sessions` — DEFERRED until ads      | JWT + idempotency; obtains/pins offer and one ad-session nonce, reserves daily slot, returns allowed public ad placement and reward disclosure. No grant from a client claim                                                                                        |
| `GET /v1/admob/reward-callback` — DEFERRED until ads | Server-to-server signed AdMob SSV callback; validate and deduplicate provider transaction then grant once. Not a user JWT endpoint                                                                                                                                  |

Generation returns `200 {data:{generationId,status:"succeeded",result,usage}}`, or `202 {data:{generationId,status:"processing",retryAfterSeconds}}`. Retrying the **same POST/key/body** is status recovery and cannot dispatch again. This avoids a separate polling endpoint; persist only the minimal account-scoped recovery key/body or opaque photo reference securely for the recovery window, and clear on expiry, explicit discard or identity change. Retain the minimal recovery record through the 24-hour result window so a reloaded result route can resolve its generation ID to the original operation. If recovery metadata is unavailable, show a safe unavailable/Home state; never regenerate automatically. Do not persist image bytes in this recovery record. The coordinator may need a small durable executor for work beyond the HTTP lifetime; hosted runtime choice is an **OWNER DECISION**, not permission to promise background work in an unverified Edge runtime.

An unchanged retry always resolves its original policy snapshot before checking current economics. A genuinely new request with stale `expectedEconomyVersion` returns `409 POLICY_CHANGED` and fresh usage before any reservation/AI call. Include request ID and typed safe errors such as `VALIDATION`, `UNAUTHENTICATED`, `PHOTO_NOT_READY`, `PHOTO_EXPIRED`, `INSUFFICIENT_GENERATIONS`, `DAILY_LIMIT`, `RATE_LIMITED`, `GENERATION_PENDING`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `INVALID_RECIPE_RESULT`, `NO_USABLE_INGREDIENTS`. Terminal error envelopes include safe retry guidance and fresh usage when available, never provider text.

`POST /photos` accepts only bounded prepared bytes and necessary type metadata, with notice acceptance and active owner admission. It may return before sanitization completes; the coordinator waits internally for approval within the operation deadline. Upload references are owner-bound and expire with media; no client-specified fetch URL. Reject intake while generation processing is disabled; no orphan upload for an unavailable service. The implementation must establish admission before uploading and clean up abandoned intake. Cancellation endpoints and recipe-history/list APIs are not required for this MVP; leaving a screen is not a cancellation claim.

## Future AdMob boundaries and user flows

**ACTIVE MVP design; SDK implementation DEFERRED.** Mobile `AdService` handles consent readiness, supported platform, banner lifecycle, rewarded loading/showing and SDK completion/dismissal callbacks. UI consumes provider-neutral readiness/result events; `UsageService` reads the authoritative backend. No component increments spendable balance. Server reward verification is independent of the mobile SDK wrapper. Consent/privacy settings remain accessible without a Profile tab. SDK/Expo compatibility, native configuration, consent requirements and real-device behavior must be checked in the separately approved ad phase. Use test ad identifiers in development and keep ad flags off until validation.

**Banner:** one Home-only placement, below content in a layout-reserved footer. Content scrolls in the remaining viewport. Put a non-clickable separation zone between controls and the ad (proposed minimum 24dp, larger when needed; this is a KitchenCam design choice, not a claimed Google safe-harbor distance), then banner, then bottom device safe inset. No overlay, sticky CTA directly beside it, stacked banners, ad disguised as a control, or content hidden beneath it. Suppress on camera, preview, ingredient entry, progress and Result/cooking steps. Hide for keyboard/reward overlays and insufficient height; reserve measured height before loading so controls do not jump under a finger. Verify small phones, large text, landscape, gesture/button navigation, no-fill and consent states. Google cautions against banners adjacent to interactive elements; actual layout must be reviewed, not assumed safe because of a fixed gap. [Google banner guidance](https://support.google.com/admob/answer/6275345?hl=en).

**Rewarded flow:** user chooses an explicit unlock action → fetch server offer → disclose exact reward and remaining required ads → user chooses Watch → show one loaded ad → SDK earned-reward callback shows “Verifying reward” → signed server verification grants credit once → refresh usage → user may voluntarily choose the next ad or Generate Recipe. Never auto-launch or chain ads; dismissal, load failure, skipped ads and clicks are not completion. Preserve progress through no-fill/network interruption. If the daily limit is reached, show reset time and retain credit already earned. The multi-ad disclosure and opt-in are required before each ad. [Google rewarded-ad policy](https://support.google.com/admob/answer/7313578?hl=en).

The backend verifies the signed SSV callback against Google's verification keys, expected ad unit and reward configuration, session binding, timestamp and unique `transaction_id`. Bind an opaque server nonce through custom data; do not put email/ingredient data there. Reserve daily capacity before showing and count grants atomically, including delayed callbacks. Pin completion eligibility to the admitted session/day; allow a documented delivery grace window so a valid completed ad is not lost to network delay or a day boundary. Expired unused slots can be released only with a reconciliation policy that prevents later callbacks from exceeding admission limits. Duplicate callbacks acknowledge the original grant. Invalid callbacks never grant. [Google SSV specification](https://developers.google.com/admob/android/ssv).

SDK completion is necessary for immediate UI reward feedback but never sufficient for spendable authority. Verified SSV independently proves completion if the app dies before it reports its callback; grant once and show it on next refresh. Do not make both messages arrive to avoid losing a real reward. No verified completion means no authoritative credit. If verification is delayed, show pending rather than optimistic spendable balance; reconciliation must handle callback delay/retry and account deletion safely.

## Migration plan that preserves validated work

1. **Approved documentation checkpoint:** inventory and isolate old Phase G; record new product/API/economics. Validate and commit only approved documentation, then push main before MVP-1.
2. **MVP-1 — simplify navigation and inputs (authorized after checkpoint):** native Home stack, two actions, preserve camera/gallery/preparation and simplify manual editing. Hide legacy tabs and scan management UI; keep privacy entry and auth callbacks. Add a provider-neutral client service boundary returning an explicit unavailable state until backend implementation. Contract fixtures may exercise a shared result view in tests/development only; never show fake generated results as live success. Resolve the existing dirty upload wiring deliberately before route edits; do not silently incorporate it as validated work.
3. **MVP-2 — implement contracts/accounting with deterministic test adapter:** shared runtime result/input schemas, generation coordinator, idempotent reservation ledger, usage/config endpoint, concurrent/failure/recovery tests and identity lifecycle integration. Provider and ad flags remain disabled. This phase is an implementation proposal, not authorized by this review.
4. **MVP-3 — connect photo intake and initial AI adapter:** separately review/reuse the stopped ingress candidate, implement the smallest required transport, prove hosted sanitizer/cleanup/resource bounds, then add Gemini behind the neutral port after model/budget approval. Validate both input modes against the same contract/UI. No requirement to complete the old Phase G/H feature sequence.
5. **MVP-4 — ads and release hardening:** integrate one banner and voluntary rewarded SDK only after signed verification, reward accounting, test-ID flows, consent/layout/device checks and measured economics. Run weak-network/restart/device/accessibility/security and spending kill-switch checks before enabling.
6. **Retire later:** after route/deep-link tests and owner acceptance, remove unused tab/placeholder components and superseded recognition-only orchestration if unused. Never drop migrations, security tests, cleanup inventory or data as a UI cleanup shortcut.

The current sanitizer completion RPC automatically queues `recognize`, whose completion writes `needs_confirmation`; manual scan projection assumes manual source/revision semantics. A recipe result cannot be inserted into either contract unchanged. Prefer a narrow additive recipe-operation coordinator that consumes the immutable approved artifact. Explicitly adapt the sanitizer handoff so exactly one consumer schedules generation; preserve the old recognition behavior for historical scans as needed. Do not run old recognition plus new generation or fake “confirmed” state to bypass guards. Keep future migrations additive and test ownership, lease expiry, stale completion, manual fallback, cancellation, merge/deletion and cleanup races before enabling photo generation.

MVP-1 acceptance: two clear Home actions; no browsing/community/saved/profile/subscription UI reachable; native Back and Home work; manual draft changes remain safe; no camera/retake/preparation regression; privacy/delete remains accessible; loading/error/empty/success are covered (success via explicit test fixture until backend is real); provider/ads remain off. Run TypeScript, lint, relevant UI/domain/boundary tests and physical Mi 9 launch/camera/Retake checks. Expand Use Photo/gallery lifecycle coverage rather than claiming it from earlier camera results. Existing backend/security tests remain intact; rerun affected suites if their adapters change.

## Deferred, future and owner decisions

**DEFERRED:** Community, ratings/reviews/moderation UI, Saved/favorites, recipe browsing/filter/ranking/catalog integration, Profile/social profiles, subscriptions/premium/RevenueCat, nutrition expansion, live Gemini/OpenAI/Claude calls in this review, AdMob/rewarded SDKs in this review, YouTube Data API, fabricated video links, planner/groceries. None is a dependency of the next UI simplification phase.

**FUTURE:** verified video resolution, optional dish media, new provider adapters, optional account continuity, install identifier, Play Integrity and server abuse signals if evidence warrants them. No invasive fingerprinting or mandatory registration.

**OWNER DECISION:** authorize phases after MVP-1; exact initial Gemini model/tier and evaluated quality/cost; proposed free/reward/daily/timeout values and config-change offer policy; hosting/runtime and global spending budget; launch markets/platform priority and required privacy/food-safety/ad consent review; accounting tombstone retention. Existing security controls are not optional owner choices. No model name, ad network revenue assumption or production readiness is inferred by this review.
