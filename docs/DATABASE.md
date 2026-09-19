# KitchenCam Database Design

Status: approved logical MVP baseline. No migrations have been created.

## Principles

- PostgreSQL is the source of truth for users, recipes, social data, jobs, and entitlements.
- `auth.users` is owned by Supabase Auth. Application tables reference its UUID and never duplicate credentials.
- Every exposed table has explicit grants, RLS enabled, and allow/deny tests for every operation.
- Provider payloads stay in private audit storage only when needed; normalized domain data drives the app.
- Soft deletion is used only where moderation/audit requires it. User privacy deletion is a real purge or anonymization under an approved policy.
- Money is stored in minor units plus ISO currency. Quantities use decimal values and canonical units.
- All mutable records include `created_at`, `updated_at`, and where needed `version` for optimistic concurrency.

## Core identity and preferences

| Table | Purpose and key fields |
|---|---|
| `profiles` | `user_id` PK/FK, display name, avatar path, locale, measurement system, onboarding state |
| `user_preferences` | diet flags, time/skill/equipment defaults, nutrition goals, notification preferences |
| `user_allergens` | user, canonical allergen, severity/notes; private and excluded from analytics/ad targeting |
| `user_devices` | push token hash/reference, platform, app version, consent state, last seen |
| `privacy_requests` | export/delete request lifecycle and audit timestamps, without retaining deleted content |

Anonymous Supabase users use the authenticated database role but are distinguished by the JWT `is_anonymous` claim. Restrictive policies prevent anonymous accounts from posting reviews or other abuse-prone public content.

## Ingredients and scanning

| Table | Purpose and key fields |
|---|---|
| `ingredient_catalog` | canonical name, category, allergen relationships, default unit metadata |
| `ingredient_aliases` | normalized alias, locale, canonical ingredient, source/version |
| `scans` | owner, state, source camera/gallery/manual, model/prompt/schema versions, timing, error code |
| `scan_images` | scan, private object path, MIME, bytes, dimensions, hash, retention/deletion timestamps |
| `scan_jobs` | scan, status, attempts, lease owner/expiry, next attempt, idempotency key, correlation ID |
| `scan_detections` | scan, raw label, canonical candidate, `likely/uncertain` label, estimated quantity/unit, model evidence |
| `scan_ingredients` | user-confirmed canonical/display name, quantity/unit, present flag, provenance |

`scan_jobs` has a unique idempotency key and an index on `(status, next_attempt_at)`. Workers claim with row locking/skip-locked or a managed queue. Original model output may be kept briefly in a restricted audit column/bucket, then removed on schedule. KitchenCam/provider failures release or refund reserved usage atomically.

## Recipes and nutrition

| Table | Purpose and key fields |
|---|---|
| `recipes` | stable internal ID, title, summary, servings, times, difficulty, status, source type |
| `recipe_provider_refs` | recipe, provider, external ID, source URL, attribution, license/cache policy, last synced |
| `recipe_media` | licensed image/video references, dimensions, captions, attribution, cache permission |
| `recipe_ingredients` | recipe, canonical ingredient, display text, decimal quantity, unit, optional/group/order |
| `recipe_steps` | recipe, sequence, text, timers, safety metadata, video cue |
| `recipe_tags` | normalized cuisine, meal, diet, equipment, and other facets |
| `recipe_allergens` | allergen, status `contains/may_contain/unknown/free`, evidence/source |
| `nutrition_snapshots` | recipe, serving basis, yield, calculator/source version, completeness, calculated time |
| `nutrition_values` | snapshot, nutrient code, decimal amount, unit, source food references |
| `ingredient_nutrition_mappings` | ingredient/brand context to USDA/provider food ID, confidence, reviewed state |

Recipe provider IDs are never used as public KitchenCam IDs. A provider can be replaced without breaking favorites or reviews. A content tombstone preserves references when a license requires removal while preventing display.

## User activity and community

| Table | Purpose and key fields |
|---|---|
| `favorites` | user, recipe; unique pair |
| `collections` | owner, name, sort position |
| `collection_items` | collection, recipe; unique pair |
| `recipe_history` | user, recipe, event type `viewed/cooked`, timestamp, optional scan |
| `cook_sessions` | user, recipe, start/complete timestamps, serving count, optional private notes |
| `reviews` | permanent user, recipe, rating 1-5, body, moderation status, edited/deleted timestamps |
| `review_photos` | Version 1.1: review, quarantined/public object path, moderation status |
| `review_votes` | voter, review, helpful boolean; unique pair |
| `review_reports` | reporter, review, reason, detail, status |
| `moderation_actions` | actor, target type/ID, action, reason, audit metadata |

Public review queries expose only approved profile fields and published content through a safe view or function. Moderators use a separate privileged role; clients cannot set moderation state.

## Monetization

| Table | Purpose and key fields |
|---|---|
| `billing_customers` | nullable linked user, RevenueCat app user ID, anonymous/platform aliases; no raw payment details |
| `subscription_events` | unique provider event ID, type, signed payload reference/hash, received/processed state |
| `subscriptions` | user, store, product ID, original transaction/purchase token hash, lifecycle timestamps/status |
| `entitlements` | user, entitlement key, active/grace timestamps, source subscription, last verified |
| `usage_ledger` | user, usage type, units, period, request/job ID; append-only and idempotent |
| `ad_policy_overrides` | remote placement flags and caps by release/region; admin-only |

The webhook event is written before processing. The event ID and store transaction identifiers have uniqueness constraints. Entitlement updates and event completion occur in one transaction.

## Planner and groceries (version 1.1)

`meal_plans`, `meal_plan_items`, `grocery_lists`, and `grocery_items` are owner-scoped. Grocery entries retain the source recipe/ingredient and a user-editable display value. Inventory subtraction is explainable and reversible; it never permanently mutates a recipe.

## Index and search plan

- GIN full-text index on normalized recipe title/summary and an ingredient search document.
- `pg_trgm` indexes for ingredient aliases and typo-tolerant recipe title search.
- B-tree indexes on foreign keys, owner plus recency, published moderation state plus recency, job queue state, and entitlement expiry.
- Partial indexes for active entitlements, published reviews, and runnable jobs.
- Cursor order uses `(rank_or_created_at, id)` to remain stable.
- Materialized aggregate or maintained counters for recipe rating/count only after correctness tests; raw reviews remain authoritative.

## RLS policy matrix

| Data | Read | Write |
|---|---|---|
| Own profile/preferences/scans/history | owner | owner, with protected columns server-only |
| Public recipes/nutrition | authenticated/guest as product permits | server/provider pipeline only |
| Favorites/collections | owner | owner |
| Published reviews | product users | permanent owner creates/edits own; moderation server-only |
| Reports/votes | owner sees own report/vote as needed | permanent user, rate limited |
| Subscriptions/entitlements | owner read-safe projection | webhook/service role only |
| Usage ledger/jobs | owner reads summarized status only | server only |

Policies derive identity from the verified JWT, never a request-body user ID. Views are created with safe invoker behavior or exposed through security-reviewed functions.

## Retention baseline

These are approved engineering baselines and remain subject to final legal/privacy review before production:

- Raw scan photo: automatically delete within 24 hours after successful recognition.
- Scan history stores detected ingredients/results without the original image by default.
- Saved scan image: explicit opt-in only and stored as a separately processed, metadata-free derivative; never retain the raw upload as history. Delete it on history deletion/account deletion.
- Detection/job operational detail: 30-90 days, with de-identified aggregate metrics longer.
- API logs: 30 days with no image body, ingredient list, allergy value, token, or review body.
- Deleted account: purge/anonymize within 30 days, with documented financial/fraud records retained only as legally required.
- Version 1.1 review photos: delete rejected media after the approved moderation/appeal window.

## Migration and environment policy

Use forward-only reviewed migrations in source control. Development, staging, and production use separate Supabase projects and credentials. Production data is never copied into lower environments. Seed data is synthetic/licensed. Backup restore drills, storage backup/export, and rollback-compatible application releases are launch gates.
