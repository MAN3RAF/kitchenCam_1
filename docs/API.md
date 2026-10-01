# KitchenCam MVP API design

Status: provider-neutral proposal reviewed 2026-10-01; not implemented by this documentation task. Supersedes the former recipe-search, community and subscription API roadmap. See [MVP_ARCHITECTURE.md](MVP_ARCHITECTURE.md) for normative input/result validation, accounting and failure rules.

## Small public surface — ACTIVE MVP design

| Interface                       | Purpose                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/generate-recipe`      | One idempotent operation for manual ingredients or an opaque photo reference; returns the same recipe result                          |
| `GET /v1/usage`                 | Current authoritative balance, safe remote economics/feature configuration, derived user-facing counts and pending operation recovery |
| `POST /v1/photos`               | Bounded authenticated byte intake using preserved security controls; returns an opaque owner-bound reference                          |
| `POST /v1/reward-sessions`      | Later: authorize one voluntary ad session, pin reward terms and reserve daily capacity                                                |
| `GET /v1/admob/reward-callback` | Later: signed server-to-server reward verification, unique transaction handling and authoritative grant                               |

The last two interfaces are **DEFERRED** until the ad phase. Existing Supabase Auth/account/privacy operations stay available; private database RPCs do not become public product endpoints. Paths are conceptual and can map to Edge Function names behind the mobile adapter.

```json
{ "mode": "manual", "ingredients": ["egg", "tomato", "onion"] }
```

```json
{ "mode": "photo", "photoReference": "opaque-owner-bound-reference" }
```

An optional `expectedEconomyVersion` protects a new request from an unseen price change. Every generation request requires an authenticated owner and an `Idempotency-Key`. Do not accept provider/model, authoritative user ID, price, credit grant or arbitrary image URL from the client.

Return `200 {data:{generationId,status:"succeeded",result,usage}}` or `202 {data:{generationId,status:"processing",retryAfterSeconds}}`. The client resumes by repeating the same POST/key/body; no new dispatch or debit occurs. Same key with different input is a conflict. Final errors include a safe code, request ID, retry guidance and fresh usage when available. Raw provider text is never returned.

`RecipeResult` v1 contains only `schemaVersion`, `detectedIngredients`, and `recipe` with `name`, `description`, `missingOptionalIngredients`, `estimatedMinutes`, `steps`, `youtubeSearchQuery`. The full strict JSON Schema, text/size bounds and example are in the MVP document. Mobile builds a real YouTube search URL from the encoded query; no invented video URL.

## PRESERVED INTERNAL INFRASTRUCTURE

Phase C manual editing currently uses authenticated `create_scan` / `mutate_scan` RPCs and owner-protected reads, with version/revision checks and idempotency. These can remain behind adapters while the product hides draft history and confirmation screens. Manual editing is free; the new manual **recipe generation** operation consumes the same allowance as photo recipe generation.

Keep private Storage, bounded authenticated intake, sanitizer approval, ownership, lease/revision fences and deletion inventory. Never substitute an unrestricted direct upload URL for those controls. The locally archived `scan-upload` work is stopped pending separate review and is not an approved implementation of this API.

## DEFERRED

Recipe search/detail catalog APIs, nutrition, favorites/history browsing, reviews/ratings, social profiles, purchases and premium entitlements are outside the MVP API surface. Do not implement their former route reservations.
