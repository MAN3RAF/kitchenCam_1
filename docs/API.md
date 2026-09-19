# KitchenCam API Design

Status: approved draft MVP contract; no endpoints have been implemented.

## Conventions

- Base path: `/v1` over HTTPS.
- Auth: Supabase access token in `Authorization: Bearer <token>`; no user ID accepted as authority.
- JSON uses camelCase externally and typed schemas. Timestamps are RFC 3339 UTC.
- Mutating creation/processing endpoints accept `Idempotency-Key`.
- List endpoints use opaque cursor pagination.
- Responses include `X-Request-Id`; clients may send `X-Client-Request-Id`.
- Public API responses never expose provider secrets, internal object paths, raw webhook payloads, or model prompts.

## Response shapes

Successful single-resource responses return `{ "data": ... }`; lists return `{ "data": [...], "page": { "nextCursor": ... } }`.

Errors return:

```json
{
  "error": {
    "code": "SCAN_PROVIDER_TIMEOUT",
    "message": "Ingredient recognition is taking longer than expected.",
    "requestId": "req_...",
    "retryable": true,
    "fieldIssues": []
  }
}
```

Stable categories: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `QUOTA_EXCEEDED`, `CONSENT_REQUIRED`, `RATE_LIMITED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `UNSAFE_OR_UNSUPPORTED`, and `INTERNAL`.

## Scan and upload endpoints

| Method and path | Purpose |
|---|---|
| `POST /v1/scan-uploads` | Validate quota/metadata; create scan and signed private upload target |
| `POST /v1/scans/{scanId}/recognize` | Verify uploaded object and enqueue idempotent recognition |
| `GET /v1/scans/{scanId}` | Return status, safe progress, detections, or typed failure |
| `PUT /v1/scans/{scanId}/ingredients` | Replace confirmed ingredient draft with validated user edits |
| `DELETE /v1/scans/{scanId}` | Delete scan data/media under retention rules |

`POST /scan-uploads` accepts MIME, byte count, dimensions, and source, and returns a scan ID, object token/target, expiry, and limits. Upload bytes go directly to storage. Recognition normally returns `202 Accepted`; polling may use bounded backoff or a Realtime status channel.

Scan states: `awaiting_upload`, `uploaded`, `queued`, `processing`, `needs_confirmation`, `completed`, `failed`, `cancelled`, `expired`. Detection items expose `likely` or `uncertain`, not probability percentages. After successful processing, raw scan media is always scheduled for deletion within 24 hours. When image retention is explicitly enabled, the service creates a separate metadata-free history derivative.

## Recipe endpoints

| Method and path | Purpose |
|---|---|
| `POST /v1/recipe-searches` | Search/rank from confirmed ingredients and explicit filters |
| `GET /v1/recipes/{recipeId}` | Licensed recipe detail, provenance, rights, and user relationship |
| `GET /v1/recipes/{recipeId}/nutrition?servings=N` | Versioned nutrition calculation and completeness |
| `GET /v1/recipes/{recipeId}/reviews` | Published reviews with cursor/sort |
| `POST /v1/recipes/{recipeId}/cook-sessions` | Start a cooking session |
| `PATCH /v1/cook-sessions/{id}` | Complete/cancel/update progress idempotently |

Search input includes `scanId` or explicit confirmed ingredients, diet/allergen exclusions, time, difficulty, equipment, meal type, cuisine, calorie range, nutrition goal, missing-ingredient limit, sort, and cursor. The backend re-reads private preferences and does not trust a client claim that a recipe is allergen-safe.

Results return match components, missing ingredients, explicit unknown-safety flags, provenance, and nutrition status. Provider raw scores are not exposed as KitchenCam confidence. MVP results come from licensed/database recipes; AI-generated recipes are not returned.

## Favorites, history, and community

| Method and path | Purpose |
|---|---|
| `PUT /v1/me/favorites/{recipeId}` / `DELETE` | Idempotent favorite state |
| `GET /v1/me/favorites` | Paginated favorites |
| `GET /v1/me/history` / `DELETE /v1/me/history` | Read or clear private history |
| `POST /v1/recipes/{recipeId}/reviews` | Permanent-account review submission |
| `PATCH /v1/reviews/{reviewId}` / `DELETE` | Owner edit/delete under moderation rules |
| `PUT /v1/reviews/{reviewId}/helpful` / `DELETE` | Idempotent vote |
| `POST /v1/reviews/{reviewId}/reports` | Report abuse/spam with rate limits |
| `POST /v1/review-uploads` | Version 1.1: signed quarantined photo upload target |

Meal plan and grocery endpoints use `/v1/me/meal-plans` and `/v1/me/grocery-lists` when version 1.1 is approved.

## Account and preference endpoints

- `GET/PATCH /v1/me/preferences`
- `GET /v1/me/export` starts an asynchronous export with secure expiring delivery.
- `DELETE /v1/me` requires recent authentication, starts deletion, revokes sessions, and returns a request ID.
- Guest-to-account linking uses the auth provider plus a server merge endpoint with an explicit conflict policy.

## Subscription endpoints and webhook

| Method and path | Purpose |
|---|---|
| `GET /v1/me/entitlements` | Backend-authoritative premium and quota projection |
| `POST /v1/me/entitlements/refresh` | Rate-limited reconciliation after purchase/restore |
| `POST /v1/webhooks/revenuecat` | Signed, idempotent provider webhook; no user auth |
| `GET /v1/app-config` | Cacheable ad/feature policy without secrets |

The client purchases through RevenueCat, not through the KitchenCam API. A KitchenCam account is not required to purchase; RevenueCat-supported anonymous identity/alias/transfer behavior is reconciled when an account is linked. Webhook processing supports replay and out-of-order events by comparing provider event and entitlement timestamps. The server never trusts `isPremium` from the app.

## Quotas and rate limits

Rate limits are per user plus device/IP risk signals. Scan/generation quotas use an append-only usage ledger and atomic reservation/finalization to avoid double charging. Scans that fail because of KitchenCam or an upstream provider automatically restore reserved quota. Return `429` with `Retry-After` and remaining-period metadata that does not reveal fraud controls.

Final limits are intentionally unspecified until Phase 0 unit economics are complete and the owner approves them.

## Versioning and provider isolation

Breaking client changes require a new API version or negotiated capability. Additive fields are allowed. Mobile builds send app version/platform, and the server can require a minimum supported version for security reasons.

Provider responses are mapped into KitchenCam contracts inside adapters. Store provider and schema versions with scans, recipes, and nutrition snapshots. Contract tests replay sanitized fixtures so provider changes fail before production.

## Webhook and retry behavior

Verify signatures against the raw body before parsing. Persist event identity and receipt time, acknowledge only after durable write, then process asynchronously when possible. Duplicate events are successful no-ops. Failed events retry with backoff and alert after a bounded threshold. Secrets are rotated with overlap support.
