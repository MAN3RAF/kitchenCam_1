# Phase C — Manual Ingredient Journey

Date: 2026-09-22. Scope: manual entry, real Phase B persistence, explicit confirmation, Ready, and recovery only. No camera, gallery, image upload, AI, recipe behavior, or Phase D implementation.

Starting HEAD: `068c994701a1641910ebc16408923833f0ab33c7` (`feat: establish scan lifecycle foundation`), branch `main`. Initial inspection found seven modified tracked files and nineteen untracked Phase C files. The owner explicitly authorized reviewing and continuing that existing work. Nothing was discarded, staged, committed, or pushed.

## IMPLEMENTED + TESTED

### Journey and routes

| Route | Behavior |
| --- | --- |
| `/scans` | Home's **Add ingredients** destination; honest photo-unavailable notice, manual entry, paged owner lists, draft/confirmed resume |
| `/scans/manual` | Explicit lazy guest provisioning if needed, then idempotent creation of an empty manual draft |
| `/scans/[id]` | Load by validated UUID; add, rename/cancel rename, remove, select/deselect, reorder, save, and review |
| `/scans/[id]/confirm` | Selected ingredients, explicit confirmation of the saved draft, empty/duplicate/dirty/conflict/offline guards |
| `/scans/[id]/ready` | Reconstruct selected confirmation from backend state; Edit and Done; edited drafts show that confirmation is needed |

Routes contain scan IDs only. The manual start route never auto-creates on mount. Creation retries reuse one UUID/body during the account session. A successful attempt is reused until the user explicitly starts another list. `/results` is not implemented or linked. The UI says photo recognition and recipe suggestions are unavailable; it requests no permissions or media access.

### Components, state, and service boundaries

`src/features/scans/` contains the five screen implementations, `IngredientRow`, shared account/load/summary components and route-focus guard, the domain schemas, `ScanEditor`, `ScanSession`/`ScanProvider`, and `createScanService`. Route files remain thin. Home, the root stack, and app providers connect the flow. Shared `TextField` accepts an input ref for focus; shared `Screen` includes bottom safe-area padding.

TanStack Query `5.103.2` manages server reads per account. Expo Crypto `~57.0.3` provides UUIDs. No Zustand, AsyncStorage, disk cache, synchronization queue, or new design system was added. Each account scope owns temporary editors and a query client; queries have no automatic retries or disk persistence. Screen focus, app foreground, reconnect, and session/user refresh invalidate/refetch server state. Web keeps its browser focus behavior.

### Ingredient behavior

- New rows have UUID identity and `manual` provenance; detection, normalized, and canonical fields remain null, and newly entered quantities are null. Existing Phase B manual quantity objects are accepted and preserved when a list is loaded and edited.
- Add/update trims leading/trailing whitespace, rejects blank input, counts Unicode code points against the server's 120-character limit, and caps the list at 50. Unsupported NUL/unpaired-surrogate input receives a safe error without losing the typed value.
- Rename, selection, and up/down ordering preserve row identity. Array order is persisted by the existing backend contract. Removing an actively renamed row retains the pending text as an addable name.
- Similar names remain separate. Selected trim/case matches require explicit rename, removal, or deselection before confirmation; the backend remains authoritative for duplicate/Unicode semantics.
- Add/save/confirm use synchronous guards against rapid repeats. The editor requires unapplied text to be addressed before saving/confirming. Cancel rename is an explicit discard of that pending rename.
- Status copy distinguishes unsaved changes, saving, server-acknowledged saved state, uncertain acknowledgement, and conflict. Raw revision numbers and internal errors are not displayed.

### Persistence and confirmation

The mobile service uses only the public publishable key and the current owner's JWT. Owner reads select explicit fields from `scans` under existing forced RLS. Creation uses `create_scan`; all draft writes and confirmation use `mutate_scan`. There are no direct table INSERT/UPDATE/DELETE operations. JSON responses are projected through strict manual schemas before entering feature state.

Draft saves submit the full list with the expected overall and draft revisions. Confirmation submits the expected overall version and exact draft revision; it never sends a client-authored confirmation snapshot. At least one valid selected row is required. The server creates the durable selected-only snapshot. Navigation to Ready follows acknowledgement, and a second confirm after acknowledgement returns the already confirmed state without another mutation.

Editing a confirmed list begins locally. Its last confirmed snapshot stays valid until the user saves the revised draft. The existing backend then advances the revision and clears confirmation, requiring another explicit confirmation. Ready can be loaded directly or remounted from its UUID and reads that authoritative state.

Every request has a 20-second whole-operation deadline covering auth/session token retrieval, SDK preparation, transport, and response handling. The transport signal is aborted when the deadline expires, while the operation promise returns a safe timeout error even if token retrieval never settles. SDK and query automatic retries are disabled for this adapter; retry is explicit. A timeout does not establish whether a write committed. The editor retains the exact UUID, request body, and expected revisions, freezes that operation, and retries it unchanged. Phase B authorizes first, replays an identical operation before stale-version rejection, and returns current state. If that replay returns a newer draft than the submitted one, the UI enters reconciliation instead of claiming the local draft was saved.

### Conflicts and recoverable input

A real stale edit or confirmation returns `VERSION_CONFLICT`; the controller keeps local rows and requests the latest server snapshot. It never rebases and overwrites automatically. The user can save the local list separately or explicitly use the latest saved list. Using latest retains each prior local list in a separate session recovery entry. Repeated conflicts do not replace earlier recovery entries. Pending name input stays in the editor; a pending rename becomes addable text rather than silently overwriting a newly fetched row.

Separate-list creation binds its own UUID to an immutable list. Lost acknowledgements expose **Retry separate save** and block changes until that attempt is reconciled. Successful copies are reused on repeated taps. A current conflicting list is never substituted with an older recovery list. Unapplied current input blocks leaving via the current-list copy action and explains how to recover it.

### Offline, remount, and session behavior

The existing connectivity provider treats only a known offline state as offline. Unknown connectivity still permits an attempt; actual transport results determine availability. Offline users may edit an already loaded list. Creation, saving, and confirmation require connectivity and never report success without acknowledgement.

Temporary edits and input survive navigation/remount within the same account session. A failed background read leaves the editor visible with a stale-read notice and retry. An offline remount can recover an editor already held in memory. An authorization/not-found failure hides previously loaded contents instead of displaying a cached Ready screen.

Persisted state survives a new editor/client and refreshed/restored auth session because the backend owns it. A cold start needs connectivity to load a list. Unsaved text, recovery entries, and pending operation keys are intentionally memory-only; the editor explicitly warns that unsaved work does not survive restart. After an ambiguous write followed by process loss, reload the saved list/history to inspect server state; no write is automatically replayed with a fresh key. An interrupted creation may leave a saved empty draft discoverable in history. A confirmed cancelled or expired scan is terminal: it hides cached editable contents, explains that the list cannot be edited, and offers navigation back to Ingredients without a retry action.

Anonymous owners can create, edit, confirm, and read their lists. Another real user cannot read/mutate them. A same-ID anonymous-to-permanent email OTP upgrade preserves the existing list and confirmation and permits subsequent editing through the same adapter. Account switching/sign-out fences late navigation, disposes editors, and clears query data. Requests cannot borrow a different account's token. Strict Mode effect reconnects do not dispose a live editor. Existing native SecureStore/web-preview session persistence remains unchanged.

### Accessibility and privacy

The flow reuses semantic light/dark tokens, scalable system typography, wrapping controls, 48dp minimum targets, and existing native stack headers. Checkboxes expose checked/disabled states and ingredient position, with visible Selected/Not selected text and a checkmark. Row actions have ingredient-specific labels; reorder has button alternatives. Fields have visible labels, invalid state, and understandable inline validation. Save progress and counts use live regions; errors use alert semantics. Input refs support focus after add, rename, cancel rename, and remove. Scroll containers retain the existing keyboard inset/tap behavior and now include explicit bottom safe-area clearance. Reduced-motion settings disable stack transitions; no scanning animation was added.

Ingredient text is rendered as text only. It does not enter URLs, analytics, crash metadata, application logs, or raw error messages. No telemetry SDK was added. No internal service RPC, private table, image path, capability, or service credential is exposed. Processing admission and Storage policies are unchanged.

### Tests

- `tests/scan-phase-c.test.ts`: domain/controller behavior, limits, identity, ordering, selection, duplicate handling, input retention, offline mutation guards, locking, uncertain retry, revision acknowledgement, multi-conflict recovery, separate-copy replay, unsupported Unicode, disposal, quantity projection/rejection, and bounded transport/token timeout.
- `tests/scan-phase-c-ui.test.tsx`: Home/manual entry, empty/validation states, editing/reordering/removal, checkbox semantics, save errors, offline controls, explicit confirmation, zero selection, Ready reconstruction, remount input, denied access, conflict choice, failed-refresh retention, terminal cancellation cache handling, offline remount, creation deduplication, pending-save confirmation guard, cancel rename, and real provider account-scope/Strict Mode behavior.
- `tests/scan-phase-c-runtime.test.cjs`: eleven loopback-only tests running the actual mobile service and controller against real PostgREST/RPCs. Covers the complete ordered manual journey and reopening; quantity round-trip through an edit; terminal server cancellation; stale save/confirmation; lost save/confirm acknowledgements; duplicate creation and server validation; owner/session isolation; offline nonmutation; newer-state replay; lost recovery-copy acknowledgement; and a real email OTP same-ID upgrade.

UI unit tests isolate the service boundary; they are not evidence of SQL semantics. The runtime suite transpiles the actual adapter/controller and uses real owner sessions, database validation, idempotency, revision checks, and confirmation. Only the transport acknowledgement is deliberately dropped in the lost-response tests. Existing backend/account suites remain intact. CI now includes `backend:test:manual`.

### Validation

All commands use pinned Node `24.19.0` and pnpm `11.19.0` through `fnm exec --using 24.19.0 pnpm`.

| Check | Result |
| --- | --- |
| `check` | TypeScript, ESLint (zero warnings), repository formatting, 81 Jest tests / 9 suites, and 8 static security/boundary tests passed |
| Phase C Jest/UI | 45/45 passed: 25 domain/controller/adapter tests and 20 UI/session tests |
| `db:reset` | Passed; all 12 existing migrations and seed replayed |
| `db:test` | 410 assertions / 8 files passed |
| `db:lint` | Passed, no schema warnings/errors |
| `db:types:check` | Passed; generated types unchanged |
| `backend:test` | 10/10 passed |
| `backend:test:scan` | 15/15 passed; inherited runtime total remains 25 |
| `backend:test:manual` | 11/11 passed; combined runtime total 36 |
| Deno checks/lint | Passed with temporary Deno 2.2.7 CLI: all three account-function entry points checked and all 10 function files linted; the edge-runtime container separately reports embedded Deno 2.1.4 |
| `deps:check` | Passed; dependencies compatible |
| `run doctor` | 21/21 passed |
| `export:check` | Final post-fix Android/iOS Hermes and web exports passed |
| Phase A recorded evidence tests | 6/6 passed; original experiments and artifacts unchanged |
| Secret/local-path scan | 36 changed files checked against 4 actual local secret values; passed without logging values |
| Git whitespace checks | Tracked, staged, and every untracked file passed |

The local database contained zero users/scans/objects before reset. Final read-only inspection confirmed 12 migrations, zero Auth users, zero scans, zero Storage objects, zero scan-image records, processing disabled, and zero Storage client policies. Runtime fixtures are disposable and cleaned up. The final Docker catalog check required the existing approved host-access rule after a sandbox socket denial; it then passed. No real household ingredients or photos were sent to a provider. Exports do not prove signed builds or physical-device behavior.

### Review fixes

The independent review identified and the resumed implementation fixed three defects:

1. **Whole-operation timeout.** The original abort timer only bounded the eventual fetch, so a Supabase auth token promise could leave the service pending forever. `createScanService` now races the entire operation against the 20-second deadline, aborts active transport, clears its timer, and maps the deadline to a safe `TIMEOUT` error. The domain/controller regression stalls token retrieval and resolves it only after the timeout; the operation remains settled as a timeout and writes retain their idempotent retry command.
2. **Valid Phase B quantity rejection.** The adapter schema required `quantity: null`, although Phase B permits a positive decimal string, one of its approved units, and an `estimated` boolean. The schema now models that exact object. Projection and ingredient comparisons preserve it through loading and editing; malformed quantities remain unavailable, and null quantities continue to work. The adapter and real-runtime tests cover validation and round-trip persistence.
3. **Cached cancelled draft.** Terminal server states were projected as generic unavailability, allowing a cached editor to remain visible. Cancellation and expiry now have explicit safe domain errors. `LoadedScan` hides cached data after a confirmed terminal response, disables refresh retry, and offers the Ingredients recovery action. UI coverage distinguishes this from a transient refresh error that keeps the cached editor visible.

No Phase B correctness/security defect was found. No migration was needed or added; the authoritative Phase B schema and RPCs already support the required quantity and cancellation behavior.

### Defects found and fixed

The resumed Phase C implementation also needed repairs for repeated-conflict recovery overwriting, copying the wrong recovery list, mutable/duplicated separate-copy attempts, refresh failures hiding local input, offline remount recovery, Strict Mode disposal, pending-save confirmation navigation, and repeated acknowledged confirmation. Regression coverage was added. The first timeout test exposed default SDK read retry behavior; the adapter now disables those retries explicitly. The initial inherited formatting failure and an abort-signal builder-order TypeScript error were corrected; no validation expectation was weakened.

## IMPLEMENTED BUT NOT DEVICE-VALIDATED

- Native keyboard avoidance and scrolling to a remotely positioned rename field; Android resize behavior, iOS keyboard insets, and focus restoration.
- VoiceOver/TalkBack reading order, checkbox announcements, validation/progress announcements, and native back gesture behavior.
- Small/large phones, landscape, largest Dynamic Type, dark mode visual inspection, safe-area cutouts/gesture bars, and reduced-motion transitions on hardware.
- Actual process termination/relaunch and native SecureStore persistence with the new routes. Runtime tests prove backend reconstruction and restored client sessions, not an installed-device cold start.
- Expo Crypto and the new dependency set require a rebuilt development client for native testing. Unsigned exports are not native builds.

No simulator, physical device, browser visual session, or hosted CI run was performed in this task. These checks remain review/release gates.

## FUTURE PHASE

Camera/gallery, image preparation/upload, production ingress, sanitizer execution, AI recognition, recipe retrieval/generation, nutrition, subscriptions, ads, community, production deployment, and scheduled cleanup remain outside Phase C. There is no `/results` behavior, fake recognition, seeded detection, recipe request, or quota use. Phase D has not begun.

## UNRESOLVED / OWNER DECISION

No new product or database decision is required to review this bounded manual journey. Owner review and the device-validation matrix remain required before release/checkpoint authorization. Existing production/provider/privacy/hosting decisions in Phase A/B and the roadmap remain open. Cold-start offline editing and durable unsaved-draft recovery are not promised by Phase C; changing that policy would require a separately reviewed privacy/storage design.

## Files and Git disposition

New files: six `app/scans/` route/layout files, ten `src/features/scans/` modules, three Phase C test files, and this report. Existing changes connect Home/providers/navigation, add input refs and safe-area clearance, add the two scoped dependencies/runtime script/CI step, and update current documentation.

HEAD remains `068c994701a1641910ebc16408923833f0ab33c7` on `main`, aligned with the local `origin/main` reference. The index is empty: **16 modified tracked files and 20 untracked files**, all unstaged. Exact `git status --porcelain=v1 --untracked-files=all`:

```text
 M .github/workflows/quality.yml
 M README.md
 M app/_layout.tsx
 M docs/API.md
 M docs/ARCHITECTURE.md
 M docs/BACKEND_FOUNDATION.md
 M docs/DATABASE.md
 M docs/ENGINEERING_FOUNDATION.md
 M docs/ROADMAP.md
 M docs/SECURITY.md
 M package.json
 M pnpm-lock.yaml
 M src/components/screen.tsx
 M src/components/text-field.tsx
 M src/features/home/home-screen.tsx
 M src/lib/app-providers.tsx
?? app/scans/[id]/confirm.tsx
?? app/scans/[id]/index.tsx
?? app/scans/[id]/ready.tsx
?? app/scans/_layout.tsx
?? app/scans/index.tsx
?? app/scans/manual.tsx
?? docs/research/SCAN_PHASE_C.md
?? src/features/scans/ingredient-row.tsx
?? src/features/scans/scan-confirm-screen.tsx
?? src/features/scans/scan-domain.ts
?? src/features/scans/scan-editor-screen.tsx
?? src/features/scans/scan-editor.ts
?? src/features/scans/scan-entry-screen.tsx
?? src/features/scans/scan-provider.tsx
?? src/features/scans/scan-ready-screen.tsx
?? src/features/scans/scan-service.ts
?? src/features/scans/scan-shared.tsx
?? tests/scan-phase-c-runtime.test.cjs
?? tests/scan-phase-c-ui.test.tsx
?? tests/scan-phase-c.test.ts
```

**Phase C is READY FOR INDEPENDENT REVIEW.** This is local implementation/test readiness, not device or production release approval. No commit, push, or Phase D work was performed. Stop for owner review.
