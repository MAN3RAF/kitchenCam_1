# KitchenCam product definition

Status: simplified MVP scope requested by the owner on 2026-10-01. The previous broad MVP and old Phase G plan are superseded. The review is complete; the owner authorized a documentation checkpoint followed by MVP-1 only.

The current product authority is [MVP_ARCHITECTURE.md](MVP_ARCHITECTURE.md), including the repository audit, status labels, contracts, economics and migration gates.

## ACTIVE MVP

Home → Take a Photo or Enter Ingredients Manually → Generate Recipe → one Result.

Gallery remains a secondary photo option. Results contain supplied/detected ingredients, one dish, a description, optional missing ingredients, estimated time, cooking steps and a YouTube search action. Use a simple native stack with standard Back/Home navigation. No account creation is required; reuse anonymous backend identity.

The app calls a provider-neutral backend operation. Gemini is the initial planned server adapter; the model and future provider are configurable. AI-generated recipes replace the former licensed-catalog-only product requirement. Strict server validation is required, and all provider credentials remain server-only.

The monetization model is one appropriate banner placement plus voluntary rewarded ads for additional generations. Free allowance, credit conversion and limits are server-controlled. Proposed values are 3 introductory generations, 1 credit per verified ad, 2 credits per generation and 5 rewarded ads daily; all await owner review. There are no subscriptions or premium tiers.

## PRESERVED INTERNAL INFRASTRUCTURE

Camera/gallery, physical Android fixes, image preparation, sanitizer, private media cleanup, anonymous/auth foundations, RLS, scan lifecycle fences, idempotency and tests remain reusable. Drafts, revisions, jobs, upload authorizations and provider details must not become product screens. Preserve privacy/deletion access through a small utility entry without a Profile tab.

## DEFERRED / FUTURE

Community, Saved, recipe browsing, Profile, reviews/ratings, social features, subscriptions, premium, nutrition, catalog ranking, planner and groceries are outside the active MVP. YouTube Data API, actual dish imagery and stronger abuse signals are future options. No Gemini/OpenAI calls or ad SDK implementation is authorized by this review.

## OWNER DECISION

MVP-1 navigation/input simplification is approved after the documentation checkpoint. Later phases and proposed economics require separate authorization. Exact model/tier, hosting, spending budget, launch markets and release privacy/safety/consent requirements remain open. Former subscription pricing and licensed-catalog gates no longer block this product's UI simplification.
