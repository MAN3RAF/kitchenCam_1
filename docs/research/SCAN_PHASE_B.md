# Phase B — Scan Schema and Lifecycle Controls

> **Independent owner review, 2026-09-22:** The original completion claim below is historical. The independent review reproduced three defects and added a forward repair migration and adversarial regressions. See [the review addendum](#independent-owner-review--2026-09-22) for the current disposition and validation. No commit, push or Phase C work is authorized by this report.

Date: 2026-09-21. **Local Phase B implementation is complete for owner review. No commit or push was made. Phase C has not begun.**

Starting checkpoint: `02fc633446d6b107799b36ba678e126a27d8fe5d` (`feat: establish secure scan architecture`), branch `main`. Initial inspection confirmed that the only uncommitted file was `docs/handoffs/PHASE_B_HANDOFF.md`. That earlier session had created no Phase B implementation. This session preserved the foundation and Phase A evidence, then implemented the schema/lifecycle scope described below.

## Scope and boundary

Implemented: local forward migrations, owner-read scan data, controlled mutations, private image/upload/job/operation records, revision and lease fencing, confirmation, cancellation, expiry/cleanup controls, scan-aware account lifecycle, generated public types and local SQL/runtime validation.

Not implemented: camera/gallery UI, native preparation, `/v1` scan HTTP adapters, production upload ingress, a production sanitizer worker, a recognition provider, recipes, quotas/billing, a taxonomy, opt-in retained-photo creation, production deployment or scheduled cleanup execution. No real household photos, provider calls, fake recognition UI or seeded detection data were introduced. Processing policy defaults to **disabled** and remains disabled in the actual local database. These are database control primitives, not a deployed camera-to-recipe journey.

Phase A contracts remain the external protocol specification. SQL records use snake_case and do not claim to be the strict camelCase `ScanStatus` response. A future HTTP adapter must perform the explicit projection, map safe failure codes and validate provider-derived detections/regions through the full contract. Internal RPC output can contain private paths and must never be returned to a mobile client.

## Implementation plan completed

1. Inspect checkpoint, handoff, contracts, backend schema, existing tests, Git state and local migration ledger.
2. Add public/private schema boundaries and forward-only lifecycle controls.
3. Implement versioned owner commands, idempotency, trusted upload/job controls and cleanup fencing.
4. Integrate scan transfer and media cleanup into existing account merge/deletion entry points.
5. Exercise SQL permissions/invariants, real sessions, competing mutations and an observed database lock wait; regenerate/check types and run application/server quality checks.
6. Reconcile documentation and stop for owner review.

## Files created and modified

New implementation files:

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260921010000_scan_schema.sql` | Enums, constrained public scan/receipt tables, private controls/images/uploads/jobs/operations/policy, indexes and grants/RLS |
| `supabase/migrations/20260921010100_scan_lifecycle.sql` | Account/scan locking, versions, idempotent creation/mutation, confirmation, fencing and deletion receipts |
| `supabase/migrations/20260921010200_scan_work_controls.sql` | Service-only authorization/claim/completion, leased jobs, expiry and cleanup primitives |
| `supabase/migrations/20260921010300_scan_account_lifecycle.sql` | Transactional merge/deletion triggers, surviving inventory and account cleanup RPCs |
| `supabase/migrations/20260921010400_scan_concurrency_hardening.sql` | Lint repair, consistent Auth/account lock order, existing lifecycle wrappers and immutable artifacts |
| `supabase/migrations/20260921010500_scan_boundary_hardening.sql` | Safe malformed-revision handling and removal of paths/image metadata on final cleanup |
| `supabase/functions/account-delete/scan-cleanup.ts` | Bounded storage removal using registered inventory, acknowledgement and readiness checks |
| `supabase/tests/database/scan_lifecycle.test.sql` | 69 pgTAP assertions for grants/RLS, mutations, media trust, merge/deletion and cleanup |
| `supabase/tests/database/scan_recovery.test.sql` | 29 pgTAP assertions for retry limits, leases, replacement, immutable approval, outages and expiry |
| `tests/scan-phase-b-runtime.test.cjs` | Six live local tests, including concurrent RPCs and delayed physical writes |
| `docs/research/SCAN_PHASE_B.md` | This completion report |

Modified tracked files:

- `supabase/functions/account-delete/index.ts`: remove registered scan media before legacy owner-prefix drain and Auth deletion.
- `src/types/database.generated.ts`: generated from the actual local schema; public scan types/functions only, with no private image/job table definitions.
- `package.json`: add `backend:test:scan`.
- `.github/workflows/quality.yml`: run the new scan runtime suite.
- `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND_FOUNDATION.md`, `docs/DATABASE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/research/SCAN_CONTRACTS.md`: distinguish implemented database controls from future product adapters/workers and link this report.

The preexisting untracked `docs/handoffs/PHASE_B_HANDOFF.md` is preserved with a current-status banner; its original inspection remains explicitly historical. Original five foundation migrations, Phase A executable research/evidence, app screens/dependencies, bucket policies and Deno lockfile are unchanged.

## Database schema and access

Public tables:

- `scans`: owner/source/state, overall/image/draft revisions, manual flag, sanitization state, constrained ingredient draft, selected confirmation snapshot/time, safe assessment/error category, creation/update times, immutable first-upload/media deadline and deletion marker.
- `scan_deletions`: opaque receipt ID, scan ID, nullable live owner, acceptance/deadline/completion times. No ingredient/media content.

Both tables force RLS. Authenticated owners, including anonymous Auth users, can SELECT only their active-account records. Deleted scans are hidden immediately; minimized receipts remain owner-readable. Clients have no table INSERT/UPDATE/DELETE grants. Cross-owner mutations return `NOT_FOUND`. Existing private Storage buckets still have **zero client object policies**.

Public enums: `scan_state`, `scan_source`, `scan_sanitization_state`.

Private tables:

- `scan_controls`: monotonic per-scan worker generation.
- `scan_images`: immutable target registry and cleanup inventory, including original scan locator, nullable live scan/owner links, optional privacy-request link, revision/generation, bucket/path, writer/cleanup deadlines, measured image attributes and sanitizer approval. Inventory survives scan/Auth deletion. After final deletion acknowledgement it retains identifiers/times, while replacing the path with an opaque `deleted/<image-id>` marker and clearing digest/dimensions/size/sanitizer metadata.
- `scan_upload_authorizations`: hashed token, notice/revision/generation binding, expiry, claim/completion/revocation times. One unrevoked authorization per image revision.
- `scan_jobs`: unique scan/revision/generation/stage job, attempt count, lease token/deadline, absolute work deadline and terminal state.
- `scan_operations`: owner + operation + resource + UUID key uniqueness, canonical JSON hash and scan reference. Request bodies/capability secrets are not stored.
- `scan_processing_policy`: singleton admission switch, disabled by default, and registered notice version.

Indexes support owner history/receipt lookup, due-media cleanup, scan/image lookup, original-scan/privacy inventory lookup, job claims, operation lookup and authorization uniqueness. Private tables and helpers are denied to mobile roles. Public service RPCs explicitly revoke PUBLIC/anon/authenticated execution and grant it to `service_role`.

Client functions: `create_scan` and `mutate_scan`. The latter supports `ingredients`, `confirm`, `manual`, `replace`, `cancel`, `delete`; bodies accept only operation-specific keys. Existing `request_account_deletion` and `consume_account_merge_ticket` remain at the same public signatures, wrapping private identity implementations to establish lock order.

Service functions: `internal_scan_upload`, `internal_scan_claim_job`, `internal_scan_finish_job`, `internal_scan_expire`, `internal_scan_claim_cleanup`, `internal_scan_ack_cleanup`, `internal_scan_reconcile_deletions`, `internal_account_scan_cleanup`, `internal_account_scan_cleanup_ready`. These authenticate the service through database grants; explicit `p_owner` is trusted server context, never authority accepted from a mobile request.

Triggers enforce scan version/deadline updates, immutable image/approval data, merge transfer, deletion fencing, inventory attachment, direct Auth-deletion inventory preservation and refusal of premature privacy completion.

## Lifecycle and invariants

- Image creation starts `awaiting_upload`, image revision 1, overall version 1. Manual creation starts `needs_confirmation`, image revision 0, positive draft revision, no image/job/quota work.
- Current-owner admission and registered notice are required before authorization. No authorization is issued with the policy disabled. A target is recorded **before** the future external write; deadlines are no longer than 600 seconds. Only a token hash is stored.
- Claim requires live owner/account/current generation/revision and consumes the authorization once. Even identical claim replay cannot authorize a second writer. Completion replay can reconcile an already completed operation without creating another job. The future ingress must independently bound/verify bytes and enforce the writer deadline; database declarations do not prove physical image validity.
- Trusted upload completion records bounded image attributes and admits sanitization. Recognition cannot claim work until approval binds a separate immutable output target, digest, dimensions and sanitizer version to the current revision/generation.
- Jobs have 60-second leases, no more than three attempts and absolute media deadlines. Every sanitizer attempt receives a different output path. Reclaim changes the lease token; stale completions return false. Expected malformed/unsupported image failures terminate processing; bounded infrastructure failures return to pending until the attempt budget is exhausted.
- Sanitizer completion moves to `queued`; recognition claim moves to `recognizing`; validated assessment/ingredient output creates `needs_confirmation`. An empty food-detected claim is rejected. Non-food/abstained assessments must have no ingredients. No actual recognizer is implemented.
- Draft edits require current overall and draft revisions, increment revisions and invalidate confirmation. A client may preserve an existing trusted detection reference but cannot invent one. Confirmation requires a nonempty selected list and the exact current positive draft revision. Selected exact-name duplicates after trim/case normalization are rejected for explicit user resolution; meaningful variants are never silently merged.
- Manual fallback preserves the draft, removes recognition assessment, fences jobs/uploads and schedules transient cleanup. Replacement discards the old image draft explicitly, advances image/draft revisions and fences earlier work. Confirmed lists cannot be replaced or switched to manual without first reopening edits.
- Cancellation is durable and terminal. Expiry fences processing; cancelled/expired attempts cannot reopen. Ingredient history already in confirmation/confirmed states remains usable when its media expires. A new photo does not reset an established media deadline.
- Account, overall version, image revision, draft revision, private generation and lease token have distinct roles. Authorization precedes operation replay, and identical replay precedes stale-version rejection. Different payloads conflict. Replay returns current owner state and cannot resurrect deletion or renew expired authority.
- Deletion scrubs ingredient/confirmation/assessment data, hides ordinary scan access, fences all work and produces a minimized receipt. Cleanup requires physical object removal followed by token-bound acknowledgement. A sweep before the possible final writer deadline cannot finalize inventory; another sweep is required afterward. Receipt reconciliation is separate and idempotent.

## Account lifecycle

**Anonymous upgrade:** same Auth UUID retains scans. SQL verifies ownership preservation; the existing actual OTP/session integration suite also passes. No scan transfer occurs for a same-ID upgrade.

**Merge:** the existing ticket-consumption transaction transfers all source scans/receipts/inventory to the authenticated permanent target before source Auth deletion. In-flight work is fenced; unfinished processing becomes a recoverable failure requiring replacement/manual recovery. Confirmed/manual data is preserved. Absolute deadlines stay unchanged. Old object paths remain private and registered until cleanup. Source idempotency namespaces are not merged into target keys; claimed sources cannot create/replay new scan operations while cleanup is pending. Existing claimed-source upgrade protection remains intact.

**Deletion:** requesting account deletion marks the account inactive and transactionally fences/scrubs its scans. Inventory attaches to the privacy request. The existing Edge Function removes registered paths (including former guest prefixes), acknowledges them, checks readiness, drains legacy prefixes, deletes Auth and completes the privacy receipt. An open writer deadline or failed cleanup returns retryable pending status, not success. Database completion guards also reject a false completed receipt. Direct administrative Auth deletion preserves minimized cleanup inventory through nullable FKs.

Lock order is Auth rows, account controls, scans, then private work records. Merge locks Auth/account rows in deterministic UUID order. This addresses the observed design risk of an FK check during scan creation waiting on an Auth row while a merge waited on the account lock. The implementation follows PostgreSQL's guidance to acquire shared resources in a consistent order ([PostgreSQL 17 locking](https://www.postgresql.org/docs/17/explicit-locking.html)).

## Validation actually run

Commands used pinned Node 24.19.0 / pnpm 11.19.0 against the existing local Supabase stack. Pending migrations were applied without resetting the database. The live ledger now contains the original five plus six new migrations.

| Command | Result |
| --- | --- |
| `fnm exec --using 24.19.0 pnpm exec supabase migration up --local` | Passed in forward batches: initial four, concurrency hardening, boundary hardening |
| `fnm exec --using 24.19.0 pnpm db:lint` | Passed after the typed-array initializer repair; no warnings/errors |
| `fnm exec --using 24.19.0 pnpm db:test` | **169 assertions, seven files passed**: 71 foundation + 69 scan lifecycle + 29 recovery |
| `fnm exec --using 24.19.0 pnpm backend:test:scan` | **6/6 passed**, including simultaneous creates, competing revision writes/confirmation, real-role denial, cancellation race, actual merged-path late-write cleanup and an observed account-lock wait |
| `fnm exec --using 24.19.0 pnpm backend:test` | **10/10 foundation runtime tests passed**, including OTP, merge security, deletion and >1,000/nested-object cleanup |
| `fnm exec --using 24.19.0 pnpm db:types` | Generated real public schema types |
| `fnm exec --using 24.19.0 pnpm db:types:check` | Passed after final migrations |
| `fnm exec --using 24.19.0 pnpm check` | TypeScript, ESLint, Prettier, **36 Jest tests / seven suites**, and **8 static boundary/security tests** passed |
| `fnm exec --using 24.19.0 pnpm dlx deno@2.1.4 check --config supabase/functions/deno.json supabase/functions/account-delete/index.ts supabase/functions/account-merge/index.ts supabase/functions/account-merge-ticket/index.ts` | All three entry points passed |
| `fnm exec --using 24.19.0 pnpm dlx deno@2.1.4 lint supabase/functions` | All ten source files passed |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/review-scan.cjs` | All 24 changed artifacts passed checks against four actual local secret values; no values logged |
| `git diff --check`, `git diff --cached --check`, and per-untracked-file `git diff --no-index --check /dev/null <file>` | No whitespace diagnostics; index empty |

The live delayed-write test creates synthetic quarantine bytes, merges the guest, requests deletion, observes pending status, recreates the object after the first sweep, advances only that fixture's writer deadline, and retries. It verifies physical removal from the former guest path and completed cleanup. This validates the database/Edge reconciliation path; it does not prove that an undeployed ingress or decoder actually obeys an OS-enforced deadline.

The first database lint run failed on an implicit text-to-UUID-array initializer cast (`42804` warning). The forward hardening migration uses a typed empty array; lint and database tests passed afterward. No failing test or lint finding remains open. A local runtime binary inspection required Docker sandbox approval; Deno was then run through the pinned package runner. No server lockfile/dependency manifest changes resulted.

Final inspected local state after runtime fixture cleanup: **zero Auth users, zero Storage objects, zero scans, zero private scan-image records; processing disabled; zero Storage object policies**. The existing local stack remains running; explicit `supabase functions serve` was started to load the changed deletion function.

Not rerun: the completed Phase A upload/sanitizer experiments; Expo exports/dependency diagnostics, since no mobile runtime/dependency changes were made; clean-database reset/replay, because preserving the current database/work was required. Hosted CI, native-device testing and production behavior were not run or claimed.

## Decisions, limits and remaining owner gates

- Bounded JSON ingredient lists keep each versioned draft/snapshot atomic. The SQL validator enforces the exact shape and at most 50 unique row IDs. Canonical IDs/normalized names must remain null until a versioned taxonomy exists. This is an explicit trust boundary, not an implemented normalization service.
- Phase B stores only safe assessment categories/ingredient output; full provider/detection audit ingestion belongs to the future provider adapter. Provider payloads must remain private when implemented.
- SQL RPC bodies are not the final HTTP envelopes. The adapter must map revisions, sanitization timestamps, safe error categories, capability availability, deletion receipts and full strict result schemas. An already overdue deletion deadline stays overdue in storage; do not extend it merely to manufacture an apparently valid future receipt date.
- Media expiry is fixed at the first accepted intake claim plus 24 hours. Registered targets may have an earlier conservative deadline. Actual deletion still requires an operational executor. The default-closed admission policy must remain closed until ingress, worker hard limits, cleanup scheduling/retry ownership, rate/quota admission and provider availability are implemented and validated.
- Cleanup tombstones and operation hashes contain no image/ingredient bodies or credentials. Successful cleanup removes path/image metadata; receipt/operation metadata pruning policy remains an operational retention decision. Account removal cascades owner operation records and removes live receipt ownership.
- Service-role control functions are powerful trusted-parent operations. A decoder child must not receive these credentials. Physical immutability, MIME/decode checks, host containment and hostile-stream behavior still require the approved isolated worker/ingress implementation.
- Bounded account cleanup handles up to ten pages of 100 registered targets per request. Larger inventories, crashes and still-open writer deadlines stay pending for later retry. A production retry scheduler is not installed in this phase.
- No recipe readiness or safety/nutrition claim follows from ingredient confirmation. No quota is charged/reserved by these controls; quota policy and provider integration remain separate owner gates.

## Git state and owner review

HEAD and branch remain `02fc633446d6b107799b36ba678e126a27d8fe5d` / `main`. All Phase B work is uncommitted and unstaged. Original foundation/Phase A files were preserved except the explicitly listed documentation updates and generated public types. No reset, revert, stash, discarded work, untracked cleanup, commit or push occurred.

Final Git inventory: **12 modified tracked files and 12 untracked files** (including the inherited handoff), all listed above. Tracked-only diff statistics: 229 insertions and four deletions; `git diff --stat` excludes the new migrations/tests/report. Nothing is staged. Relative links in the handoff/report resolve, and all untracked artifacts passed whitespace checks.

Review the six new migrations, the account-delete cleanup helper and the three new test files first. Phase B stops here. Owner review is the next action; this report does not authorize Phase C, production hosting, ingress or providers.


## Independent owner review — 2026-09-22

Reviewed the working tree against `02fc633446d6b107799b36ba678e126a27d8fe5d`, including all tracked diffs and untracked files, all six original Phase B migrations, both new SQL suites, scan runtime tests, generated types, and the existing identity/merge/deletion implementations and tests. The original report was treated as a claim to verify. The current owner's explicit reset requirement superseded the historical handoff's no-reset restriction.

### Defects reproduced and repaired

1. **High — cleanup could finalize a sweep that ran before the last possible write.** `internal_scan_ack_cleanup` checked the writer deadline at acknowledgement time. Sequence: claim cleanup before the deadline; remove object; writer recreates it; deadline passes; acknowledgement marks the row cleaned and destroys its real path. No further sweep can find that object. Both global and account-specific cleanup were affected. The new private `cleanup_started_at` binds the claim token to the beginning of the deletion attempt. Final acknowledgement now requires that attempt to have started at or after the writer deadline. Earlier sweeps preserve the real path and require a fresh sweep, even when acknowledgement arrives late. Outstanding old-protocol leases are invalidated by the migration without discarding inventory. SQL reproduces both paths; a Storage integration regression removes and recreates actual synthetic bytes, then verifies a second physical deletion.
2. **Medium — unnecessary service-role table privileges survived Supabase defaults.** Catalog inspection found `TRUNCATE`, `REFERENCES` and `TRIGGER` on both `public.scans` and `public.scan_deletions`. In particular, receipt truncation bypasses row-level access controls and does not need the lifecycle API. The server uses controlled functions and needs no direct scan-table grants. The repair revokes all service-role privileges on these two tables while preserving the explicitly granted service RPCs. The new catalog matrix checks every scan table, all non-read table privileges, private reads, client access to internal/private routines, and fixed SECURITY DEFINER search paths.
3. **Medium — sanitizer leases could exceed an input's earlier retention deadline.** Raw inventory starts its conservative 24-hour clock at authorization; the scan clock starts later at intake claim. Job claim used the scan/job deadline for a 60-second lease but used the raw deadline for the output's `delete_by`. Near the raw deadline, a legitimate claim failed `scan_image_deadlines` because the output writer lease outlived its permitted retention. The repaired claim bounds both the job's absolute deadline and its lease by the input image's `delete_by`. A regression first reproduced SQLSTATE `23514`, then verifies successful bounded admission and both deadline relationships.

All repairs are isolated in `supabase/migrations/20260922010000_scan_owner_review.sql`. The six original Phase B migrations and all foundation migrations remain unchanged. The first regression run failed nine assertions for defects 1–2; the separate deadline regression failed two assertions for defect 3. Existing assertions were not weakened.

### Security, correctness and lifecycle assessment

- Ordinary authenticated users (including anonymous Auth users) have owner/active-account SELECT access only. Signed-out `anon` cannot create scans. Clients cannot forge sanitizer state, recognition completion, leases, cleanup completion, protected metadata or ownership through table writes or internal functions. Private tables are not exposed by PostgREST and have no client table grants. All scan SECURITY DEFINER functions have an empty search path and qualified application references.
- Cross-owner reads and mutations, known-key replay under another owner, invented detection references, malformed revisions, duplicate creation/confirmation, conflicting idempotency reuse, and stale versions are denied. Idempotency namespaces remain separate through merge. Existing upload completion replay does not create duplicate jobs or authorize another writer.
- Account/scan locking serializes owner changes. Added real concurrent edit/confirmation and confirmation/cancellation tests assert one winner. Successful sanitizer completions are deliberately held behind observed database locks while replacement, cancellation, scan deletion, account deletion or merge commits; every stale result is rejected and pending jobs/upload authorizations remain fenced. Existing tests cover lease reclaim, attempt limits, image revisions, manual fallback, expiry, and immutable approved artifacts.
- A real email OTP same-ID upgrade preserves the entire draft and confirmed scan rows. SQL separately verifies draft/snapshot preservation. Ticket-based merge transfers drafts and confirmations before source Auth removal, cancels pending authority, preserves media deadlines, and retains original private media paths for cleanup. No email-only merge was introduced.
- Account deletion immediately hides scans, denies creation/upload authorization/advancement, fences pending work and attaches cleanup to the privacy request. Pending inventory survives direct Auth deletion through nullable owner/scan references and a stable original scan locator. Scan/receipt uniqueness, operation uniqueness, one live upload per image revision, one job per revision/generation/stage, and FK/cascade behavior were checked against actual definitions and regression execution.
- Public history, receipt ownership, private scan/revision lookup, cleanup candidates, privacy-request inventory, job state/deadlines and idempotency lookups have indexes. Account operations deliberately serialize per owner; production-sized query plans and contention/load benchmarks remain deployment work. No claim of production-scale performance is made.
- The regenerated public types match the database and include no private tables/columns. Generated Insert/Update shapes and internal RPC signatures describe the schema; they do not imply that mobile roles have permission to use them. JSON RPC results still need strict adapter validation. The review's private-only column and function-body/grant changes produce no additional generated public type diff.

### Review validation

**Review result: READY FOR CHECKPOINT after the three repairs above.** This is approval of the bounded Phase B database/control scope for owner consideration, with processing disabled; it is not production upload readiness or permission to begin Phase C.

All commands below were independently run from this checkout with `fnm exec --using 24.19.0 pnpm` (pinned pnpm 11.19.0). Final database/integration checks were run sequentially after the final clean replay.

| Validation | Final result |
| --- | --- |
| `db:reset` | Passed: empty database initialization and all **12 migrations** (5 foundation + 6 original Phase B + 1 review repair), seed and container restart |
| `db:test` | **410 assertions in 8 files passed**: 169 inherited + 241 owner-review assertions |
| `db:lint` | Passed, no warnings or schema errors |
| `backend:test` | **10/10 passed**, now including full scan/draft/confirmation preservation through actual email OTP upgrade |
| `backend:test:scan` | **15/15 passed**: 6 inherited + 9 added runtime tests; total runtime/integration count **25** |
| `db:types`, then `db:types:check` | Regenerated from final schema; exact match; no review change to inherited generated types |
| `check` | TypeScript, ESLint with zero warnings, repository Prettier check, **36 Jest tests / 7 suites**, **8 static security/boundary tests** passed |
| `dlx deno@2.1.4 check --config supabase/functions/deno.json supabase/functions/account-delete/index.ts supabase/functions/account-merge/index.ts supabase/functions/account-merge-ticket/index.ts` | All three entry points passed |
| `dlx deno@2.1.4 lint supabase/functions` | All 10 source files passed |
| `deps:check`, `run doctor` | Dependencies compatible; **21/21 diagnostics passed** |
| `exec node --test tooling/scan-phase-a/evidence.test.cjs` | **6/6 passed**; completed upload/sanitizer experiments were not repeated |
| `exec node tooling/scan-phase-a/review-scan.cjs` | 27 changed/untracked files checked against 4 actual local secret values; no secret or developer-path matches, no values logged |
| Git whitespace and artifact inventory | `git diff --check`, cached check and every untracked-file no-index whitespace check passed; no generated garbage, logs or credentials added |

The final reset encountered a sandbox-only Supabase telemetry-cache write failure on one invocation. It was rerun with approved host access and completed successfully; the final clean replay and all database/runtime checks above passed afterward. No test or invariant was weakened. Dependency manifests/lockfiles, foundation migrations and original Phase A evidence are unchanged. Expo exports were not repeated because no mobile runtime or dependency code changed.

Final inspected local state: **12 migrations, zero Auth users, zero Storage objects, zero scans, zero scan-image records, processing disabled, zero Storage client object policies**. Minimized lifecycle receipts from test accounts can survive by design. The existing local stack remains running.

### Remaining gates and scope

The database models immutable transient deadlines of at most 24 hours and preserves obligations across cancellation, replacement, merge and deletion. It cannot prove an external Storage deletion or force an undeployed writer to stop. A trusted parent must remove the object successfully before acknowledging; ingress/worker hard deadlines and a scheduled, monitored cleanup/retry executor remain required before enabling uploads. Deadline-crossing tests shorten only disposable fixture deadlines; they do not certify a deployed ingress or replace the historical Phase A wall-clock capability experiments.

Processing admission must remain disabled. Production hosting, worker isolation/resource limits, HTTP projections, rate/quota admission, provider validation, native-device checks and operational retention/pruning remain owner gates. The existing gap between Auth deletion and receipt completion still requires operational retry ownership if a server crashes. Hosted CI and production behavior were not tested. Phase C has not begun.

### Files changed by this independent review

- Added `supabase/migrations/20260922010000_scan_owner_review.sql`.
- Added `supabase/tests/database/scan_owner_review.test.sql`.
- Extended `tests/scan-phase-b-runtime.test.cjs` with concurrency, lifecycle-lock and physical cleanup regressions.
- Extended `tests/backend-runtime.test.cjs` with scan preservation assertions in the actual OTP upgrade test.
- Updated this report and the current summaries in `docs/handoffs/PHASE_B_HANDOFF.md` and `docs/BACKEND_FOUNDATION.md`.

No app feature, production integration, dependency, original migration, original SQL assertion or Phase A evidence was changed. Generated types were regenerated and remained identical to the inherited Phase B output. Nothing was staged, committed or pushed.

### Final Git state and recommendation

HEAD remains `02fc633446d6b107799b36ba678e126a27d8fe5d` on `main`. The index is empty: 13 modified tracked files and 14 untracked files, all unstaged. Exact `git status --porcelain=v1 --untracked-files=all`:

```text
 M .github/workflows/quality.yml
 M README.md
 M docs/API.md
 M docs/ARCHITECTURE.md
 M docs/BACKEND_FOUNDATION.md
 M docs/DATABASE.md
 M docs/ROADMAP.md
 M docs/SECURITY.md
 M docs/research/SCAN_CONTRACTS.md
 M package.json
 M src/types/database.generated.ts
 M supabase/functions/account-delete/index.ts
 M tests/backend-runtime.test.cjs
?? docs/handoffs/PHASE_B_HANDOFF.md
?? docs/research/SCAN_PHASE_B.md
?? supabase/functions/account-delete/scan-cleanup.ts
?? supabase/migrations/20260921010000_scan_schema.sql
?? supabase/migrations/20260921010100_scan_lifecycle.sql
?? supabase/migrations/20260921010200_scan_work_controls.sql
?? supabase/migrations/20260921010300_scan_account_lifecycle.sql
?? supabase/migrations/20260921010400_scan_concurrency_hardening.sql
?? supabase/migrations/20260921010500_scan_boundary_hardening.sql
?? supabase/migrations/20260922010000_scan_owner_review.sql
?? supabase/tests/database/scan_lifecycle.test.sql
?? supabase/tests/database/scan_owner_review.test.sql
?? supabase/tests/database/scan_recovery.test.sql
?? tests/scan-phase-b-runtime.test.cjs
```

**Recommend Phase B READY FOR CHECKPOINT. Stop for owner review. No commit, push or Phase C implementation was performed.**
