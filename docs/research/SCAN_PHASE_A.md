# Camera + Ingredient Scan Journey — Phase A evidence

Date: 2026-09-21. Scope: contracts, UX/security review and local upload/sanitizer experiments only. **Phase A owner review is complete; the architecture decisions below are approved, and one local checkpoint commit is authorized. Phase B and pushing are not authorized.** No mobile scan screen, scan endpoint/table/policy, AI provider, recipe integration or production connection was created.

## 1. Work present on resumption

HEAD was `efc88d6` (`feat: establish KitchenCam mobile and backend foundations`), following `c077872` and `d8d2159`. `main`, `origin/main` and `origin/HEAD` pointed to that commit. Both tracked and staged diffs were empty. There were **21 untracked Phase A files**, all inspected in full, including the isolated lockfile and both evidence files:

- `SCAN_CONTRACTS.md` and `SCAN_UX_REVIEW.md`.
- Executable schemas, provider-neutral recognition port, state machine and idempotency ordering specification; 13 passing Jest tests.
- Local SDK/S3 signing/upload tooling and **52 recorded observations**, including a completed real ten-minute wait.
- Sharp/libvips sanitizer and structural inspectors, disposable child-process supervisor, generated corpus and **46 recorded cases**.
- Isolated Sharp manifest/lockfile, reproduction README, evidence assertions and changed-artifact secret scanner.

The interrupted work was substantial and usable. No implementation was restarted. A temporary baseline copy/hash manifest was taken before edits. Both original evidence files remain byte-for-byte unchanged:

| File | SHA-256 |
| --- | --- |
| `evidence/scan-phase-a-upload.json` | `cd139120824de1d4189261b7fe091d544e633a502052bbbe6612f33b3993a8f6` |
| `evidence/scan-phase-a-sanitizer.json` | `8a9db232dbb85d7cd5ce84c6dea0e4a86a956165130d64fc19e21c7f2c2571fe` |

## 2. Incomplete work finished

The referenced Phase A report did not exist; architecture decisions, preparation limits, validation results and security/privacy conclusions had not been consolidated. Older API/architecture documents still assumed direct signed upload and deletion-based capability revocation. Research files needed formatting to pass the repository checks.

Resumption completed this report and reconciled those documents. Contract review added manual/image trust invariants, positive server versions, required drafts, empty-assessment rules, bounded deletion receipts, explicit confirmation acknowledgement/version, identity-change fencing and unknown-connectivity behavior. Added source-image admission and revised the initial full-decode limit to 12 MP.

Supplemental local upload tests measure concurrency, same-length overwrite with signed headers, cross-bucket substitution and verified cleanup. Expanded sanitizer evidence preserves the original corpus while adding actual GPS-tag verification, JPEG pixel-stream corruption, XMP/ICC removal, the 12 MP boundary and process-start-to-exit timing. These results are separate `*-resumed.json` files. No original successful test or security finding was discarded.

## 3. Contracts finalized for review

[SCAN_CONTRACTS.md](SCAN_CONTRACTS.md) is authoritative for this unimplemented journey. Research TypeScript defines strict source/prepared image, scan status, editable ingredient, confirmation, detection/assessment, safe error, upload capability, deletion receipt, route and telemetry schemas.

Operations cover image/manual creation; upload authorization and completion; sanitizer-gated recognition; status; photo replacement; manual fallback; revisioned draft editing; explicit confirmation; cancellation and deletion. UUID idempotency keys are owner/operation scoped. Authorization precedes replay; identical operation replay precedes stale-version rejection. Different payloads conflict. Replay never renews expired media/capabilities or resurrects terminal work.

Private image references bind revision, digest and sanitizer version. Provider identity/model/prompts/scores stay private. Public statuses/routes/events reject extra storage URLs/paths, credentials, bytes and provider envelopes. The separate transient upload envelope has a real lifetime of at most 600 seconds. An origin allowlist and live authorization remain server implementation requirements. No schema is treated as proof of ownership or sanitization.

## 4. State-machine result

The pure step/effect specification covers permission, camera, photo selection, preparation, upload, sanitization, queued/recognizing, editable confirmation, confirmed, failure, cancellation and offline/background overlays. The document separately defines durable server transitions, expiry and deletion.

Stale image revisions, effect generations and server versions are ignored. Identity reset increments the generation. Manual fallback/cancellation fence late recognition. Server cancellation stays pending until acknowledged. Confirmation requires selected ingredients, a positive current draft revision and a newer acknowledged server version. An outage cannot make existing queued/running status unreadable, and unknown connectivity does not falsely mean offline.

**20 focused tests pass** after review. These verify the specification, not native restoration, persisted jobs or transactional race protection. Resume still requires an authoritative validated status snapshot; no fake missed-stage replay is proposed. No UI state machine was wired into the application.

## 5–7. Upload mechanisms, actual expiry and security results

Evidence: [original upload matrix](evidence/scan-phase-a-upload.json), [supplement](evidence/scan-phase-a-upload-resumed.json). Local Node 24.19.0, Supabase Storage `v1.72.1`, existing private buckets and unchanged policies. Three disposable identities exercised anonymous, permanent owner and other-user paths. Images/invalid payloads were synthetic. Service authority minted capabilities only inside the experiment.

| Mechanism/control | Actual observation | Meaning |
| --- | --- | --- |
| Direct client Storage upload/signing | Anonymous/permanent denied; session-signed S3 PUT 403 | Existing denial-by-default policies hold |
| SDK `createSignedUploadUrl`, `upsert: false` | Signed JWT lifetime **7,200 seconds**; initial PUT 200 | Fails the 600-second capability requirement |
| SDK after ten minutes | PUT **200 at 605.559 s** after token `iat` | A client/UI deadline cannot shorten the real capability |
| S3 SigV4, `X-Amz-Expires=600` | Same URL PUT **200 at 590.030 s**, **400 at 605.009 s**; newly signed control 200 | Real wall-clock expiration demonstrated on local Storage |
| SDK changed expiry payload | 400 | Editing the signed claim invalidates the signature |
| SDK existing-object replay / `x-upsert: true` | 400; original bytes verified unchanged | Prevents replacement while the object exists |
| SDK concurrent PUT | One 200, one 400; winner bytes verified | One object-creation winner in this two-request test |
| SDK after deleting object | 200 | Object deletion does **not** consume/revoke the upload token |
| S3 repeated PUT | 200; bytes changed | Overwrite permitted |
| S3 signed `If-None-Match: *` | Replay 200; bytes changed; after deletion 200 | Does not enforce single-use/create-only behavior locally |
| S3 MIME + length + condition all signed | Different same-length payload 200; bytes changed | Signed size/type are not content immutability |
| S3 concurrent conditional PUT | Both 200 | No create-only race protection in this test |
| Other user holding either capability | 200, including with another user's bearer token | Both are transferable bearer capabilities, not live-owner authorization |
| SDK/S3 path substitution | 400 / 403 | Signature binds target path |
| SDK/S3 bucket substitution | 400 / 403 | Signature binds bucket |
| GET using upload/PUT capability | 400 / 403 | Tested capabilities do not grant raw reads |
| Raw list/read/read-signing | No list entries; read/sign denied for all three identities | Raw privacy boundary holds |
| MIME `text/plain` | SDK 400 / S3 415 | Bucket MIME allowlist checks the claim |
| Nonimage bytes claiming image MIME | Both 200 | MIME checks do not decode or sanitize |
| 4 MiB + 1 byte | Both 200 | Existing 10 MiB bucket does not enforce the proposed scan cap |
| 10 MiB + 1 byte | SDK 400 / S3 413 | Existing bucket cap enforced |
| Changed S3 signed MIME/length | 403; valid length control 200 | Header binding works for those headers |
| Capability issued before Auth deletion | Both late PUTs 200 after fixture drain and Auth deletion | Deletion needs explicit late-write fencing/inventory |

The genuine ten-minute test was already completed in the interrupted session and was not unnecessarily repeated. Recorded assertions were rerun, and the supplemental live matrix was run during resumption. The full two-hour SDK expiry boundary was **not** waited out; its signed claim, official API contract and successful post-ten-minute use establish the incompatibility. Expiration admission for uploads started just before the deadline, slow streams, hosted behavior and larger concurrency remain unmeasured.

The Auth deletion experiment models capability survival after cleanup plus `admin.deleteUser`; it is not a concurrent end-to-end app deletion/scan integration test. That integration does not exist. These observed failures are architecture blockers, not successful security controls.

## 8–9. Sanitizer prototype/runtime and malformed images

Evidence: [original 46-case corpus](evidence/scan-phase-a-sanitizer.json), [expanded 49-case corpus](evidence/scan-phase-a-sanitizer-resumed.json). Runtime: **Node 24.19.0, Sharp 0.35.4, libvips 8.18.6, Linux x64**, Intel i5-8265U. The isolated package is outside the app, installed with pinned pnpm 11.19.0 and a frozen lockfile.

Prototype stages: bounded bytes → strict format/container structure and metadata budget → measured dimensions/channels/pages → full decode with warnings treated as failures → orientation correction, sRGB, white alpha flattening → fresh JPEG encoding from raw pixels → output structure/dimensions/size/metadata and second decode verification. Source preparation and server sanitization have separate limits. The broader PNG/WebP decoder corpus is research coverage; public prepared uploads remain JPEG only.

Expanded outcomes: **19 accepted, 28 rejected, 2 intentionally killed supervisor probes**. All expected outcomes matched. Accepted files include baseline/progressive JPEG, PNG, static WebP, all eight EXIF orientations (corner pixels verified), GPS EXIF and XMP/ICC fixtures, and bounded noise rasters. Output metadata was absent. The GPS fixture now verifies the GPS IFD pointer and latitude/longitude tags exist, not merely some EXIF. Misleading filename extension does not control format admission.

Rejected cases cover MIME mismatch, malformed header, JPEG/PNG/WebP truncation, PNG CRC corruption, valid containers with invalid JPEG/PNG/WebP pixel streams, appended payloads in all three formats, concatenated JPEG, SVG/GIF/TIFF, excessive JPEG/PNG metadata, compressed PNG metadata, huge dimensions, animation markers, byte limits, undersized dimensions, revised source pixel limit, and a highly compressed 64 MP raster. This is a bounded adversarial corpus, **not exhaustive polyglot detection or decoder fuzzing**. Animation cases test markers; there is no native animated-picker validation.

## 10. Resource measurements

Single observations from the resumed run, concurrency one. These are neither p95 values nor hosted/mobile benchmarks.

| Case | Worker wall ms | Worker CPU ms | Process wall ms | Peak RSS MiB | Output bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small JPEG | 11.58 | 12.00 | 92.65 | 80.17 | 2,476 |
| Prepared 2048×2048 noise JPEG | 206.82 | 217.86 | 283.37 | 121.85 | 2,500,545 |
| 12 MP noise source | 274.74 | 328.31 | 351.95 | 150.14 | 1,293,447 |
| 24 MP solid source, comparison only | 112.03 | 145.84 | 183.58 | 166.07 | 16,775 |
| 24 MP noise source, comparison only | 427.98 | 486.58 | 505.36 | **192.56** | 876,165 |
| Deliberate CPU stall | unavailable after kill | unavailable | 5,004.95 | 77.59 sampled | none |
| Deliberate allocation loop | unavailable after kill | unavailable | 108.50 | **226.75 sampled** | none |

Worker timing begins after module loading and includes file read, validation/decode/re-encode/output checks. Process timing includes startup and shutdown. RSS uses `/proc/self/status` VmHWM for completed workers; killed workers have sampled RSS only. `rusageMaxRssKiB` is also retained in raw evidence but often disagrees substantially with post-exec `/proc` measurements; do not present it as incremental image memory or combine the two metrics. Supervisor/fixture-generation memory is excluded.

The supervisor samples at 10 ms, requests kill above 192 MiB, and kills at a five-second wall deadline. Native allocations are outside the 96 MiB JavaScript heap setting. The allocation probe overshot the sampled threshold by about 35 MiB, and the 24 MP candidate briefly exceeded it without being killed. Therefore **this prototype does not prove a hard memory cap**. It proves rejection behavior, measured cost and termination signals. No malformed fixture itself caused a measured hang/OOM; probes intentionally test supervisor failure paths separately.

## 11. Owner-approved sanitizer architecture

The owner approved an isolated **Node + Sharp/libvips worker**, driven by a durable job/lease ledger, with a disposable decoder process and OS/container-enforced memory/CPU limits, bounded disk/input/output, restricted network and minimal credentials. Start validation at one image per worker, a 192 MiB decoder cap and a five-second deadline; size the supervisor/container separately with headroom. These deployment limits are proposed and must be tested under actual cgroups and load before accepting them.

Keep Supabase Edge Functions for appropriate lightweight authentication, admission and coordination, not heavy image sanitization. Production hosting/runtime selection remains unresolved and must not be provisioned now. The official [Edge limits](https://supabase.com/docs/guides/functions/limits) list 256 MB memory, two seconds CPU and unsupported multithreaded libraries including Sharp/libvips. The measured Node run is **not** an Edge runtime test. A WASM alternative would need its own corpus, CPU/memory measurements and support review; it was not tested or selected.

Only a trusted parent publishes a new immutable sanitized object and records its digest/revision/sanitizer version after checking the active owner, current lease and cancellation/deletion state again. Never approve a mutable upload path and then ask a future provider to read whatever bytes happen to be there. Decode children should receive only bounded local input/output access, not the service role. Hard containment, queue recovery, retention scheduling and deployment remain unimplemented.

## 12. Owner-approved upload architecture

The owner approved a separate **authenticated bounded upload ingress**, using Supabase for identity, authorization records, private Storage and durable jobs. Keep control-plane JSON in Edge Functions; stream bytes through the ingress without loading unbounded request bodies in the BFF.

The ingress must check live owner/account/revision and a hashed one-use authorization, enforce a real deadline no longer than 600 seconds (including bounded intake), atomically claim it, cap the stream at 4 MiB regardless of headers, enforce request/body size and type restrictions, bind the target to that authorization, and write a unique quarantined object with no overwrite path. Recheck cancellation/deletion before publishing the upload/job. Lost acknowledgements reconcile to the existing operation; retry does not reopen a consumed target. A cleanup inventory/tombstone must cover partial uploads, worker crashes and late writes. Sanitizer output is a separately immutable artifact.

Neither tested direct Storage mechanism meets the combined expiry, single-use, overwrite and deletion requirements. Do not relabel the SDK's two-hour capability as ten minutes, or assume S3 `If-None-Match` is enforced. The owner explicitly excluded the SDK two-hour capability as the KitchenCam security boundary and direct S3 presigned PUT as the final architecture. No proxy/ingress product feature was implemented in this phase.

## 13. Image preparation policy

| Limit/behavior | Phase A disposition |
| --- | --- |
| Source bytes ≤25 MiB | Owner provisionally approved as local admission ceiling; reject before full decode/read where practical; no base64 |
| Full-decode pixels ≤12 MP | **Owner provisionally approved** as an engineering safety limit; 24 MP remains research comparison only because memory margin was inadequate |
| Long edge ≤2048 px, each dimension ≥256 px | Long-edge ceiling provisionally approved; retain documented minimum; preserve aspect ratio, no upscale or silent crop; reject an aspect ratio that violates the minimum after resize |
| Prepared bytes ≤4 MiB | Owner provisionally approved, measured independently; bucket's 10 MiB limit is insufficient and is unchanged in this phase |
| Prepared MIME JPEG, quality 80 reference | JPEG provisionally approved under the documented policy; quality 80 remains a reference setting; exact native compression setting/output quality needs device validation |
| Orientation/metadata | Correct orientation before stripping all EXIF/GPS/XMP/IPTC/ICC; re-encode upright sRGB pixels; verify server-side too |
| Inputs | JPEG/PNG/static WebP in reference source admission; no direct HEIC/HEIF/AVIF/RAW/SVG/GIF/TIFF or animated upload |
| Native high-resolution/HEIC | Deferred; bounded native subsampling/conversion and real-device memory/quality tests required before extending support |
| Metadata budget | 64 KiB in prototype; compressed PNG metadata and unknown chunks rejected before expansion |
| Expiry | Real authorization ≤600 seconds; raw/transient media ≤24 hours from first upload, earlier where possible; no retry extension |

The owner provisionally approved the 12 MP/25 MiB policy as engineering limits, **not a guarantee of safe mobile memory use**. The 12 MP ceiling is not a permanent product requirement. Physical Android/device testing may justify revising it if a proven bounded-downsampling path safely handles larger images. Phase A did not complete native-device validation. Capture should request a bounded resolution; unsupported gallery assets offer another-photo/manual recovery. Photos from representative low/mid-tier Android and small iPhones, native orientation/EXIF behavior, HEIC and quality/recognition effects remain unvalidated. There is no AI quality benchmark in Phase A.

## 14–15. UX and security/privacy review

[SCAN_UX_REVIEW.md](SCAN_UX_REVIEW.md) covers permission denial/restriction, unavailable camera/cloud asset, picker cancellation, preview/retake, offline/background, corrupt images, unavailable recognition, empty/abstained result, correction, failed save/conflict, cancellation pending and manual completion. Loading/error/empty/success and recovery paths are specified. Targets, safe areas, keyboard, large text, focus, announcements and reduced motion follow the existing native design system.

The unavailable-recognition notice precedes any real household upload: “Photo recognition isn’t available yet. Add your ingredients to continue.” Preserve existing manual edits; start an empty editor only for a new draft. No fake detections/progress, quota debit, recipe request or usable Find recipes action exists. Native accessibility and representative-user review are deferred and are not claimed by these contract tests.

Security review found no client storage-policy relaxation or provider-secret exposure. Actual local credentials are read in memory only by guarded loopback tooling; reports contain safe codes/statuses/dimensions/metrics. The fixture matrix shows bearer capability leakage enables upload even across accounts and after deletion. Immediate access denial, revision/lease fencing and minimized cleanup tombstones must precede asynchronous deletion. Retention applies to abandoned/failed uploads as well as success.

Metadata stripping cannot remove sensitive pixels such as faces/documents. Preview, processing notice, manual alternative, strict telemetry allowlists and no real-user uploads while unavailable remain required. Opt-in retained derivatives and downstream processor deletion/retention still need final privacy review. No legal compliance conclusion or final provider-retention promise is made here.

## 16. Files changed

The final tree contains documentation updates in `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md` and `docs/research/AI_RUNTIME_SPIKE.md`. `tooling/generate-database-types.cjs` now canonicalizes the CLI output to one final newline, so both schema comparison and Git whitespace checks pass. `src/types/database.generated.ts` remains identical to HEAD; there is no schema or type change.

Phase A artifacts added by this checkpoint (including preserved interrupted work):

- `docs/research/SCAN_PHASE_A.md`, `SCAN_CONTRACTS.md`, `SCAN_UX_REVIEW.md`.
- `docs/research/evidence/scan-phase-a-{upload,sanitizer,upload-resumed,sanitizer-resumed}.json`.
- `tests/scan-phase-a-contracts.test.ts`.
- `tooling/scan-phase-a/{README.md,package.json,pnpm-lock.yaml,contracts.ts,state-machine.ts,idempotency.ts,recognition-port.ts,local.cjs,sigv4.cjs,upload-spike.cjs,upload-supplement.cjs,image-inspection.cjs,sanitizer.cjs,sanitize-worker.cjs,sanitizer-spike.cjs,evidence.test.cjs,review-scan.cjs}`.

The original two JSON files and isolated lockfile are preserved. Other inherited research code was extended or formatted as needed. App features, app dependencies, migrations, bucket policies and production configuration were not changed.

## 17. Exact validation commands and results

Commands below run from the repository root. The shell's system Node is not authoritative; project commands explicitly select Node 24.19.0 / pnpm 11.19.0. The local stack was already healthy on resumption, with zero Auth users and zero storage objects. No database reset was necessary: no schema migration was changed.

| Exact command | Result |
| --- | --- |
| `fnm exec --using 24.19.0 pnpm --dir tooling/scan-phase-a install --ignore-workspace --frozen-lockfile` | Passed; already up to date, pnpm 11.19.0 |
| `fnm exec --using 24.19.0 pnpm exec jest tests/scan-phase-a-contracts.test.ts --runInBand` | Inherited 13/13; extended 19/19 before the source-limit test; final 20 tested by full project suite |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/upload-spike.cjs` | Completed before resumption: 52 recorded observations including genuine 605-second wait; source and evidence reviewed, recorded assertions rerun |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/upload-supplement.cjs` | Passed six supplemental observations and verified object/user cleanup |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/sanitizer-spike.cjs > /tmp/kitchencam-phase-a-sanitizer-resumed.log` | Passed 49 cases; separate resumed JSON, original evidence preserved |
| `fnm exec --using 24.19.0 pnpm exec node --test tooling/scan-phase-a/evidence.test.cjs` | 6/6 passed |
| `fnm exec --using 24.19.0 pnpm check` | Passed TypeScript, ESLint, Prettier, **36 Jest tests in seven suites** (20 Phase A), and **eight boundary/security tests** |
| `fnm exec --using 24.19.0 pnpm deps:check` | Passed, dependencies up to date |
| `fnm exec --using 24.19.0 pnpm run doctor` | 21/21 passed |
| `fnm exec --using 24.19.0 pnpm export:check` | Passed Android/iOS Hermes and web exports; harmless NO_COLOR/FORCE_COLOR warnings |
| `fnm exec --using 24.19.0 pnpm db:test` | 71/71 pgTAP assertions, five files passed |
| `fnm exec --using 24.19.0 pnpm db:lint` | Passed; no schema errors/warnings |
| `fnm exec --using 24.19.0 pnpm db:types` then `fnm exec --using 24.19.0 pnpm db:types:check` | Passed after canonicalizing CLI trailing whitespace in the generator; generated types identical to HEAD |
| `fnm exec --using 24.19.0 pnpm backend:test` | 10/10 actual local runtime integration tests passed |
| `fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/review-scan.cjs` | Passed; final 32 changed artifacts checked against four actual local secret values, without logging values |
| `git diff --check` | Passed; additional `git diff --no-index --check /dev/null <file>` checks passed for all 25 untracked files |

Transient failures: pinned pnpm's package-manager database and the Docker socket required the approved execution environment for some commands. The supplemental uploader initially duplicated differently cased Content-Type headers; using `Headers.set` repaired the test harness, then the full supplemental matrix passed. Initial full `check` stopped on research README formatting; it was formatted and the check rerun. The database type comparison initially differed only by one trailing blank line. `fnm exec --using 24.19.0 pnpm exec supabase gen types typescript --local > /tmp/kitchencam-phase-a-database-types.ts` generated a temporary comparison (requiring approved execution for the CLI telemetry cache); inspection showed no type/schema difference. Initially accepting that blank line made Git whitespace validation fail. The generator now removes only trailing whitespace and emits one final newline for both writing and comparison. The normal generation/exact-check workflow passed with the original tracked type file unchanged. A CLI `MaxListenersExceededWarning` occurred during diagnostic generation without failure. No security expectation was weakened to manufacture a pass.

## 18–19. Owner decisions recorded and remaining gates

Owner review is complete. The decisions are:

1. **APPROVED — upload architecture:** authenticated bounded ingress enforcing ownership, one-use authorization, bounded request/body size, type restrictions, target binding, cancellation fencing, account-deletion fencing, idempotency/reconciliation and cleanup. The SDK two-hour capability is not the KitchenCam security boundary; direct S3 presigned PUT is not the final architecture.
2. **APPROVED — sanitizer architecture:** isolated Node + Sharp/libvips worker with enforceable process/OS limits for decoding/re-encoding. Edge Functions perform appropriate lightweight authentication/admission/coordination only. Production hosting/runtime selection remains unresolved; no provisioning is authorized.
3. **PROVISIONALLY APPROVED — preparation limits:** 25 MiB source, 12 MP full decode, prepared long edge ≤2048 px, prepared JPEG ≤4 MiB under the documented policy. Existing storage hard ceiling unchanged. The 12 MP ceiling is an engineering safety limit, not a permanent product requirement; physical Android/device testing may support a change with proven bounded downsampling.

These approvals select the architecture and initial engineering policy; they do not prove implementation, OS containment, native-device behavior, hosted behavior or production readiness. The local observations and original experimental evidence above are preserved. Hard resource containment, hostile-stream deadlines, concurrency/load/fault recovery, late-write cleanup and absolute retention sweeps remain future implementation validation. Production runtime/hosting, costs and operational ownership remain unresolved.

Final taxonomy/duplicate rules, which successful assessments consume quota, native UX/accessibility/user research, retention notices/processor contracts, AI model/accuracy, licensing, pricing/quotas, countries, qualified privacy/legal/nutrition review and operating budget remain open. Existing Phase 0 gates are not closed by these upload/sanitizer results. No further Phase A execution requires a real provider or production access.

## 20–21. Git status and checkpoint

**Phase A validation snapshot before owner review:** HEAD remained `efc88d6` on `main`; seven tracked files were modified (six documentation files and the type-generation newline normalization), and 25 Phase A files were untracked. The index was unchanged/empty of staged changes; no staging, commit, push or history rewrite had occurred at that snapshot. All 21 interrupted artifacts remain present.

**Ready for Phase A checkpoint: YES; owner review is complete and the checkpoint commit is authorized.** Contracts, local experiments, focused tests, validation and documentation are complete. The tested direct-upload mechanisms fail the combined security requirements; that is an evidence-backed conclusion, not unfinished spike work. The owner approved the replacement architecture and provisional engineering limits as recorded above. No Phase B work began.

Final local inspection found **zero Auth users, zero Storage objects, zero Storage object policies and the same five foundation migrations**. Supplemental fixtures were removed and the original evidence hashes match. The local stack was already running on entry and is left running; no research process is left running. Native/hosted/production gates remain open. Checkpoint scope is one commit named `feat: establish secure scan architecture`, with no push or Phase B implementation. After committing, work stops for owner review.

## Primary references checked during resumption

- [Supabase SDK signed upload contract](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl): two-hour transferable upload capability.
- [Supabase S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility): supported operations and limits; local conditional PUT behavior is established by our measurements, not assumed from the S3 name.
- [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits): limits and Sharp/libvips restriction.
- [Sharp constructor safety options](https://sharp.pixelplumbing.com/api-constructor/): explicit pixel/channel bounds and warning behavior; defaults are not our policy.
- [Sharp output/metadata behavior](https://sharp.pixelplumbing.com/api-output/): metadata stripping and encoding controls, independently verified by output checks here.
- [Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/): native preparation candidate only; no package added and no native benchmark claimed.
