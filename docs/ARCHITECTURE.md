# KitchenCam technical architecture

Status: revised 2026-10-01 for the simplified MVP. [MVP_ARCHITECTURE.md](MVP_ARCHITECTURE.md) is the authoritative design and migration plan. The old Phase G sequence is stopped; this review changes documentation only.

## ACTIVE MVP architecture

```text
Expo Router native stack
  → feature screens/controllers
  → generateRecipe(manual ingredients | opaque photo reference)
  → authenticated KitchenCam backend
  → validation + durable operation + usage reservation
  → approved image resolution when needed
  → RecipeAIProvider selected by server configuration
  → strict RecipeResult validation
  → atomic result persistence and usage settlement
  → shared Recipe Result screen
```

Keep the existing feature-oriented React Native/Expo/strict TypeScript application. Routes compose screens; components do not own AI transport or credit math. Use the existing auth/session, connectivity, TanStack Query and semantic UI foundations. Add only a narrow generation feature/service boundary. No provider-specific code, SDK or secret belongs in mobile imports.

The server selects `AI_PROVIDER` and `AI_MODEL`. The neutral port supports ingredients and approved images; each adapter maps to the same strict result. A provider switch that preserves that contract needs no mobile rewrite. Keep provider/model/prompt diagnostics private. Initial Gemini selection is a product direction, not an implemented integration or approved model.

## PRESERVED INTERNAL INFRASTRUCTURE

Supabase Auth/Postgres/private Storage remain the backend foundation. Preserve owner checks/RLS, local account lifecycle, secure session storage, scan idempotency, revision/lease fences, immutable approved sanitizer artifacts and cleanup inventory. Reuse bounded camera preparation and the isolated Node/Sharp sanitizer; Edge Functions remain appropriate for lightweight coordination, not unrestricted image decoding.

The existing sanitizer queues recognition and its completion produces an ingredient-confirmation draft. The new recipe coordinator needs an explicit additive handoff; hiding the old screens is insufficient. See the migration section of the MVP document before changing any scan RPC.

Uncommitted upload ingress and client wiring were present at review start. They remain stopped, unvalidated candidates for later selective reuse. Do not deploy or assume that work passes the Phase F security gates. These files are isolated on local branch `archive/stopped-phase-g-20261001` and excluded from main. Historical reports describe their dated checkpoints.

## Usage and ads

Server transactions reserve free usage/credits, prevent double debits, settle only a validated persisted result and release failed operations. A usage endpoint returns safe configuration and derived display values. Future reward grants require verified server evidence and replay protection. Client caches only display/recovery state.

AdMob is a later adapter behind consent, placement and feature gates. One Home banner, separated from controls and safe insets; rewarded ads require explicit choice for every ad. No subscriptions/RevenueCat, browsing, social domain or nutrition service is needed for the MVP.

## Validation and release limits

Retain existing tests and recorded evidence. Camera behavior is validated only for the device/scenarios in [ANDROID_DEVICE_TESTING.md](ANDROID_DEVICE_TESTING.md); hosted sanitizer/cleanup, broader device coverage and live recipe quality remain release gates. The new recipe contract, accounting and provider integration are proposals, not verified implementations.
