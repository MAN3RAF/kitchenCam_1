# Phase 1 Mobile Engineering Foundation

Scope authorized: mobile initialization, navigation shell, design system, configuration boundaries, quality tooling, and tests. Phase 0 is not closed. This document records implementation choices, not new product decisions.

## Compatibility decision

Checked 2026-09-19 against official Expo documentation, the published `expo-template-blank-typescript@57.0.26` and `expo-template-default@57.0.26` manifests, and `expo@57.0.24/bundledNativeModules.json` before dependency installation.

- Expo `57.0.24`, React Native `0.86.3`, React/React DOM `19.2.3`.
- TypeScript `~6.0.3`, strict mode plus unchecked-index, override, unused-code, and switch checks.
- Node `24.19.0` and pnpm `11.19.0`; one committed lockfile and hoisted install layout. This is a single application, not a multi-package architecture.
- Expo modules follow the SDK's compatibility map, not unrelated latest majors.
- Metro `0.86.3` and Worklets `0.10.1` constraints prevent automatic transitive peer resolution selecting incompatible native versions. No application animations depend on Worklets.
- Jest `29.7`, `jest-expo@57`, RN Jest preset `0.86.3`, RNTL `14.0.1`, and `test-renderer@1.2.0` match the React 19.2 reconciler. The latest renderer 1.3 targets a later React line, so it is intentionally excluded.
- ESLint 9 is retained because Expo's current React/import plugins declare ESLint 9 compatibility, not 10. Its upstream deprecation warning is tracked; update with a verified compatible Expo lint stack.
- The installed SDK 57 Router exposes `unstable-native-tabs`; the latest documentation also shows a newer `native-tabs` entry point. Use the installed API until an intentional SDK upgrade.

Sources checked 2026-09-19:

- https://docs.expo.dev/versions/latest/ (compatibility and OS matrix)
- https://expo.dev/changelog/sdk-57 (stable release and fixes)
- https://docs.expo.dev/router/installation/ (Router setup)
- https://docs.expo.dev/router/advanced/native-tabs/ (native navigation)
- https://docs.expo.dev/develop/unit-testing/ (Jest and RNTL)
- https://docs.expo.dev/guides/using-eslint/ (lint/format)
- https://docs.expo.dev/guides/environment-variables/ (public inlining)
- https://docs.expo.dev/versions/latest/sdk/network/ (connectivity limitations)
- https://registry.npmjs.org/expo-template-blank-typescript/57.0.26
- https://registry.npmjs.org/expo-template-default/57.0.26

SDK minimums are Android 7+ and iOS 16.4+; these are technical constraints, not an owner-approved launch device matrix. Windows cannot produce a local signed iOS build. Final application identifiers, organization signing, EAS project/profile setup, and device validation remain deployment work.

## Implemented structure

```text
app/                         Thin route exports and native layout composition
  (tabs)/                    Five tab destinations, each with its own stack
    (home)/                  Root URL /
    recipes/                 /recipes
    saved/                   /saved
    community/               /community
    profile/                 /profile
  +not-found.tsx             Recovery for unknown links
src/
  components/                Text, Button, Screen, and feedback states
  features/                  Home, recipes, favorites, community, profile shells
  services/                  Native connectivity adapter only
  hooks/                     Connectivity subscription and reduced-motion settings
  lib/                       App-level providers
  types/                     Shared connectivity contract
  constants/                 Approved tab metadata
  config/                    Strict allowlisted public environment validation
  navigation/                Native tabs/stacks, web preview, route recovery
  theme/                     Semantic colors, typography, spacing, layout, radii
tests/                       Behavior and boundary tests, outside app/
tooling/                     Build-only client boundary policy
.github/workflows/           Credential-free quality checks
```

The original mobile foundation added no provider stubs, generated recipes, scan quotas, or entitlements. Subsequent auth/backend work added sessions and account clients. Phase C adds `app/scans/` and `src/features/scans/` for the real manual ingredient workflow; Phase D adds local-only capture under `app/scans/` and `src/features/capture/`. Photo preparation, upload, and recognition remain unavailable; camera access is requested only after the user chooses Camera.

## Route reservations

The root native Stack hosts flows independently of tab stacks. Implemented paths and remaining reservations are:

| Future route | Placement / responsibility |
|---|---|
| `(auth)/sign-in`, `(auth)/verify`, `(auth)/callback`, `(auth)/review-preferences`, `(auth)/delete-account` | Implemented local email/guest/account lifecycle routes; social sign-in remains deferred |
| `scans/index`, `scans/camera`, `scans/gallery`, `scans/preview`, `scans/manual`, `scans/[id]/index`, `scans/[id]/confirm`, `scans/[id]/ready` | Implemented Phase C manual and Phase D local capture journeys in a root stack; Home is the primary entry; no persistent scan tab |
| `scans/[id]/results` | Future recipe behavior; no route or active link |
| `recipes/[id]`, `recipes/[id]/nutrition`, `recipes/[id]/cook` | Shared root stack; open from Recipes/Saved/Community; preserve return route |
| `settings/index`, `settings/privacy` | Root stack, future Profile entry |
| `subscription/index`, `subscription/restore` | Root modal stack; purchases remain account-optional |

Validate every future link parameter at the feature boundary. Auth callbacks must use a dedicated allowlist. Current unknown paths show a recovery screen. No fake callback handling or silent redirects into authentication exist.

## UI and accessibility

Use semantic light/dark colors and system typography, the approved 4dp spacing scale, 6/8dp radii, and flat surfaces by default. The light primary action is `#087447` so white normal text passes 4.5:1; Leaf remains design input rather than a compulsory text pair. Tests check normal text, action states, status text, and meaningful borders/focus rings in both themes.

Buttons have at least 48dp targets, visible focus and pressed states, disabled semantics, and wrapping/scalable labels. Native screens use stack headers and platform navigation focus behavior. Scrollable content handles safe areas and keyboard insets. Native tab icons use system symbols; in-content and browser-preview icons use individually imported Lucide icons.

Reduced-motion settings update live; stack transitions are disabled and loading remains readable without an animated spinner. Loading, empty, retryable error, and actual device-offline patterns are available. Unknown network status is not converted to offline; device connectivity is not proof that a future API is reachable.

Native VoiceOver/TalkBack, focus restoration, modal focus, largest system text, keyboard, and device safe-area checks remain mandatory. Browser/component verification cannot close those gates.

## Environment and security

`EXPO_PUBLIC_APP_ENV=development|staging|production` plus an optional paired Supabase URL/publishable key are allowlisted. The publishable key is intentionally distributable and carries no service authority; service-role credentials are prohibited. No production identifiers are required. Expo build configuration uses explicit fields and environment-specific names/schemes; it never spreads environment values into `extra`.

Unknown `EXPO_PUBLIC_*` names fail configuration/bundling without logging their values. The build allowlist also recognizes Expo CLI's internal `EXPO_PUBLIC_FOLDER`, `EXPO_PUBLIC_PROJECT_ROOT`, and `EXPO_PUBLIC_USE_RN_FETCH` names; application code cannot read them through the validated public configuration. Zod validates the client boundary and fails with a safe error. Lint disallows direct environment access elsewhere. Metro rejects local `server/`, `supabase/`, `tooling/`, `.env*`, `*.server.*`, and app-config imports after resolution. These guardrails supplement review; they do not make a distributed app a trusted environment.

Future server-only configuration belongs to independently deployed backend functions/workers, outside `src/`, and to their secret managers. Future public service identifiers require a reviewed allowlist/schema change. `.env*` is ignored except `.env.example`; native signing files, local service files, caches, build outputs, and generated route types are ignored.

Supabase Auth session persistence uses platform SecureStore on native and session storage in the web development preview. Phase C introduces TanStack Query for manual scan reads, plus account-scoped in-memory editors for temporary input and conflict recovery. Server acknowledgements alone establish saved/confirmed state. UUID generation uses the SDK-compatible Expo Crypto module. Zustand and disk-persisted scan caches remain absent. No offline recipe availability is implied.

## Validation commands

`pnpm check` runs TypeScript, ESLint, Prettier, Jest component/unit tests, and Node build-boundary tests. `pnpm deps:check` uses Expo's SDK compatibility check. `pnpm run doctor` runs Expo diagnostics. `pnpm export:check` compiles Android, iOS, and web bundles; exports are ignored, not committed. CI runs these on pull requests and main with read-only repository permissions and no production secrets.

Tests cover invalid configuration without value leakage, disallowed client imports, public app-config output, contrast, accessible disabled buttons and recovery, reduced-motion loading, and connectivity-event races/unsubscription. E2E/device automation will be added when native clients and meaningful workflows exist. No placeholder tests assert fake production behavior.

## Deferred gates

All Phase 0 evidence gaps and the seven owner decisions in ROADMAP.md remain open. The separately approved local Supabase/auth foundation is recorded in `BACKEND_FOUNDATION.md`; it does not change those gates. Telemetry, purchases, ads, AI, nutrition, recipes, community, remote Supabase, and production credentials remain absent. Broader Phase 1 exit criteria, including signed native builds, hosted CI evidence, and runtime RLS/storage/auth tests, are not declared passed by local static checks.
