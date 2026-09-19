# KitchenCam Product Definition

Status: approved MVP planning baseline; seven items remain open  
Source: `KitchenCam_App_Specification.pdf`, version 1.0  
Last reviewed: 2026-09-19

## Product promise

KitchenCam helps a person turn ingredients already at home into a meal. The shortest successful journey is: capture a kitchen photo, correct the detected ingredients, find a suitable recipe, understand its nutrition, cook it, and save or review it.

The product is a food utility, not a medical device. Ingredient detection, nutrition, allergens, substitutions, and other AI outputs must be presented with appropriate provenance and uncertainty. AI-generated recipes are excluded from the MVP.

## Personas and jobs

- A time-constrained home cook wants a useful meal from what is available.
- A budget- or waste-conscious cook wants to use ingredients before buying more.
- A diet-conscious user wants recipes compatible with preferences and declared exclusions.
- A learner wants readable step-by-step instructions and optional captioned video.
- A returning user wants favorites, history, planning, and groceries synchronized across devices.

The MVP targets a general audience aged 18 and older. It is an English-only Android and iOS phone application, portrait-first with landscape supported where useful for cooking and video. It does not target children. Exact launch countries remain open.

## Functional requirements

### Account and onboarding

- Explain the value proposition and provide privacy and terms links.
- Support a guest path and persistent accounts.
- Support Google and email authentication; iOS should also offer Sign in with Apple when required by App Store policy.
- Merge guest favorites and history safely when a guest creates or links an account.
- Allow store purchases without requiring a KitchenCam account; encourage account linking for reliable cross-device continuity.
- Provide profile preferences, privacy controls, sign-out, account export, and account deletion.

### Capture and ingredient confirmation

- Capture a photo with camera permission requested at point of use.
- Import a photo with gallery permission requested at point of use.
- Permit manual ingredient entry as a fallback.
- Return normalized ingredient candidates with uncertainty indicators.
- Let the user add, rename, remove, and optionally quantify every candidate.
- Require explicit confirmation before recipe matching.
- Keep quantity estimates visibly marked as estimates.

### Recipe discovery

- Rank recipes by confirmed ingredient coverage, missing ingredients, hard dietary restrictions, allergens, time, difficulty, equipment, nutrition goals, and quality signals.
- Show photo, match explanation, cook time, difficulty, calories, rating, dietary labels, and missing-ingredient count.
- Filter by diet, allergens, time, difficulty, meal type, cuisine, calories, equipment, and missing ingredients.
- Sort by best match, fastest, highest rated, or newest. Do not offer a subjective "healthiest" score or sort in MVP.
- Use provider-authored recipes only in the MVP and show their provenance; AI-generated recipes are excluded.

### Recipe detail and cooking

- Show ingredients split into available and missing groups, substitutions, servings, steps, nutrition, video, and reviews.
- Recalculate ingredient quantities and nutrition when servings change.
- Provide a high-legibility step mode with timers and predictable next/back behavior.
- Treat tutorial video as optional for MVP. When present, keep guidance available as text and provide captions and playback speed controls.
- Keep ads out of camera capture, ingredient editing, timers, and active cooking steps.

### Nutrition and food safety

- Show serving size, calories, protein, carbohydrates, fat, fiber, available micronutrients, allergen flags, and provenance.
- Mark calculated or incomplete values as estimates.
- Warn users to verify packaging and seek professional guidance for allergies or medical diets.
- Include food-safety constraints for raw meat, eggs, reheating, and storage where applicable.
- Do not treat reviews or generated insights as medical advice.

### Community and retention

- Favorite recipes and organize them into collections.
- Record recently viewed and recently cooked history.
- Support 1-5 star ratings, text reviews, helpful votes, reporting, and moderation for permanent verified accounts.
- Defer review photos to version 1.1.
- In version 1.1, support weekly meal planning, consolidated grocery lists, inventory subtraction, grouping, completion, and share/export.
- Consider licensed offline saved recipes in version 1.1 only if the selected content rights permit it; do not promise offline recipe availability in MVP.

### Monetization

- Free users receive core scanning, recipes, nutrition, cooking, and community features with conservative advertising.
- Premium Monthly and Premium Annual grant the same `premium` entitlement and remove all ads.
- Display localized store prices, renewal terms, manage-subscription, and restore-purchases actions.
- Do not offer a free trial initially; preserve the ability to add a store-supported trial later.
- Support purchase, pending, active, grace period, billing issue, expired, cancelled-renewal, and restored states.
- Enforce scan/generation quotas on the server. Final Free and Premium limits remain open until unit economics are measured.
- Automatically restore quota when a scan fails because of KitchenCam or an upstream provider.
- Premium MVP benefits are no advertisements, higher scan quotas, and only approved Premium filters/features that are implemented at purchase time.

## Non-functional requirements

The following are approved initial engineering targets, not marketing guarantees. They may be refined from measured production behavior without weakening safety or privacy requirements.

| Area | Initial engineering target |
|---|---|
| Availability | 99.5% monthly for MVP API, excluding announced maintenance and upstream outages |
| Responsiveness | Immediate local capture feedback under 100 ms; cached screen content under 1 s |
| API latency | p95 under 500 ms for database-only reads; AI scan p95 under 15 s with visible progress and retry |
| Reliability | 99.5% crash-free sessions at launch, moving to 99.8% after stabilization |
| Accessibility | WCAG 2.2 AA principles where applicable, VoiceOver/TalkBack testing, Dynamic Type, reduced motion |
| Security | TLS in transit, least privilege, RLS on exposed data, secrets only in trusted server environments |
| Privacy | Data minimization, purpose limitation, deletion/export workflows, configurable photo retention |
| Scalability | Stateless API functions; horizontal job processing; cursor pagination; indexed database filters |
| Maintainability | Strict TypeScript, feature boundaries, documented contracts, migrations, automated checks |
| Observability | Correlated request/job IDs, privacy-scrubbed logs, crash reporting, service and cost alerts |
| Cost control | Per-user quotas, idempotency, cached provider results where licensed, provider budgets and alerts |
| Compatibility | Supported current iOS/Android versions to be defined from launch-market device data |

## MVP boundaries

Version 1 includes onboarding/account/guest mode, camera and gallery scanning, editable detections, recipe search and detail, nutrition estimates, step mode, optional tutorial video support, favorites, ratings/text reviews/reporting, profile preferences, approved banner/native ads, monthly and annual Premium, restore purchases, and subscription management.

Version 1.1 includes planner, grocery lists, deeper personalization, substitutions, review photos, stronger moderation, and potentially licensed Premium offline recipes. Pantry expiry, barcodes, voice cooking, shared plans, localization packs, and retailer integrations remain later opportunities.

## Remaining open decisions

Only these owner decisions remain open:

1. Exact recipe provider and licensing contract.
2. Final AI vision model after benchmarking.
3. Final Free and Premium scan quotas after unit economics.
4. Final monthly and annual pricing after unit economics; `$9.99/month` and `$79.99/year` remain hypotheses.
5. Exact launch countries.
6. Final legal, privacy, and nutrition review requirements.
7. Production operating budget.

## Resolved specification tensions

- Ingredient uncertainty uses `likely` and `uncertain` labels, not uncalibrated probability percentages.
- The live camera and scan workflow are ad-free; banners may appear only in appropriate non-camera content.
- Offline recipes are not an MVP promise and require explicit licensing before any later implementation.
- Sign in with Apple is included where required alongside Google and email OTP/magic link.
- Premium receives higher, sustainable quotas rather than an unbounded "unlimited" promise.
- MVP navigation is Home, Recipes, Saved, Community, and Profile; Planner remains version 1.1.
- The paywall advertises only benefits implemented and available at purchase time.

## Product invariants

- A user always confirms detected ingredients before matching.
- Allergy exclusions are hard constraints; unknown data is never presented as confirmed safe.
- Store price and any future trial eligibility text come from the storefront, never from hardcoded copy.
- Premium entitlement, quotas, and protected content are verified server-side.
- Every asynchronous screen has loading, error, empty, stale/offline, and success behavior.
- Every recipe and nutrition result carries source, calculation status, serving basis, and update time.
- Deleting an account initiates deletion of owned data and media, subject only to documented legal retention.

## Decisions log

Approved MVP decisions are recorded in this document and the architecture set. See the final section of `docs/ROADMAP.md` for the seven remaining owner decisions.
