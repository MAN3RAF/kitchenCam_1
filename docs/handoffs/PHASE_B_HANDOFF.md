# Phase B handoff — Scan Schema and Lifecycle Controls

> **Independent review update, 2026-09-22:** Phase B implementation and independent owner review are complete and READY FOR CHECKPOINT. Three defects were reproduced and repaired in a seventh forward Phase B migration: cleanup acknowledgement crossing the writer deadline, unnecessary service-role table grants, and leases outliving an input image deadline. Final validation passed 410 SQL assertions and 25 runtime/integration tests, along with the other checks in [the review addendum](../research/SCAN_PHASE_B.md#independent-owner-review--2026-09-22). The original inspection below remains historical. Phase C has not begun.

---

## Historical pre-implementation inspection

Inspection date: 2026-09-21. Working directory: `~/Projects/KitchenCam`.

**Actual state: Phase B has not been started in this working tree.** At handoff entry, HEAD was the supplied Phase A checkpoint and the index and working tree were clean, including untracked files. No interrupted Phase B implementation, new migration, changed test, or changed generated type was present. This document is the only file created during handoff preparation. Do not reconstruct imaginary progress from the request's reference to ongoing Phase B work.

## 1. Current objective and scope

Continue **Phase B: Scan Schema and Lifecycle Controls** from Phase A checkpoint **`02fc633446d6b107799b36ba678e126a27d8fe5d`** (`feat: establish secure scan architecture`). Preserve the approved Phase A contracts and evidence; do not redo completed Phase A experiments.

The latest user instruction for this session was to stop implementation, inspect the repository, write this handoff, run only lightweight handoff checks, and stop. No Phase B implementation was performed during this handoff. The next session is intended to continue Phase B in this same directory. Historical Phase A documents say Phase B was unauthorized at that checkpoint; those statements describe the earlier scope, not evidence of any later implementation. No separate detailed Phase B implementation brief was found among the inspected repository documents. The ordered work below is a proposed continuation derived from the existing contracts, not a recovered prior implementation plan.

User constraints to preserve: no commit, push, reset, revert, stash, discarded changes, untracked-file cleanup, Phase C, repetition of completed work, or additional architecture changes merely to prepare this handoff. Production provisioning and integrations remain outside this work.

Read first:

- `AGENTS.md` — project scope, architecture, security and validation requirements.
- `docs/research/SCAN_CONTRACTS.md` — authoritative scan operations, projections, revisions and durable transition obligations.
- `docs/research/SCAN_PHASE_A.md` — approved architecture, evidence, limits and historical validation.
- `tooling/scan-phase-a/contracts.ts`, `state-machine.ts`, `idempotency.ts`, `recognition-port.ts` — executable research specifications; not production services.
- `docs/BACKEND_FOUNDATION.md`, `docs/BACKEND_VALIDATION.md` and the five existing migrations — implemented identity foundation.
- `docs/DATABASE.md` — logical design only for scan tables; older provider-field placement must be reconciled with the stricter Phase A private/public boundary.

## 2. Exact progress

### Completed before this handoff

- Mobile/authentication and local backend foundations, including private buckets and identity RLS.
- Phase A contracts, client step/effect reducer, pure idempotency ordering, provider-neutral interface, UX/security review, upload experiments and sanitizer prototype/evidence.
- Phase A checkpoint exists at the exact requested SHA.
- Repository inspection for this handoff: status, full tracked and staged diffs, diff statistics, untracked inventory, migration declarations and relevant lifecycle bodies, test inventory, generated types, account Edge Functions, CI and relevant documentation.

### Partially completed

- **No partially implemented Phase B code found.** Research specifications and a sanitizer prototype are useful inputs, but do not constitute partially deployed scan lifecycle controls.
- The existing account lifecycle is implemented for identity/preferences. Its extension to scans, jobs, image inventory and late-write cleanup is entirely pending.

### Not started in this tree

Scan database schema/RLS/RPCs, persisted operation idempotency, worker leases/fencing, upload authorization records, scan confirmation snapshots, cancellation/deletion tombstones, cleanup inventory, retention scheduling, scan-aware account merge/deletion, and their SQL/runtime tests. No production scan endpoints, camera/preparation screens, upload ingress, sanitizer service, recognition provider, recipe integration or Phase C work exists.

## 3. Files created or modified

Complete change inventory relative to the Phase A checkpoint:

| Path | Status | Purpose |
| --- | --- | --- |
| `docs/handoffs/PHASE_B_HANDOFF.md` | New, untracked | This repository-grounded handoff |

**Existing tracked files modified: none. Other new/untracked files: none. Staged files: none.**

Important existing files, all unchanged:

| Files | Purpose / continuation relevance |
| --- | --- |
| `supabase/migrations/20260920010000_identity_foundation.sql` through `20260920010400_runtime_validation_fixes.sql` | Current implemented schema; add forward migrations rather than rewriting these |
| `supabase/functions/account-merge/index.ts` | Consumes guest ticket, deletes source Auth user, completes merge; no scan transfer |
| `supabase/functions/account-delete/index.ts` | Marks deletion, recursively drains both owner bucket prefixes, deletes Auth user, completes receipt; no scan/job fencing or durable media inventory |
| `supabase/functions/account-merge-ticket/index.ts` | Existing guest merge authorization entry point |
| `src/features/auth/auth-service.ts` | Guest creation, email upgrade and existing-account merge flow |
| `src/types/database.generated.ts` | Existing public identity schema types, no scan types |
| `tooling/generate-database-types.cjs` | Real local schema generation/comparison; canonicalizes trailing whitespace |
| `tests/scan-phase-a-contracts.test.ts` | 20 research contract/reducer tests, not transactional scan tests |
| `tooling/scan-phase-a/evidence.test.cjs` | Six assertions against preserved experiment evidence |
| `supabase/tests/database/*.test.sql` | Five identity/account/storage pgTAP suites |
| `tests/backend-runtime.test.cjs` | Ten existing local runtime identity/account/security integration tests |
| `.github/workflows/quality.yml`, `package.json` | Existing quality commands and CI; no Phase B additions |

Phase A artifact inventory is recorded in `docs/research/SCAN_PHASE_A.md` section 16. Those files are already committed; they are not pending changes.

## 4. Database work

**Phase B migrations created: none. Phase B tables/types/functions/triggers/indexes/RLS/grants: none.** Repository migration inventory is exactly:

1. `20260920010000_identity_foundation.sql`: public `profiles`, `user_preferences`, `privacy_requests`, `preference_merge_reviews`; private `account_controls`, `account_merge_tickets`, `account_merge_events`; enums, indexes, creation/update triggers and grants.
2. `20260920010100_identity_rls.sql`: active-account/permanent-identity helpers, forced RLS and owner policies on the four public tables.
3. `20260920010200_private_storage.sql`: private `scan-raw-private` and `scan-retained-private`, 10 MiB bucket limit, JPEG/PNG/WebP MIME allowlist; no client object policies.
4. `20260920010300_account_lifecycle.sql`: account deletion, merge-ticket operations, merge completion and preference resolution.
5. `20260920010400_runtime_validation_fixes.sql`: qualified merge columns, live Auth checks and source locking, claimed-source upgrade trigger, service-role SELECT on minimized privacy requests.

Existing enums: public `measurement_system`, `onboarding_state`, `privacy_request_type`, `privacy_request_status`, `account_status`; private `account_merge_outcome`. No scan enum exists.

Existing functions: private `touch_updated_at`, `handle_new_auth_user`, `is_account_active`, `is_permanent_identity`, `guard_claimed_merge_source_upgrade`; public `request_account_deletion`, `internal_mark_account_deletion_processing`, `internal_complete_account_deletion`, `issue_account_merge_ticket`, `consume_account_merge_ticket`, `internal_complete_account_merge`, `resolve_preference_merge`.

Existing triggers: `profiles_touch_updated_at`, `user_preferences_touch_updated_at`, `on_auth_user_created`, `guard_claimed_merge_source_upgrade`. Explicit indexes: `privacy_requests_one_open_delete_per_user`, `account_merge_tickets_source_expiry`, `preference_merge_reviews_user_unresolved`, `account_merge_events_correlation`, plus primary/unique-constraint indexes.

Existing enforced boundaries:

- Active owners can SELECT their public records and update only allowlisted profile/preference columns. Privacy requests and preference reviews are client read-only; resolution uses an authenticated RPC.
- All four exposed tables have enabled and forced RLS. Anonymous Auth users use the authenticated role; unauthenticated `anon` is distinct.
- Private operational tables are denied to clients. Authenticated users have private-schema usage and execute permission for the two policy helpers, not general private-table access.
- Internal deletion/merge completion functions are service-role-only. Existing SECURITY DEFINER functions use an empty search path.
- Profile/preferences versions advance on updates. Identity records are initialized on Auth user creation.
- Deletion requires an AMR timestamp within ten minutes, immediately marks the account inactive, and permits only one open delete request per user. The existing account privacy target is 30 days; this is **not** the scan-media 24-hour deadline.
- Merge consumption checks live identities and binds a claimed ticket to its target; source Auth row locking and a trigger prevent upgrading a claimed source before cleanup.

`scans`, `scan_images`, `scan_jobs`, `scan_detections`, `scan_ingredients`, catalog tables and usage ledger in design documents are **not created**. There is no implemented scan retention, authorization-consumption or lease uniqueness invariant.

Generated types are unchanged and tracked. Inspection SHA-256: `8b502784bd7049f78c11c56222283168d2f8c6465f7e30dfe33cf6608087966d`. The older backend report records a different historical hash; do not use that old hash as current evidence. No fresh schema generation/comparison ran during handoff, and no live migration ledger was queried.

## 5. Scan lifecycle: specification versus implementation

**No durable server states or transitions are implemented.** The Phase A reducer and schemas implement research validation only. Required durable states are `awaiting_upload`, `sanitizing`, `queued`, `recognizing`, `needs_confirmation`, `confirmed`, `failed`, `cancelled`, `expired`.

The authoritative transition table is at the end of `SCAN_CONTRACTS.md`: upload completion admits sanitization; same-revision sanitizer approval admits queued recognition; a fenced lease admits recognition; valid assessment creates an editable draft; explicit confirmation creates a snapshot. Manual fallback enters `needs_confirmation`; confirmed edits invalidate confirmation. Cancellation/expiry are terminal. Failure recovery is stage-specific and bounded. Deletion replaces ordinary access with a minimized receipt/tombstone.

Required behavior, all pending in the database:

- **Revisions/fencing:** overall version starts at 1; image revision identifies photo replacement; draft revision identifies edits/confirmation; private lease generation fences worker writes. These counters are distinct. Old workers must lose after replacement, manual fallback, confirmation, cancellation, deletion, expiry or identity transfer. Client generation suppression already exists only in the pure reducer.
- **Cancellation:** local callbacks are fenced immediately; a server-backed attempt remains cancellation-pending until durable acknowledgement. New processing/confirmation must be rejected after cancellation.
- **Idempotency:** authenticate and check current owner/account first; scope by owner + normalized operation/resource + UUID key; hash canonical validated payload including expected revisions; identical replay precedes stale-version rejection; different payload conflicts. Replay cannot revive terminal work, renew media/capabilities or repeat side effects. `idempotency.ts` provides only the ordering decision, without storage, hashing or concurrency control.
- **Confirmation:** requires selected ingredients, current positive draft revision and explicit acknowledgement with a newer server version; snapshot contains selected rows only. Empty manual drafts are allowed; empty confirmations are not. Stable unique row IDs, at most 50 rows, bounded names and positive decimal-string quantities are in the research schemas. Taxonomy validation and duplicate resolution remain open.
- **Cleanup:** transient/raw media, including intermediate sanitizer outputs, expires within 24 hours of first upload; retry/merge must not extend this deadline. Earlier cleanup follows processing/rejection/cancellation. Deletion receipts must respect the earlier original media deadline. Separate opt-in sanitized derivatives have their own disclosed retention and are deleted on explicit scan/account deletion. Durable inventory and late-write reconciliation do not exist.

## 6. Account lifecycle integration

| Flow | Implemented foundation | Pending scan integration |
| --- | --- | --- |
| Anonymous upgrade | Email OTP upgrade retains the same Auth UUID; existing data preservation is historically tested | Verify scans remain owned/readable and in-flight authorizations remain correctly fenced; no scan-specific upgrade code/test exists |
| Existing-account merge | Hashed ten-minute ticket, target-bound claim/retry, live identity checks, preference review, source Auth deletion and completion | Decide and implement transfer/fencing transaction before source deletion; handle image ownership, jobs, private records, idempotency namespace and cleanup inventory; preserve absolute deadlines |
| Account deletion | Recent-auth check, immediate account lockout, recursive/paginated removal of current objects in both owner prefixes, Auth deletion, minimized completion record | Fence scans/jobs/authorizations before cleanup; preserve minimized late-write inventory across Auth deletion; reconcile delayed writes and retries; do not claim completion prematurely |

The merge Edge Function currently deletes the source Auth user immediately after ticket consumption. Adding scan foreign keys with cascade deletion without changing this integration could destroy guest scans instead of transferring them. The deletion Edge Function drains existing paths, but does not prove that no later write can occur. Existing production retry ownership/crash recovery remains deferred.

## 7. Tests and commands

**Tests added during Phase B/handoff: none. No test suite was run during this handoff. No current test failure was reproduced.** Passing results below are historical evidence from the unchanged checkpoint, not fresh execution or proof of future Phase B behavior.

Existing pgTAP files: `identity_schema.test.sql` (20), `identity_rls.test.sql` (12), `storage_rls.test.sql` (9), `account_lifecycle.test.sql` (17), `account_merge_security.test.sql` (13): 71 assertions. Runtime coverage includes cross-owner denial, private RPC/table denial, bucket denial, unauthenticated Edge denial, OTP upgrade, target-bound merge retry, session storage, deletion lockout and >1,000/nested-object cleanup, and upgraded-source rejection.

Exact historical commands recorded in Phase A section 17 (all from repository root):

| Command | Last documented result |
| --- | --- |
| `fnm exec --using 24.19.0 pnpm check` | Passed typecheck/lint/format; 36 Jest tests in seven suites, including 20 Phase A tests; eight static boundary/security tests |
| `fnm exec --using 24.19.0 pnpm exec jest tests/scan-phase-a-contracts.test.ts --runInBand` | Focused intermediate 13/19-test runs passed; final 20 covered by full check |
| `fnm exec --using 24.19.0 pnpm exec node --test tooling/scan-phase-a/evidence.test.cjs` | Six passed |
| `fnm exec --using 24.19.0 pnpm db:test` | 71 assertions passed |
| `fnm exec --using 24.19.0 pnpm db:lint` | Passed with no warnings/errors |
| `fnm exec --using 24.19.0 pnpm db:types` | Passed; types unchanged |
| `fnm exec --using 24.19.0 pnpm db:types:check` | Passed |
| `fnm exec --using 24.19.0 pnpm backend:test` | Ten local runtime tests passed |
| `fnm exec --using 24.19.0 pnpm deps:check` | Passed |
| `fnm exec --using 24.19.0 pnpm run doctor` | 21/21 passed |
| `fnm exec --using 24.19.0 pnpm export:check` | Android/iOS/web passed |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/upload-spike.cjs` | 52 recorded observations, including real ten-minute expiry boundary |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/upload-supplement.cjs` | Six supplemental observations and fixture cleanup passed |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/sanitizer-spike.cjs > /tmp/kitchencam-phase-a-sanitizer-resumed.log` | 49 cases matched expectations |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/review-scan.cjs` | Changed-artifact secret check passed at that checkpoint |

These are evidence, not instructions to repeat experiments. Full installation/diagnostic history is preserved in the Phase A report. Use pinned Node 24.19.0 and pnpm 11.19.0 for future project workflows. Some pnpm cache and Docker operations historically required approved execution outside the sandbox.

Historical failures were repaired before the checkpoint: SQLSTATE `42702` ambiguous merge columns; stale guest ticket accepting an upgraded source; incomplete one-page/nonrecursive object removal; runtime watcher interference; duplicated Content-Type headers in the upload experiment; research formatting and generated trailing-whitespace mismatch. The reports record successful reruns. None is established as a current open failure by this inspection.

Tests not yet written: scan owner/anonymous RLS matrix and column/RPC privilege denial; valid/invalid durable transitions; revision and lease races; idempotent concurrency, different-body conflict and lost-ack replay; sanitizer approval trust boundary; nonempty revision-bound confirmation and edit invalidation; replacement/manual/cancel/expiry stale-worker denial; immutable retention deadlines; scan deletion receipts/late writes; upgrade ownership; merge transfer versus concurrent writes/upgrade/deletion; account deletion with active scan jobs and cleanup retries. Serial happy-path tests alone will not validate concurrent locking behavior.

## 8. Ordered unfinished work for the next Astra

1. Recheck status and read the contracts plus migrations `103`/`104`. Establish that the only new file is this handoff. Write a short Phase B implementation plan mapping each contract obligation to database state, privileged operation and test. Do not redo Phase A.
2. Define the smallest complete scan schema and access boundary. Separate owner-safe projections/drafts/snapshots from private image paths/digests, authorizations, jobs/leases, provider metadata, operation records and cleanup inventory. Decide FK deletion behavior so cleanup survives Auth removal. Treat exact table names beyond the existing logical design as implementation choices still to be made.
3. Add new forward migrations after `20260920010400`; leave existing migrations intact. Add explicit constraints, uniqueness/indexes, RLS and least-privilege grants. Deny client writes to server authority fields and private structures. Implement trusted lifecycle operations with consistent locking, atomic revision checks and fenced completion.
4. Implement persisted idempotency, confirmation, manual fallback, cancellation, expiry and deletion/cleanup transitions within the Phase B scope. Preserve contract replay ordering, trust gates and original media deadlines. Do not implement a real ingress/decoder/provider or fabricate provider results merely to exercise schema controls.
5. Extend account lifecycle integration before treating scans as usable: transfer/fence guest state before source Auth deletion; preserve same-ID upgrade; atomically block/fence on account deletion; retain only minimized cleanup information across physical deletion. Cover source/target races and retry behavior.
6. Add meaningful SQL and local runtime tests for the security and concurrency matrix in section 7. Preserve existing foundation regressions and Phase A evidence. Do not weaken assertions to obtain passing output.
7. Apply only the new migrations through a non-destructive local workflow after checking actual local stack state. Do not use the CI reset recipe under the user's no-reset instruction. Generate public types from the actual schema and inspect them for private-data leakage; do not hand-author generated types.
8. Run relevant database lint/tests, runtime regressions, generated-type consistency, TypeScript and lint checks; record actual outputs and failures. Broaden validation only as justified by the changes. Update implementation docs and this handoff with exact files/decisions/status. Stop before Phase C and do not commit/push.

## 9. Important decisions and invariants

**No new Phase B implementation decisions were made.** Preserve approved Phase A decisions:

- Authenticated bounded ingress is the upload boundary. Neither SDK signed upload nor direct S3 PUT is approved as the final mechanism. One-use authorization requires live ownership, target binding, size/type limits and cancellation/deletion fencing.
- Heavy sanitization belongs in an isolated Node + Sharp/libvips worker with enforceable OS/process limits; Edge Functions handle lightweight admission/coordination. Hosting remains unresolved.
- Provisional ceilings: source 25 MiB / 12 MP; prepared metadata-free upright JPEG, dimensions 256–2048, at most 4 MiB. Existing bucket ceiling remains 10 MiB. Do not confuse declaration validation with measured server validation.
- Recognition requires immutable sanitizer-approved bytes for the same revision. No real-user image upload while recognition is unavailable. Manual entry does not use recognition/quota and must not fabricate detections.
- Public status/navigation/cache/telemetry must exclude storage paths, capabilities, bytes, provider metadata and raw exceptions. Transient upload envelopes are a tightly scoped transport exception.
- Owner checks precede replay; replay precedes stale-version rejection; no replay or merge extends media retention. Server transactions, not the client reducer, enforce durable races.
- Final taxonomy/duplicate semantics and successful-assessment quota policy are unresolved; do not silently invent final product policy.

## 10. Known problems and risks

- No incomplete migration or temporary Phase B code is present; the primary gap is absence of Phase B itself.
- Local stack/process health and the live database migration ledger were not inspected during this handoff. Older reports disagree about whether the stack was left running at their respective dates. Do not infer current runtime state from either report.
- Phase A proved that tested capabilities are transferable and survive object/Auth deletion. SDK lifetime was 7,200 seconds; S3 respected 600-second expiry but allowed overwrite even with tested conditional headers. Those are known mechanism limitations, not currently failing product tests.
- The sanitizer prototype's sampled memory supervisor exceeded its threshold; it is not evidence of hard OS containment. Hosted execution, hostile streams, concurrency/load and native image preparation remain unvalidated.
- Existing merge/deletion cannot safely cover hypothetical new scan jobs without explicit transactional integration; merely adding cascading foreign keys is insufficient.
- `docs/DATABASE.md` is an older logical model and includes provider fields alongside scans/detections. Follow the newer strict private/public contracts when implementing. The storage migration's old signed-upload comment predates the approved ingress decision; do not copy it as current architecture.
- Historical validation reports contain pre-checkpoint Git snapshots and historical hashes. Current Git inspection in section 12 supersedes those snapshots. No external CI or production validation is claimed.
- Exact lock ordering, private service entry points, transfer behavior for outstanding operations and cleanup durability are still implementation questions, not settled designs concealed in missing code.

## 11. Validation status

| Status | Evidence |
| --- | --- |
| Passed during handoff inspection | Git commands succeeded; exact checkpoint/branch verified; tracked/staged diffs and initial untracked inventory empty; five migration files and unchanged tracked generated types confirmed |
| Passed after writing handoff | All 13 required sections present; status shows only this untracked handoff; tracked/staged statistics remain empty; Git whitespace checks emitted no diagnostics |
| Passed historically, not rerun | Checkpoint test/quality results in section 7 and linked reports |
| Failed currently | No failure reproduced; no test suites executed, so this does not certify current runtime health |
| Not yet run / not implemented | Every Phase B validation; fresh application/backend/database test runs, migration replay, live schema/type comparison, concurrency and operational cleanup validation |

After creating this file, only lightweight Git inventory/whitespace and handoff-content checks are appropriate. No backend startup, reset, migration, test suite, export or experiment is needed to validate this documentation-only change.

## 12. Git state and inspection commands

- Branch: `main`.
- HEAD: `02fc633446d6b107799b36ba678e126a27d8fe5d`.
- Entry `git status --porcelain=v1 --untracked-files=all`: empty.
- Entry `git diff`, `git diff --stat`, `git diff --cached`, `git diff --cached --stat`: all empty.
- Entry `git ls-files --others --exclude-standard`: empty.
- Verified final status: only `?? docs/handoffs/PHASE_B_HANDOFF.md` with `--untracked-files=all`; ordinary short status may collapse this to `?? docs/handoffs/`.
- Diff summary: zero tracked changes and zero staged changes; one new Markdown handoff. Ordinary `git diff --stat` excludes untracked files, so it remains empty.
- Nothing staged; no commit, push, reset, revert, stash, cleanup or discarded change occurred.

Exact relevant read-only audit commands executed during preparation:

```sh
pwd
git status --short
git branch --show-current
git rev-parse HEAD
git diff --stat
git diff --cached --stat
git status --porcelain=v1 --untracked-files=all
git diff
git diff --cached
git ls-files --others --exclude-standard
git log -4 --oneline
rg --files supabase tests docs src/types .github tooling | sort
sha256sum src/types/database.generated.ts
git ls-files src/types/database.generated.ts
```

Targeted `cat`, `sed`, `tail` and `rg` reads also inspected the contracts, reports, SQL declarations/bodies, account functions, tests, generated-type declarations, auth source references, package scripts and CI. No command in this handoff session executed Phase B code or a validation suite.

Post-write checks: `git diff --check`, `git diff --cached --check`, `git diff --no-index --check /dev/null docs/handoffs/PHASE_B_HANDOFF.md`, `rg -n '^## ' docs/handoffs/PHASE_B_HANDOFF.md`, plus repeated status/HEAD/branch/untracked/stat inspection. All whitespace checks produced no diagnostics. The no-index comparison exited 1 because the new file differs from `/dev/null`; this is not a test or whitespace failure.

## 13. Exact recommended next action

**First: map `SCAN_CONTRACTS.md`'s durable transition/replay/privacy requirements to a short schema-and-test plan, with particular attention to the existing merge function deleting the source Auth user.** There is no failing Phase B migration to repair or partial implementation to finish. Establish the public/private data boundary and deletion-safe ownership/cleanup relationships before writing the first new forward migration. Continue implementation only in the next authorized Phase B work session; this handoff session stops after lightweight checks.
