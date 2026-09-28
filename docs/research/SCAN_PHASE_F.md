# Phase F — Trusted sanitizer worker and Phase B completion repair

Date: 2026-09-28. Independent owner review completed before the Phase F checkpoint; its findings and independently rerun validation are recorded in the final addendum. At review completion no commit, push or staging had occurred. Phase G and Phase H were not started. Processing remains disabled. Hosted and physical-device gates remain open.

Base: `1a1c67e30ffacb71f7269bad16e17bfd0a7e3789` (`feat: implement client image preparation`). On resumption the tree already contained the worker, this report, historical race evidence, a draft forward migration, SQL assertions and a lock-wait helper. The draft repair was also present in the local database. The inherited report still described an earlier stop with no migration; that statement was historical, not the actual resumption state. Existing work, the 39 codec tests, Docker setup and evidence were preserved and continued.

## A. Phase B repair

### Defect and negative reproduction

The checkpointed `public.internal_scan_finish_job(uuid,uuid,jsonb)` checked the sanitizer lease/deadline, locked and approved the output, then updated the raw inventory. That update could block. Once the lock became available, the RPC could queue recognition and commit sanitizer trust despite elapsed expiry. Its approval timestamp was assigned before waiting, so inspecting that timestamp alone hid the violation.

The original [reproduction](../../server/sanitizer/review/lease-expiry-repro.cjs) and [historical observation](evidence/scan-phase-f-lease-expiry.json) remain intact: observed database lock wait, lease expired before unlock, RPC returned true, scan queued/passed, one recognition job, zero fixture inventory after cleanup. No recognizer or provider was run.

Before editing the inherited repair, the exact historical function body from `20260921010200_scan_work_controls.sql` was temporarily restored in the disposable local database. The new regression ran against it, observed the wait and elapsed lease, and **failed** with `true !== false` at “completion after lease lock wait.” A `finally` block restored the draft repair. The database was subsequently reset and replayed from migrations. Historical migration files were never edited. The pre-repair failure log is `/tmp/kitchencam-f-before.log`; the committed-base observation remains in the JSON evidence above.

Worker-side timeout is insufficient: aborting an HTTP request or killing a caller does not prove cancellation of its database transaction. Authority must be checked within the database transaction after blocking operations.

### Forward-only change

New migration: [`20260928010000_sanitizer_completion_fence.sql`](../../supabase/migrations/20260928010000_sanitizer_completion_fence.sql). Only the existing completion function body changes. No new table, column, public signature, shared helper, client capability or recognition implementation is introduced.

The sanitizer success branch:

1. Retains the existing Auth/account, scan and job locking and active-account checks. Those locks serialize cancellation, replacement, lease reclamation, account deletion/merge and direct Auth deletion.
2. Locks both raw and sanitized inventory rows in UUID order before making its decisive authority check. Cleanup claims use `SKIP LOCKED`; cleanup acknowledgement locks only its inventory row.
3. Rechecks lease ownership/state/expiry, job deadline, generation/revision, active scan state, media expiry, raw inventory revision/liveness/deletion, and output revision/liveness/writer deadline/deletion/prior approval using the locked records and current time. Lifecycle state cannot change concurrently while those locks are held.
4. Performs approval, raw cleanup request, recognition eligibility insertion, scan transition and job completion inside a PL/pgSQL subtransaction. A final elapsed-time check follows all writes. Expiry raises a private exception caught outside that subtransaction, rolling back **every** tentative mutation and returning false. No further database write or lock acquisition follows the final success check.
5. Applies the same elapsed-time rollback to terminal sanitizer error fencing, which can also block on inventory. Legitimate retry/error semantics remain unchanged. Non-sanitizer paths remain unchanged.

`CREATE OR REPLACE` retains the existing service-only execution ACL; SQL explicitly verifies service access and client denial. Private-table/RLS boundaries remain covered by the full SQL and runtime suites. Valid completion creates exactly one recognition eligibility row; repeated completion cannot approve or enqueue twice. Rejected success cannot leave `approved_at`, `passed`, `queued`, completed job state, or an early raw cleanup mutation behind.

### PostgreSQL time semantics and transition boundary

Both the post-lock decision and final post-write fence use **`clock_timestamp()`**. PostgreSQL documents that it changes during statement execution, whereas `now()`/`current_timestamp` represent transaction start and `statement_timestamp()` represents statement start. Those fixed timestamps would miss real elapsed expiry while blocked. See [PostgreSQL current-time semantics](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT) and [row-lock semantics](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS).

The lock-wait tests explicitly prove `xact_start < deadline <= clock_timestamp()` before releasing the lock. The pgTAP delayed-insert trigger additionally crosses expiry during a later write and asserts rollback of approval, queue, scan and raw cleanup effects.

The guarded transition is the final clock check after all potentially blocking writes, with authority locks retained until transaction end. A PL/pgSQL function cannot promise that a caller will physically `COMMIT` before a timestamp after returning, nor eliminate process scheduling/WAL latency after its final instruction. The service RPC uses its normal single-call transaction. This repair closes the demonstrated wait-before-authoritative-transition race; it does not claim a wall-clock guarantee for arbitrary caller-controlled transactions.

### Adversarial coverage and validation

- `tests/scan-phase-f-fencing.test.cjs` / `tests/helpers/scan-fence.cjs`: observed raw- and output-lock lease expiry, terminal-error lease expiry, job deadline expiry, output-writer expiry, still-valid success, changed lease, cancellation, replacement, scan deletion, inactive account and direct Auth deletion. Tests inspect trust/recognition rows and repeated completions; ordinary rejections must return false rather than pass through unrelated SQL errors.
- `supabase/tests/database/sanitizer_completion.test.sql`: **23 repair assertions** (13 original plus 10 already present when this independent review began), including grants, valid/idempotent completion, raw cleanup rejection, and post-write expiry rollback. **433 total assertions across 9 SQL files**, all passed after fresh reset/replay.
- DB lint passed with no schema errors. Generated public TypeScript types match the local schema and are unchanged in Git.
- Final runtime totals are recorded in the ledger below.

## B. Phase F completion

### Architecture and worker execution

The separate [`server/sanitizer`](../../server/sanitizer/README.md) package pins Node 24.19.0, Sharp 0.35.4 and libvips 8.18.6, with its own frozen pnpm lockfile. Mobile dependencies and app/native files remain unchanged. The coordinator has the lifecycle service port; disposable decoder containers have no database credentials. A local loopback-only CLI performs claim/run/recover through existing Phase B RPCs, without adding ingress, Storage transport or a queue poller.

A job binds opaque job, scan, lease, input and output IDs, expected revision/generation, digest and deadline. The coordinator independently inspects admitted server bytes, verifies the registered input digest, mounts an owned immutable source, encodes in one container and fully verifies in a fresh second container, publishes an exclusive owned output, then requests database approval. Only an acknowledged true completion returns `SUCCESS`/`SANITIZED`. Rejection, failure, cancellation, timeout and ambiguous `PENDING` are explicit results. A transport timeout keeps the COMMITTING journal and output because the database may have committed.

Cancellation before publication discards late decoder output. Durable database cancellation/replacement/deletion serializes with completion: whichever transaction obtains authority first wins, and a stale worker cannot undo the fence. A local signal after a committed database transition cannot retroactively revoke it. Integration tests execute actual service-role claim/finish/cleanup RPCs with Docker decoding for both successful publication and cancellation before finish.

### Sanitizer policy and malformed corpus

Server-owned structural admission accepts JPEG, PNG and static WebP at at most 25 MiB and 12 million pixels; this source harness is distinct from the future 4 MiB prepared-JPEG ingress contract. It bounds metadata to 64 KiB, checks signatures/dimensions/container boundaries and PNG CRCs, and rejects appended/concatenated payloads, unsupported formats and animation markers. Sharp performs full decode before resize, rejects warnings, enforces channel/pixel limits, orients exactly once, converts to sRGB, flattens alpha on white and encodes a new JPEG from raw pixels. All APP/COM segments are removed and the result is decoded and inspected again. Output has a 2048 long edge, minimum 256 short edge and 4 MiB cap.

**39 preserved codec tests pass.** The corpus contains 26 entries: 5 accepted formats/variants and 21 rejections. Twenty-five entries also execute in bounded Docker; the 25 MiB+1 fixture is rejected by parent admission. All eight JPEG EXIF orientations verify decoded corner pixels and resulting dimensions. PNG/WebP transparency yields white pixels. Decodable synthetic EXIF GPS/camera/time, ICC and XMP are removed; inserted APP13/IPTC, comments and JFXX markers also disappear. Verifier tests reject residual metadata, wrong dimensions, corrupt pixels and oversize output.

Limitations remain explicit: APP13/JFXX markers are not complete real-camera fixtures; PNG/WebP orientation lacks pixel fixtures; this is not exhaustive fuzzing/polyglot detection or a color/HDR fidelity guarantee. Structural parser ancestry is shared with Phase E, and the separate verifier uses the same Sharp/libvips library. Neither is independent-parser/library evidence.

### Docker and resource enforcement

The pinned base digest is `node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`. Final image build passed. The launcher enforces UID/GID 1000, read-only root, no network, all capabilities dropped, no-new-privileges, one read-only input mount, no log driver, 192 MiB memory including swap, one CPU, four CPU seconds, 32 PIDs, 64 FDs, no core files, 8 MiB file-size limit, 1 MiB shared memory and 8 MiB noexec/nosuid/nodev tmpfs. A five-second in-container GNU timeout remains effective if the parent dies. Parent timeout/cancellation kills the actual container and removes it; daemon uncertainty leaves a durable recovery obligation.

Local cgroup v2 probes actually triggered OOM kill (exit 137 and `OOMKilled`), CPU-limit kill, PID rejection and tmpfs `ENOSPC`. Isolation probes checked effective capabilities, UID, no-new-privileges, loopback-only interfaces and cgroup memory/PID/CPU values. Deadline/cancellation tests verified termination, and the internal watchdog stopped an idle child after five seconds. These are enforcement tests, not merely checks that Docker accepted flags.

Original implementation synthetic deterministic-noise measurements are in [resource evidence](evidence/scan-phase-f-resources.json). RSS is the decoder process's `/proc/self/status` high-water mark, not container-wide peak or coordinator memory. Elapsed/CPU cover the worker; process time also includes container startup/inspection. Values are single local runs, not performance percentiles.

| Source dimensions | Input bytes | Output bytes | Worker elapsed ms | CPU ms | Peak RSS KiB | Process ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1024x768 | 648,599 | 460,586 | 117.3 | 137.8 | 102,932 | 611.0 |
| 2048x1536 | 2,592,437 | 1,840,809 | 379.0 | 330.9 | 126,484 | 844.4 |
| 4000x3000 | 9,895,710 | 1,293,447 | 960.4 | 962.7 | 163,184 | 1702.6 |

### Cleanup, recovery and privacy

A Linux kernel `flock` serializes import, processing and recovery across coordinators and releases after process death. Tests verify a second coordinator is refused, stale PID contents do not block recovery, and SIGKILL releases the actual lock. Admission allows one incoming file, one active job and at most 16 journals per store. Decoder disk is hard bounded; host artifact bounds are application-enforced and still require hosted filesystem quotas.

Files use opaque UUID names in canonical private directories, no-follow regular-file reads, owner/hardlink checks and exclusive creation. Journals are fsynced and atomically replaced; publication is fsynced before the database call. Recovery removes orphan intermediates, stops named leftover containers, and keeps ambiguous or approved output until a Phase B cleanup claim authorizes its registered ID. It never follows a returned object path. Physical deletion precedes acknowledgement; false/failed acknowledgements retain obligations. Repeated recovery and actual inventory cleanup are tested. Rejected work also retains its cleanup journal rather than forgetting registered inventory.

The local harness assumes one exclusive store and trusted coordinator UID/operator. The global cleanup RPC has no store selector; distributed claim ownership is a hosted adapter concern. If cleanup committed but its response was lost, image bytes are already deleted and a bounded local journal can remain pending for operator reconciliation. No additional database schema was introduced to solve that deployment concern. Cleanup scheduling, retention and fleet-wide reconciliation remain release gates.

Diagnostics select safe categories and resource metrics; operational output selects job ID/status/category. Tests exercise suppression of raw exceptions, paths and credential-like strings. No image bytes, metadata, digests or leases enter logs. The binary stdout image pipe is bounded transport, not a logging sink. No AI/provider call occurs.

## Final validation ledger

| Check | Result |
| --- | --- |
| Exact historical lock-wait regression | Failed as required (`true !== false`); fixture cleanup and restoration completed |
| Fresh database reset/replay | Passed with new forward migration |
| SQL/pgTAP | 433 assertions / 9 files passed; 23 repair assertions |
| DB lint | Passed; no schema errors |
| Generated types | No drift; generated file unchanged |
| Worker tests | 77 passed, 0 failed, 0 skipped; includes 39 preserved codec tests |
| Docker build | Passed from pinned base/frozen package lock |
| Local CLI initialization | Smoke test passed |
| Docker execution/resource/corpus | Passed; JSON measurements linked above |
| Phase B / C / foundation / Phase F lock regressions | 48 passed: foundation 10, Phase B 15, Phase C 11, Phase F lock waits 12 |
| Full mobile Jest suite | 261 tests / 21 suites passed, including all Phase E/D suites |
| Security/client boundary Node tests | 8 named tests passed |
| Root and worker strict TypeScript | Passed |
| ESLint | Passed with zero warnings |
| Deno check/lint | Three entry points checked; all 10 source files linted |
| Mobile export | Passed for Android, iOS and web |
| Formatting and whitespace | Passed; tracked and every untracked file checked |

Initial failures were fixed without reducing production limits or weakening assertions: fixture cleanup attempted to extend the raw writer deadline; the PID probe hit its FD limit first and now uses ignored stdio to isolate PID enforcement; one recovery assertion incorrectly expected output deletion when only the raw image was being acknowledged; worker TypeScript needed explicit known pipe nullability. The first backend run began before Edge Functions were served and produced HTTP 502 failures; the final run uses the running local Edge server. The sandbox Node runner reported file wrappers for boundary tests; only the host run's eight named cases are counted.

## External gates and owner decisions

No further owner decision is needed to review this local Phase F implementation. Production requires hosting/runtime selection, actual-host cgroup and filesystem quotas, supervisor headroom/load measurements, hardened daemon/dependency/image review, immutable Storage transport, queue ownership, cleanup scheduling/retention/acknowledgement reconciliation, and monitored operational ownership. Processing admission stays disabled until those gates and ingress/provider requirements are satisfied. No production deployment is implied.

Representative real camera metadata, PNG/WebP orientation, blended alpha edges, color/HDR, near-limit real images and visual quality remain unvalidated. Phase E native build/link and physical Android/iOS/device lifecycle gates remain unchanged. Phase G/H are not started.

## Files and review disposition

Exact Git inventory at review completion (all changes unstaged; index empty; HEAD at the reviewed base):

```text
 M docs/research/SCAN_PHASE_B.md
?? docs/research/SCAN_PHASE_F.md
?? docs/research/evidence/scan-phase-f-lease-expiry.json
?? docs/research/evidence/scan-phase-f-owner-review.json
?? docs/research/evidence/scan-phase-f-resources.json
?? server/sanitizer/.dockerignore
?? server/sanitizer/Dockerfile
?? server/sanitizer/README.md
?? server/sanitizer/cli.ts
?? server/sanitizer/codec.ts
?? server/sanitizer/contracts.ts
?? server/sanitizer/coordinator.ts
?? server/sanitizer/image-reader.ts
?? server/sanitizer/inspection.ts
?? server/sanitizer/lifecycle.ts
?? server/sanitizer/package.json
?? server/sanitizer/pnpm-lock.yaml
?? server/sanitizer/policy.ts
?? server/sanitizer/review/lease-expiry-repro.cjs
?? server/sanitizer/runtime.ts
?? server/sanitizer/service-rpc.ts
?? server/sanitizer/storage.ts
?? server/sanitizer/tests/codec.test.ts
?? server/sanitizer/tests/coordinator.test.ts
?? server/sanitizer/tests/fixtures.ts
?? server/sanitizer/tests/integration.test.ts
?? server/sanitizer/tests/resource.test.ts
?? server/sanitizer/tests/review-runtime.test.ts
?? server/sanitizer/tests/runtime.test.ts
?? server/sanitizer/tsconfig.json
?? server/sanitizer/worker.ts
?? supabase/migrations/20260928010000_sanitizer_completion_fence.sql
?? supabase/tests/database/sanitizer_completion.test.sql
?? tests/helpers/scan-fence.cjs
?? tests/scan-phase-f-fencing.test.cjs
```

Final local state: zero Auth users, scans, inventory rows and Storage objects; processing disabled; no remaining Phase F containers.

Tracked code, historical migrations, root dependencies and generated types are unchanged. The only modified tracked file is the Phase B erratum; all implementation/repair/test/evidence files above are new or inherited untracked work.

**PHASE F READY FOR CHECKPOINT** for its local implementation and narrow Phase B repair. This report records the completed owner review preceding the requested checkpoint.

## Independent owner review — 2026-09-28

This review inspected the full tracked diff, all 33 inherited untracked files (including the isolated package lock), the Phase A/B contracts, security/architecture documents, worker stages and database transaction paths. It did not rely on the completion ledger. At review entry, source already contained single-flight Docker termination, post-inspection/removal deadline checks, shared-raw cleanup receipt distribution, three runtime review tests, two additional cleanup tests, and ten additional SQL assertions. These are inherited changes, not fixes authored by this review. Their missing documentation explains the outdated 72/13 test counts. Original evidence is preserved.

### Database conclusions

The exact historical function was restored temporarily in the disposable local database. A separate session held raw inventory while completion started valid; `pg_stat_activity` confirmed the lock wait; real database time passed the lease before unlock. The old function returned true, violating the rejection assertion. A `finally` block restored the forward migration; the identical race then passed with false and no authoritative writes. The temporary harness initially matched the assertion message too strictly; its corrected negative control also verified actual=true/expected=false. Both runs restored the repair and removed fixtures. No historical migration was edited.

`clock_timestamp()` is intentional and correct. Both decisive checks use database wall time; transaction-start `now()`/`current_timestamp` cannot observe the wait. Application `Date.now()` can reject early but cannot grant authority. Post-lock snapshots of both inventory rows catch cleanup and deadline changes; account/Auth, scan and job locks protect lifecycle, revision, generation and lease ownership. The final clock fence follows every tentative write, with no subsequent SQL operation in the success branch. The documented physical-COMMIT timing limitation remains: arbitrary caller transactions and WAL/scheduling latency are outside a function's final instruction.

The exception block encloses approval, raw cleanup request, recognition eligibility, scan and job changes. Delayed-write tests cross both lease and job deadlines; an unrelated later-write exception propagates and rolls everything back. Terminal error expiry rolls back generation, job, scan and inventory changes. Locks taken before the exception block remain held through the outer transaction. No new repair defect was found; the migration is unchanged by this review.

Added a twelfth real lock-wait regression holding the **output** inventory row across lease expiry. Strengthened lease/deadline/writer rejections to assert running job, sanitizing scan and untouched raw cleanup request. All 12 cases pass: raw lease, output lease, terminal error lease, job deadline, output writer deadline, valid completion, changed lease, cancellation, replacement, scan deletion, inactive account and Auth deletion. Duplicate/stale retries remain fenced. Account lifecycle denial can raise `ACCOUNT_NOT_ACTIVE`; this aborts the transaction safely. The six similarly named coordinator mock tests only establish handling of a false acknowledgement; actual fencing evidence comes from the live SQL/RPC tests.

### Worker conclusions and limits

The trusted coordinator admits actual signatures/bytes and binds the registered digest; opaque IDs control all artifact paths. The encoder receives one read-only file, no credentials, output directory or Docker socket. The parent checks the actual output and a fresh restricted verifier fully decodes it before exclusive publication and database completion. That is a real process/authority boundary; the shared parser and Sharp/libvips remain correlated dependencies. Filename extensions and client MIME are not authority.

The preserved 26-entry corpus passes (5 accepted, 21 rejected); 25 entries execute in Docker and the oversized entry is rejected before launch. All eight JPEG orientations, including mirrors, pass corner-pixel checks. Transparent PNG/WebP fixtures become white. Synthetic real EXIF/GPS, ICC and XMP disappear, as do inserted APP13/JFXX/comment segments. Real-camera metadata, PNG/WebP orientation, partial-alpha edges and color/HDR fidelity remain open, as documented above.

Fresh cgroup probes demonstrate memory OOM termination, CPU termination, PID denial, tmpfs exhaustion, restricted UID/capabilities/network/root, and watchdog/cancellation termination. The fresh 12 MP decoder high-water RSS is **154,356 KiB = 150.7 MiB**, compared with the inherited **163,184 KiB = 159.4 MiB** (not 163 MiB). Both fit the 192 MiB container limit in these single runs. Neither measures total coordinator/fleet memory or establishes workload percentiles. Fresh measurements are preserved separately in [owner-review evidence](evidence/scan-phase-f-owner-review.json).

Cleanup retains rejected and ambiguous obligations, removes intermediates, protects current/uncertain outputs until authorized cleanup, and retries acknowledgements. Shared raw IDs are reconciled across retry journals; live attempts prevent premature acknowledgement. Kernel-lock crash release and orphan recovery pass. Filesystem power-loss durability, hosted quotas, global cleanup claim routing and acknowledgement-loss reconciliation remain deployment gates. The local tests do not establish host power-loss recovery.

Operational logging uses selected status/category/job/measurement fields; raw exceptions and image metadata are suppressed. Binary stdout is a bounded image transport. CLI `init` returns the newly created worker-owned directory as an operator control response; it is not a user source path or telemetry. No real household images or provider calls were used.

### Review changes and independent validation

- Fixed six formatting failures in `coordinator.ts`, `runtime.ts`, coordinator/integration/runtime-review tests, and `tests/helpers/scan-fence.cjs`.
- Added output-row fencing coverage and stronger rejected-state assertions in the fencing suite/helper.
- Corrected this report's counts, missing file inventory and RSS units; added the separate owner-review evidence JSON. No production logic or SQL migration was changed by this review.
- Fresh reset/replay, focused 23-assertion SQL file, all 433 SQL assertions/9 files, DB lint and generated-type drift passed.
- All 77 worker tests passed, including 39 codec tests, real Docker resource/corpus execution and service-RPC integration. After formatting, 28 affected coordinator/runtime/integration tests and worker strict TypeScript passed again.
- All 48 backend regressions passed (10 foundation, 15 B, 11 C, 12 F). All 261 mobile tests/21 suites, 8 static boundary tests, root TypeScript, ESLint, formatting, three Deno entry-point checks/10-file lint, and Android/iOS/web export passed.
- Docker image build passed from the pinned base/frozen lockfile. Actual-local-secret and developer-path scanning plus tracked/untracked whitespace checks passed. No secrets were printed.

The initial sandbox package runner stalled; successful project/DB/Docker checks used the approved host execution environment. The initial formatting failure and temporary negative-control harness mismatch are recorded above; neither weakened a production limit or assertion. Final disposition applies to the reviewed local Phase F checkpoint only. Processing stays disabled; hosted/device gates remain open. Phase G was not started.
