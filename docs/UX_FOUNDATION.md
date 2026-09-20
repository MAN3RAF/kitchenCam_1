# KitchenCam UX Foundation

Status: approved Phase 0 low-fidelity baseline; Phase 1 shared primitives and the five-tab shell are implemented. Core-flow prototypes and representative-user validation remain open.

Checked: 2026-09-19

## Design rationale

KitchenCam is an adult food utility used in kitchens, often one-handed, under glare, with interrupted attention. The interface should feel calm, direct, and food-first. The memorable interaction is the movement from photographed objects to an editable ingredient list, not decorative chrome.

The installed UI/UX skill was queried for a native food utility and React Native guidance. Its useful recommendations were minimal functional structure, subtle motion, typed navigation, explicit loading, 44pt/48dp touch targets, 8dp target spacing, accessible authentication, announced errors, and recovery actions. Website hero, claymorphism, restaurant-display typography, and generic blue palette results conflict with the approved native direction and were rejected.

## Information architecture

| Tab | Primary content | Child destinations |
|---|---|---|
| Home | Scan action, gallery/manual fallback, recent scans/results | Camera, upload/recognition, ingredient confirmation |
| Recipes | Search, ingredient-based results, filters | Recipe detail, nutrition, cooking mode, optional video |
| Saved | Favorites and collections | Saved recipe detail |
| Community | Rating distribution, text reviews, reporting entry | Review detail/editor, report flow; remotely disableable |
| Profile | Account, preferences, Premium, privacy, support | Auth/linking, paywall, restore, subscription management, data controls |

Planner, grocery lists, review photos, and offline recipes do not appear in MVP navigation.

## Low-fidelity flows

### Camera to recipe

```text
Home
  [Scan ingredients]
  [Choose photo] [Enter manually]
       |
Camera permission rationale -> Camera
       | capture/retake
Local EXIF removal + resize
       |
Uploading -> Queued -> Recognizing
       | background-safe; cancel/status available
Ingredient confirmation
  likely: tomato, eggs
  uncertain: red pepper?  [edit] [remove]
  [+ Add ingredient]
       |
Recipe results -> Filters -> Recipe detail -> Start cooking
```

The user always confirms or edits ingredients before matching. Recognition progress uses real stages, never fabricated percentages. A provider/KitchenCam failure keeps the photo/result state needed to retry and states that quota was restored.

### Guest and account linking

```text
Explore as guest -> save/history locally + anonymous backend identity
  -> account-required action
  -> Email OTP / Google / Apple where required
  -> explicit merge review if conflicts exist
  -> merged favorites/history + permanent verified community identity
```

### Purchase and restore

```text
Paywall -> live monthly/annual offerings -> store purchase
  -> pending/success/failure -> entitlement refresh

Profile/Paywall -> Restore purchases -> checking store
  -> restored / nothing found / signed into different store account / retry
```

No KitchenCam account is required to purchase. Account linking is encouraged for cross-device continuity.

### Community safety

```text
Recipe -> Community -> write review
  -> require permanent verified account
  -> rating + text -> validation -> submitted/pending/published
  -> report -> reason -> confirmation

Remote kill switch -> read-only notice or Community unavailable
```

## Semantic design tokens

Tokens describe intent; components never depend directly on raw colors.

| Group | Initial tokens |
|---|---|
| Surfaces | `background`, `surface`, `surface-raised`, `scrim` |
| Text | `text-primary`, `text-secondary`, `text-disabled`, `text-inverse` |
| Actions | `action-primary`, `action-primary-pressed`, `focus-ring`, `link` |
| Status | `status-success`, `status-warning`, `status-danger`, `status-info`, each with surface/text/icon variants |
| Borders | `border-subtle`, `border-strong`, `divider` |
| Food/media | `media-placeholder`, `media-scrim`, `ingredient-likely`, `ingredient-uncertain` |

The approved light-direction seeds remain Ink `#101915`, Leaf `#0A8F5A`, Mint `#DDF5E9`, Porcelain `#F7F9F7`, Paprika `#C44822`, Amber `#B77900`, and Error `#B42318`. They are candidates, not automatic foreground/background pairs. Every pair must pass contrast in light and dark themes before implementation.

Use radii 6dp and 8dp; reserve larger shape only for a platform-native sheet. Avoid decorative shadows, nested cards, gradient decoration, and one-note green surfaces.

## Typography

Start with the platform system sans stack for performance, Dynamic Type, and script coverage. Evaluate a bundled humanist sans only after brand and font licensing review. Use semantic styles rather than fixed component sizes:

| Style | Baseline size/line | Use |
|---|---|---|
| Display | 32/38 | Rare top-level moment only |
| Title | 28/34 | Primary screen title |
| Heading | 24/30 | Main section |
| Subheading | 20/26 | Subsection/card title |
| Body | 16/24 | Primary reading/action text |
| Supporting | 14/20 | Secondary metadata |
| Caption | 12/16 | Nonessential labels only, never safety/action content |

Weights are regular, medium, and semibold. Letter spacing is zero. Support platform font scaling without truncating actions or safety text; line limits are forbidden for essential instructions.

## Spacing and layout

Use a 4dp base scale: `4, 8, 12, 16, 24, 32, 40, 48`. Standard screen gutters begin at 16dp and may become 24dp on large phones. Adjacent controls have at least 8dp separation. Stable image aspect ratios and list-row minimum heights prevent layout shift.

Portrait is primary. Camera framing adapts to device cutouts; recipe/cooking/video can use landscape with persistent step/timer access. Respect safe areas and keyboard insets. Prefer native stack/tab behavior and virtualized recipe/community lists.

## Component categories

- Foundations: text, icon, image, divider, surface, status label.
- Actions: primary/secondary/destructive buttons, icon button with accessible name, link, segmented control.
- Inputs: text field, OTP field, search, checkbox/toggle, unit/quantity controls, filter row.
- Navigation: native tab, stack header, back action, sheet, section tabs.
- Feedback: skeleton, inline progress stage, banner, alert, toast for noncritical confirmation, retry block.
- Food domain: ingredient row, uncertainty label, recipe result, nutrition table, allergen status, cooking step, timer.
- Commerce/community: offering row, entitlement status, review, rating input, report form, labeled native ad.

Prefer explicit variants and composition over accumulating boolean props. Business rules, provider DTOs, and asynchronous orchestration stay outside visual components.

## State matrix

| Surface | Loading | Empty | Error | Offline/stale |
|---|---|---|---|---|
| Home/history | Reserved skeleton rows | Scan invitation | Retry recent content | Cached history with stale label |
| Recognition | Measured stage text | Not applicable | Retry/cancel; quota-restored message when applicable | Explain connection need; preserve local photo until policy timeout |
| Confirmation | Restore saved draft | Manual add prompt | Preserve edits, retry save | Editable draft; matching waits for network |
| Recipe results | Stable card skeletons | Specific filter relaxation | Retry provider; keep ingredients/filters | No offline promise; show any stale metadata only if license permits |
| Recipe detail | Section skeleton | Content removed/unavailable | Retry or return to results | State that full recipe needs connection |
| Saved | Skeleton | Save recipes prompt | Retry | Cached identifiers/metadata only as licensed |
| Community | Skeleton | First-review invitation | Retry/report support path | Read-only cached content only if permitted; no queued public post by default |
| Paywall/restore | Store-loading state | Offerings unavailable | Typed purchase/restore recovery | Purchasing unavailable; existing entitlement uses last verified grace policy |

Errors are announced to assistive technology and placed near the failed action. Empty states contain one useful next action. Skeletons reserve final dimensions.

## Accessibility acceptance criteria

- Minimum targets are 44x44pt on iOS and 48x48dp on Android, with 8dp spacing where adjacent.
- Normal text contrast is at least 4.5:1 and meaningful controls/non-text indicators at least 3:1.
- VoiceOver/TalkBack names, roles, values, state, heading order, modal focus, and live recognition/error announcements are tested.
- Color never carries likely/uncertain, allergen, missing ingredient, rating, or nutrition completeness alone.
- Email OTP permits paste/autofill and authentication never depends only on a cognitive test.
- Reduced motion removes nonessential transitions; essential spatial change remains understandable.
- Every gesture has a visible alternative. Video has captions/transcript or is omitted; it never blocks cooking.
- Largest practical accessibility text, small/large phones, landscape cooking/video, glare, weak network, and one-handed use are acceptance cases.

## Validation before implementation

Create clickable low-fidelity prototypes for scan-confirm-results-detail-cook, guest-linking, paywall/restore, and failure/offline states. Test with 5-8 representative adults, including screen-reader and large-text users where possible. Measure task completion, mistaken ingredient confirmation, recovery comprehension, accidental ad taps, and whether users understand unknown nutrition/allergen states.

## Skill inputs

- `frontend-design`: subject-specific restraint, typography discipline, purposeful motion, plain recovery copy.
- `ui-ux-pro-max`: native touch targets, target spacing, loading/error feedback, accessible auth, predictable navigation.
- `react-native-skills`: native navigators, safe-area behavior, virtualized lists, stable images, reduced-motion/performance constraints.
- `composition-patterns`: explicit variants and composable state interfaces for future design-system APIs.
