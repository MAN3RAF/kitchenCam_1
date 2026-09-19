---
name: kitchencam-mobile-dev
description: Use when planning, building, or reviewing KitchenCam-specific React Native / Expo features, architecture, screens, integrations, or app quality gates. Do not use for unrelated repository maintenance.
---

# KitchenCam Mobile Development

Use this skill for KitchenCam work that affects the mobile app's architecture, screens, feature modules, or production readiness.

## Product Context

KitchenCam identifies ingredients from photos, recommends recipes, and presents nutrition information. It is expected to become a production mobile app using Expo, TypeScript, Expo Router, Supabase, OpenAI API, RevenueCat, and Google AdMob.

## Architecture Defaults

Keep the app feature-oriented. Separate UI, business logic, service/API clients, database access, state management, and types. React components should orchestrate UI and state, not contain large amounts of business logic.

For new features, prefer a narrow vertical slice that includes the needed UI states, typed data contracts, service boundary, and verification path.

## Mobile Quality Gates

For every async user flow, account for loading, error, empty, and success states. For every screen, consider safe areas, keyboard behavior, phone-size variation, touch targets, accessibility labels, and reduced-motion behavior.

Do not hardcode secrets or server-only credentials in client code. OpenAI keys, Supabase service-role keys, RevenueCat secrets, and administrative AdMob credentials must stay server-side.

## Verification

When code exists, run the relevant TypeScript, lint, and test commands before declaring completion. If the project has not been scaffolded yet, state that verification is limited to repository setup or documentation checks.
