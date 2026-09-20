# KitchenCam Experience and Design Direction

Status: approved MVP design direction, not implemented.

## Experience principles

1. Camera-first, not camera-only. Capture is obvious, while gallery and manual entry remain discoverable fallbacks.
2. Correction is part of the product, not an error state. AI output is editable and uncertainty is honest.
3. Food and the current task lead. Decorative UI, ads, and secondary metadata stay quiet around scanning and cooking.
4. Safety is legible. Allergens, provenance, serving basis, and estimates use words and icons as well as color.
5. Monetization appears at natural boundaries. Premium is clear, reversible, and never manipulative.
6. Every empty or failure state explains what happened and gives one useful next action.

## Navigation

The locked MVP tabs are Home, Recipes, Saved, Community, and Profile. Nutrition remains within recipe detail. Planner and grocery lists remain version 1.1 and do not appear as dead MVP navigation.

Keep the camera/scan action prominent on Home rather than adding an oversized floating action over every tab. Use native stack behavior, deep links, predictable back navigation, and no more than five persistent destinations.

## Primary flow states

```text
Home
  -> Camera / Gallery / Manual
  -> Uploading and recognizing
  -> Confirm ingredients
  -> Recipe results + filters
  -> Recipe detail
       -> Nutrition
       -> Start cooking / video
       -> Favorite / review / plan
```

Recognition must survive backgrounding and navigation. The confirmation screen preserves edits on network failure. Cooking mode prevents sleep where platform policy permits, uses large controls, and keeps timers and steps available without video.

## Visual direction

The specification calls for a fresh green accent on a dark/neutral foundation and food-first photography. Treat the concept art as structural reference only.

### Design tokens

The restrained green/neutral, food-first direction is approved. These initial semantic values remain implementation tokens rather than final trademark or brand assets:

| Role | Proposal |
|---|---|
| Ink | `#101915` for primary dark surfaces/text |
| Leaf | `#0A8F5A` for primary actions and confirmed states |
| Mint | `#DDF5E9` for quiet positive surfaces |
| Porcelain | `#F7F9F7` for light background |
| Paprika | `#C44822` for food-safety attention, never generic decoration |
| Amber | `#B77900` for estimates/uncertainty |
| Error | `#B42318` with text/icon, not color alone |

The UI/UX skill returned a flat, green food/health direction; its marketing-page pattern was not applicable to a native utility and has been discarded. Final colors must pass contrast testing in both themes. Avoid a one-note green interface: food photography, neutral surfaces, and restrained paprika/amber statuses provide hierarchy.

Use one highly legible humanist sans family initially, with platform/system fallback and full language coverage. The skill suggested Figtree plus Noto Sans; a one-family Noto Sans or system approach is operationally simpler until brand and localization are approved. Do not use tiny nutrition labels, negative letter spacing, all-caps eyebrows, or type that scales directly with viewport width.

Use an 8dp rhythm with 4dp fine increments, restrained radii at 6-8dp, low/no decorative shadows, and semantic light/dark tokens. The memorable visual element should be the live ingredient framing/confirmation language, not ornamental cards. Use a consistent vector icon family and official provider/store marks.

## Screen requirements

### Onboarding and authentication

- Plain explanation of photo processing and account benefits.
- Guest, email, Google, and required Apple options with equal clarity.
- Password managers/paste are never blocked; email OTP errors stay inline.
- Privacy and terms are reachable before consent/account creation.

### Home and camera

- Home opens with an obvious scan action and recent/useful content without hiding camera permission context.
- The active camera viewport is uncluttered; shutter, flash, gallery, close, and framing affordance meet platform touch targets.
- No ad inside the live camera or adjacent to the shutter. If Home includes non-camera content, a banner may appear there only after consent.

### Ingredient confirmation

- Candidate rows show name, uncertainty band, edit/remove controls, and optional quantity.
- Use `likely` and `uncertain` labels rather than model-generated probability percentages.
- Low-confidence items are grouped or highlighted without implying failure.
- Add ingredient and Find Recipes remain stable as text size grows.
- Destructive removal is reversible during the draft.

### Results and filters

- Recipe cards prioritize food image, title, ingredient coverage/missing count, time, and safety-relevant labels.
- Native ads are distinct, labeled, and excluded from organic result count and ranking.
- Filters use a full-height sheet/screen with visible labels, current count, clear/reset, and apply actions. Allergen exclusions remain prominent.
- Empty results suggest widening a specific filter while preserving confirmed ingredients.

### Recipe, nutrition, and cooking

- Recipe detail uses sections/tabs without nesting cards inside cards.
- Available and missing ingredients are visually and semantically distinct.
- Nutrition states serving basis, source, calculated/verified status, and incomplete nutrients.
- Charts have text equivalents and never rely on color alone.
- Cooking mode uses large step text, previous/next controls, timer labels, screen-reader announcements, and reduced motion.
- Video is optional for MVP and never blocks recipe completion. When present, captions, transcript/steps, speed, and controls are accessible.

### Community, profile, and billing

- Reviews show rating distribution, text, sort, helpful action, report, and moderation state. Review photos are deferred to version 1.1, and community features can be disabled remotely if moderation is unavailable.
- Paywall displays live localized price, period, renewal, implemented benefits, restore, terms, and privacy. No free trial is offered initially; no preselected deceptive option or fake urgency is used.
- Subscription settings show entitlement state, renewal/billing issue, manage, and restore.
- Account deletion explains scope and requires recent authentication.

## Async, empty, and error behavior

Every async surface defines initial loading, refresh, empty, partial/stale, offline, error, and success. Skeletons reserve final dimensions. Full-screen spinners are reserved for truly blocking work. Recognition progress is honest and cancellable where possible; never invent a percentage without measurable stages.

Errors use active, specific copy: what failed, whether edits are safe, and what action is available. Example: "The photo uploaded, but ingredient recognition did not finish. Try again; your photo will not be uploaded twice."

## Accessibility requirements

- Minimum targets: 44x44pt iOS and 48x48dp Android, with at least 8dp between adjacent controls.
- Support Dynamic Type/font scaling through the largest practical accessibility sizes without clipped buttons, cards, tabs, charts, or nutrition values.
- Test VoiceOver and TalkBack focus order, roles, names, state, headings, alerts, modal focus, and live progress announcements.
- Maintain 4.5:1 normal-text contrast and 3:1 meaningful non-text/control contrast; verify both themes.
- Do not rely on color, position, gesture, sound, haptics, or animation alone.
- Respect reduced motion; animate only transform/opacity for nonessential motion and preserve spatial meaning.
- Provide non-gesture alternatives for swipe/drag, text alternatives for charts/icons/images where meaningful, and captions/transcripts for video.
- Target Android and iOS phones first. Respect safe areas, system bars, keyboard, and adaptive gutters; use portrait as primary and support landscape where useful for cooking/video.
- Ads have sufficient separation, clear labels, and no focus traps or accidental-tap placement.

## Design validation

Phase 1 implementation uses system type and semantic light/dark tokens in `src/theme/tokens.ts`. The light action green is darkened to `#087447` for white-text contrast; automated contrast tests cover both themes. This is a contrast adjustment within the approved direction. Native accessibility and core-flow usability validation remain open; see `ENGINEERING_FOUNDATION.md`.

Before implementation approval, produce low-fidelity flows for capture/confirm/search/cook/paywall/restore/error states and test them with representative users. Before release, test small phone, large phone, landscape, largest text, reduced motion, light/dark themes, VoiceOver/TalkBack, weak network, one-handed use, and cooking-context glare/wet-hand constraints.
