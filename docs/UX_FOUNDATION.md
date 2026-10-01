# KitchenCam MVP UX foundation

Status: updated 2026-10-01; target design, not yet implemented. [MVP_ARCHITECTURE.md](MVP_ARCHITECTURE.md) supersedes the former five-tab, browsing and subscription flows.

## ACTIVE MVP navigation

```text
Home → Camera → Preview → Use Photo → Generate Recipe → Result
          └─ Gallery ────────┘
Home → Manual Ingredients → Generate Recipe → Result
Result → Generate another / Home
```

Use Photo prepares locally; Generate Recipe is the explicit backend action. Progress lives within the input flow, not in a separate job-management screen. Preserve current camera teardown/Retake behavior and standard native Back. Result Back returns to the prior input without generating again. A small Home privacy/data-controls link preserves deletion and consent access without a Profile tab.

Home has two primary choices and simple server-derived usage wording. Gallery is a secondary photo option. Manual input supports add/edit/remove with visible labels and nearby validation; no Save/Review/Ready gauntlet. Existing persistence/revision logic can remain internal. No forced signup.

## One Result screen

Name, short description, provided/detected ingredients, optional missing ingredients when present, estimated minutes, numbered steps, Search YouTube, Generate another/Home. Omit dish imagery until real media is available; do not invent nutrition, ratings or a verified video. Search opens an encoded YouTube search query.

Both modes share the same result view. Ingredients/time are estimates where appropriate; invalid provider output never becomes a success view. Show recoverable errors and keep usable input. New generation is always explicit and its usage cost is visible.

## States and accessibility

Loading has honest progress and duplicate-submit protection. Empty input explains the next action. Errors provide one clear recovery route. Success shows the validated result. Offline allows local editing/preview or viewing an already loaded result, while generation requires connectivity. Unknown server outcomes retain the operation key and show pending status instead of charging again.

Reuse semantic colors/type, reduced-motion hooks and accessible feedback. Check large text, screen-reader order/announcements, keyboard avoidance, safe areas, 48dp Android/44pt iOS targets and device Back. Leaving progress is not a promise of cancellation. Preserve identity-change and file cleanup behavior.

## Ads — design now, implementation DEFERRED

One Home-only banner in reserved layout space, separated from controls by a non-clickable zone and from device navigation by safe insets. No overlay or stacked banner. Hide on keyboard, camera, preview, editing, progress, Result and reward overlays. Layout must remain usable on small screens and at large text sizes.

Rewarded ads are voluntary one at a time. Explain the real server-configured reward and remaining ad count before each ad; never auto-show or auto-chain. SDK completion shows pending verification; only verified backend credit is spendable. Dismissal/no-fill offers recovery without losing prior earned progress.

## PRESERVED / DEFERRED

Keep camera/gallery/preparation, manual editing, auth/privacy and security controls. Hide Community, Saved, Recipes browsing, Profile and draft-management screens. Ratings/reviews, social features, subscriptions/premium, nutrition and video API integration remain deferred. The current code still has old routes; changing this document does not remove them.
