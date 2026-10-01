# KitchenCam delivery roadmap

Status: reset by owner request on 2026-10-01. **STOP the old Phase G plan.** No Gemini, OpenAI, ads, subscriptions, community or browsing implementation is authorized by this review. The owner subsequently approved a documentation-only checkpoint and push, followed by MVP-1; later phases remain unauthorized.

[MVP_ARCHITECTURE.md](MVP_ARCHITECTURE.md) is the current scope and architecture authority. Only MVP-1 is authorized after the clean documentation checkpoint is pushed. Later phases require separate authorization.

## Current checkpoint

- **ACTIVE MVP, planned:** Home → photo/manual input → Generate Recipe → one shared Result, simple stack navigation and provider-neutral backend.
- **PRESERVED INTERNAL INFRASTRUCTURE:** camera/gallery, native preparation, Android repairs, auth/anonymous identity, scan lifecycle/security, local sanitizer and tests.
- **Stopped work in progress:** old Phase G upload ingress, migration, client wiring/config and test/tooling files, isolated on local archive branch `archive/stopped-phase-g-20261001`. Review selective reuse later. No claim that this dirty work is validated.
- **Evidence:** [Phase B](research/SCAN_PHASE_B.md), [Phase C](research/SCAN_PHASE_C.md), [Phase D](research/SCAN_PHASE_D.md), [Phase E](research/SCAN_PHASE_E.md), [Phase F](research/SCAN_PHASE_F.md), [Android device testing](ANDROID_DEVICE_TESTING.md). Reports describe their dated scope and remaining gates. Phase F local validation exists; older statements that Phase F has not begun are obsolete.
- **Not implemented:** live recipe generation/provider, new usage ledger/economics API, AdMob SDK or verified rewarded-credit flow.

## Approved next: MVP-1, navigation and input simplification

After the documentation checkpoint is pushed, replace the active five-tab composition with Home and native stack flows. Keep camera/gallery/preparation intact, simplify the manual editor, hide unavailable tabs and draft-management steps, and preserve privacy/deletion access and auth callbacks. Introduce a small provider-neutral recipe client boundary with honest unavailable states until backend work lands. Shared result fixtures are only for tests/development.

Inspect the stopped upload wiring before route edits so it is neither silently accepted nor destroyed. No old Phase G implementation, AI SDK, ads, migrations or provider calls belong in MVP-1.

Exit: two Home actions; normal Back/Home and safe legacy deep links; retained manual input and camera lifecycle; no deferred product destinations; loading/error/empty/success coverage with explicitly marked test success fixtures; TypeScript/lint/relevant tests and physical Android camera/Retake regression checks. Do not claim a working end-to-end generation feature yet.

## MVP-2, contracts and server-authoritative accounting

Implement strict manual/photo and recipe contracts, the generation coordinator, usage/config endpoint and transactional reservation/debit/release ledger with a deterministic test adapter. Validate idempotency, concurrency, stale configuration, provider failure/timeout, process restart and account deletion/merge. Keep real providers and ads disabled.

## MVP-3, minimal photo transport and initial AI adapter

Review the stopped ingress candidate and reuse only validated pieces. Preserve sanitizer limits and immutable artifact fencing; adapt the recognition-only handoff deliberately. Prove hosted cleanup/scheduling/runtime behavior. Select a Gemini model/tier after quality/cost review; implement only its adapter behind the neutral port. Both input modes return the same result and use the same accounting.

Exit: real manual/photo-to-result flow, malformed response rejection, safe retry/refund semantics, measured latency/cost and food-output quality, global spending gate, device/weak-network/restart coverage. Exact model, hosting and budget are **OWNER DECISION**.

## MVP-4, banner/rewarded ads and release hardening

Separately authorize AdMob integration. Add a single separated Home banner and explicit voluntary rewarded flow, signed server verification, replay protection, consent handling and remote economics/switches. Use test ads in development. Verify daily capacity, config-change promises, no-fill, delayed callbacks, safe areas/keyboard, accessibility and test-device behavior before enabling.

Proposed initial economics: 3 lifetime free generations, 1 credit per verified ad, 2 credits per generation, 5 rewarded ads/day and 5 successful generations/day. These are configurable **OWNER DECISION** values, not profitability claims. No subscriptions.

## Retirement and deferred work

Retire unused tab/placeholder screens only after migration/deep-link checks. Do not drop backend/security code, historical migrations or tests merely because their details are hidden.

**DEFERRED:** Community, Saved, browsing, Profile/social profiles, ratings/reviews, subscriptions/premium/RevenueCat, nutrition expansion, recipe catalog ranking, planner/groceries and YouTube Data API. **FUTURE:** alternative AI adapters, optional imagery/video resolution and evidence-led anti-abuse improvements. Licensed catalog contracts and subscription pricing are no longer prerequisites for MVP-1.

## Release gates retained

Provider evaluation and failure handling; bounded request/worker resources; server-only keys; RLS/owner isolation; cost/rate/concurrency limits; media cleanup and account lifecycle; privacy/consent and food-output review appropriate to launch markets; accessible native behavior and Android/iOS scope validation. Exact markets, model, budget, hosting, economics and retention require owner decisions. Historical recipe/subscription economic estimates are not current defaults.

Stop after MVP-1 for owner review. Do not begin MVP-2, AI integration or ads.
