# Scan journey contracts — Phase A

Status: finalized Phase A contracts with executable specification tests; the owner approved authenticated bounded upload ingress and an isolated Node + Sharp/libvips sanitizer with enforceable process/OS limits. Phase A deployed no scan endpoints, mobile screens, tables, workers, or policies. See the owner decision record and preserved evidence in [SCAN_PHASE_A.md](SCAN_PHASE_A.md). Production hosting/runtime selection and provisioning remain unresolved. Phase B database implementation is now recorded in [SCAN_PHASE_B.md](SCAN_PHASE_B.md); the operations and HTTP projections below remain the adapter contract, not deployed scan endpoints.

This document refines the previously unimplemented scan subsection of API.md. It does not select an AI provider, implement recipe APIs, or close Phase 0 gates. The executable schemas live in `tooling/scan-phase-a/contracts.ts`; they are deliberately outside the mobile bundle. Future implementation can promote reviewed public contracts without importing the research tooling.

## Identity, envelopes, and boundaries

- `/v1` JSON uses camelCase and `schemaVersion: "1"`. Dates are RFC 3339 UTC. IDs are opaque UUIDs.
- Authenticate every server operation, derive owner from verified identity, and check live account status. Never accept a request-body owner as authority. Anonymous and permanent identities have identical private scan ownership rules.
- Responses use the existing `{ data, requestId }` / `{ error: { code, requestId, retryable, ... } }` pattern and `X-Request-Id`. Cross-owner IDs return a uniform `NOT_FOUND` without existence disclosure.
- Mutations require UUID `Idempotency-Key` and expected revisions where a resource already exists. See the ordering rules below.
- Only UUID scan IDs enter navigation. A local preview uses a scoped in-memory draft reference, never a file URI, image body, ingredient text, or capability URL in route parameters.
- Status, drafts, confirmed summaries, caches, navigation, and telemetry contain no object paths, image bytes, credentials, signed URLs, provider/model metadata, prompts, or raw exceptions. Strict schemas reject unexpected fields rather than silently copying them.
- Private server image references contain an image ID, revision, digest, and sanitizer version. The worker resolves the storage path internally and verifies the current approval; a branded type is not proof of sanitization.
- A transient upload response is a transport exception: a narrowly scoped capability URL and required headers must reach the uploader. It is memory-only, excluded from query persistence/breadcrumbs, and never embedded in the scan resource. The approved ingress URL binds an opaque authorization/target resolved server-side; the application must not treat its path as a domain identifier. The uploader also authenticates the current owner; possession of the transient authorization alone is insufficient. The tested direct Storage URLs remain research artifacts only.
- Production capability URLs must use HTTPS and an allowlisted ingress origin. The executable shape checks HTTPS; the environment-specific origin allowlist remains an implementation requirement. Local experiments alone use guarded loopback HTTP.

## Operations

| Operation | Request | Success and invariants |
| --- | --- | --- |
| `POST /v1/scans` | `source: camera/gallery` | `201` scan status; creates an image-based draft with image revision 1. Does not issue an upload or start recognition. |
| `POST /v1/scans/manual` | Editable `ingredients`, including an empty initial list | `201` status in `needs_confirmation`; image revision 0, sanitization `not_started`, manual fallback true. No upload/job/quota consumption. |
| `POST /v1/scan-uploads` | `scanId`, `expectedVersion`, `imageRevision`, client-measured prepared-image declaration (untrusted), registered `processingNoticeVersion` | Transient capability envelope; check active ownership, notice, admission/abuse limits, worker availability and recognition capability. Issue only for the current revision. No real-user upload while recognition is unavailable. |
| `POST /v1/scans/{id}/uploads/complete` | `uploadId`, `expectedVersion`, `imageRevision` | `202` status. Resolve target from the server authorization record; independently verify existence/size/type declaration and atomically enqueue sanitization. Client assertions cannot mark it passed. |
| `POST /v1/scans/{id}/recognize` | `expectedVersion`, `imageRevision` | `202` if eligible. Require passed sanitization on the same immutable bytes/revision and an available provider. Before sanitization, return conflict with safe status; do not enqueue recognition early. |
| `GET /v1/scans/{id}` | UUID route parameter | Owner-safe status projection, no media URL. Bounded polling; Realtime is not required. |
| `POST /v1/scans/{id}/photo-revision` | `expectedVersion` | Increment image revision, invalidate upload approvals/results, fence old jobs and schedule old media cleanup. Only for an unconfirmed image draft, with explicit discard/replacement intent. |
| `POST /v1/scans/{id}/manual` | `expectedVersion`, `imageRevision` | Atomically fence recognition, preserve user edits, enter manual `needs_confirmation`, release unused reservations, and schedule image cleanup. No fabricated detections. |
| `PUT /v1/scans/{id}/ingredients` | `expectedVersion`, `expectedDraftRevision`, complete editable list | Replace draft transactionally; increment draft revision and overall version. Editing a confirmed list invalidates its ready state until reconfirmed. |
| `POST /v1/scans/{id}/confirm` | `expectedVersion`, current positive `draftRevision` | Atomically validate selected rows and duplicate resolution; produce confirmation snapshot plus `confirmed` status. No recipe call. |
| `POST /v1/scans/{id}/cancel` | `expectedVersion` | Durable cancellation/fencing acknowledgement plus cleanup status. Reject subsequent processing/confirmation. A cancelled attempt is terminal. |
| `DELETE /v1/scans/{id}` | `expectedVersion` | `202` deletion receipt: `deletionId`, `acceptedAt`, `status`, `mediaDeleteBy`. Immediately deny ordinary scan access; retain minimal owner-authorized receipt/tombstone for retries until cleanup finishes. |

Creation is explicitly separated from upload issuance: the older draft `POST /scan-uploads` combined both. There are no existing scan clients/endpoints to migrate. Completion handles sanitization first; recognition is a separate eligible operation. Transport is the owner-approved authenticated bounded ingress. It must enforce ownership, one-use authorization, request/body limits, type restrictions, target binding, cancellation/account-deletion fencing, idempotency/reconciliation and cleanup. Neither tested direct Storage mechanism is the final architecture; hosting/runtime selection remains unresolved.

The schemas validate shape, not authorization or semantic truth. For example, normalization/canonical IDs submitted in a draft must be checked against the future versioned taxonomy; image metadata must be measured by the server; notice versions must match registered server policy. Unknown IDs or ambiguous mappings remain unresolved. The reviewed source admission contract is JPEG/PNG/static WebP, at most 25 MiB and 12 million pixels; prepared uploads are JPEG, at most 4 MiB, with each dimension between 256 and 2048. These owner-approved ceilings are provisional engineering limits. The 12 MP full-decode ceiling is not a permanent product requirement; physical Android/device testing may justify revising it when proven bounded downsampling safely handles larger images. Native conversion/HEIC support and native-device validation remain unvalidated. Limits and the measured revision from 24 MP are in the Phase A report.

## Public domain projections

`ScanStatus` contains:

- `scanId`, `source`, schema version and overall state;
- `revisions: { version, imageRevision, draftRevision }`;
- sanitization `{ state, imageRevision, updatedAt }`;
- recognition capability and manual-fallback flags;
- optional safe recognition assessment, editable draft, confirmation snapshot and typed failure;
- creation/update time and applicable expiry.

Server states are `awaiting_upload`, `sanitizing`, `queued`, `recognizing`, `needs_confirmation`, `confirmed`, `failed`, `cancelled`, `expired`. There is no durable permission, camera, background, or offline state. `recognitionAvailable` describes current admission availability; an already admitted queued/running scan remains readable during an outage, while new dispatch still checks availability. Manual scans/fallback cannot be queued, sanitizing, or recognizing, and carry no recognition result. `needs_confirmation` and `confirmed` require a draft. Pending deletion is represented by its receipt/tombstone rather than a readable deleted scan.

Sanitization states are `not_started → pending → running → passed/rejected/failed/cancelled`. Only an internal trusted operation sets `passed`, binding image revision, actual bytes/digest and sanitizer version. Transient failure may return to pending within the same retention deadline; malformed/unsupported input is not automatically retried.

An ingredient row has stable ID, user-facing name, nullable normalized name/canonical ID, selected flag, optional decimal quantity/unit, provenance (`manual/detection/corrected`), and nullable detection reference. Row IDs are unique; list size is at most 50; names are nonempty and at most 120 characters. Array order is display order. Quantities are positive decimal strings, not binary-floating precision promises. No quantity is guessed during manual creation.

Confirmation snapshots include scan ID, confirmed draft revision/time and selected ingredients only. Require at least one selected ingredient. Preserve user text, resolve exact duplicates explicitly, and never auto-merge meaningful variants. No matching, nutrition or allergen-safe claim follows merely from confirmation.

## Recognition port

`tooling/scan-phase-a/recognition-port.ts` specifies a server-only interface without an implementation. Input is a sanitized image reference plus deadline, request/idempotency ID and cancellation signal. The adapter may resolve bytes only after the worker verifies eligibility.

Output discriminates assessed, failed and cancelled. Assessments distinguish food detected, no food, unusable and abstained. Non-food/unusable/abstained results contain no detections. A candidate may include:

- display/normalized name and nullable canonical candidate;
- `likely/uncertain`, typed uncertainty reasons, and at most five alternatives;
- optional normalized box/polygon within the upright sanitized image, limited to 32 points;
- optional estimated quantity.

Scores, calibration metadata, provider/model/adapter/prompt versions, provider request IDs and measured latency stay in a separate private run record. There is no public provider envelope. Numerical scores never become UI probability percentages. Worker retries are bounded to three attempts under the existing runtime proposal, with a total deadline; no hidden adapter retry multiplication.

Validation rejects excessive lists/regions, malformed output and invalid coordinates. A future model's text is untrusted input, not executable instructions or authoritative safety evidence. The Phase A tests contain no implemented/mock AI provider and no seeded detected ingredients. An empty abstention object tests a schema, not a fabricated app response.

## Revisions and idempotency

1. Verify authentication, current owner, and active account on every attempt, including replay.
2. Scope a key by authenticated owner + normalized operation/resource + UUID key.
3. Hash canonical validated request JSON, including expected revisions. Object-key ordering does not alter the digest; ingredient array order does. Never log the body or digest-derived ingredient information.
4. If the same key/body is recorded, reuse the existing operation before rejecting an old expected version. This recovers an acknowledgement lost after a successful commit.
5. The same key with another body returns `IDEMPOTENCY_CONFLICT`.
6. For a new operation, stale `expectedVersion` or draft/image revision returns `VERSION_CONFLICT` without discarding local edits.
7. Reuse does not resurrect a cancelled/deleted/expired resource, restart a job, extend retention, consume quota again, or return an expired capability. Re-read safe current status; fresh authorization requires an eligible new issuance operation.

`version` starts at 1 for an accepted server scan and orders server writes. `imageRevision` changes when a photo is replaced. `draftRevision` changes when ingredients are edited; confirmation names that exact revision. Internal worker lease/fencing generation is server-only. An identity reset increments (never reuses) the client effect generation; new flow instances must also invalidate/unsubscribe all old callbacks. Client effect generation suppresses callbacks from replaced photos, abandoned routes, cancellation, manual fallback, or identity changes. These counters have different meanings and must not be substituted for one another.

Phase B implements database uniqueness, atomic version checks and authorization enforcement; see its report for the database RPC boundary and validation. `idempotency.ts` remains the unchanged pure Phase A ordering specification.

## Typed failures and recovery

Failures expose code, stage, request ID, retryability, bounded retry-after and quota disposition. User copy comes from reviewed code mappings, not provider exception strings. Field issues, if later added, use allowlisted field names/codes without echoing submitted values.

| Category | Examples | Recovery |
| --- | --- | --- |
| Identity/ownership | `AUTH_REQUIRED`, `ACCOUNT_NOT_ACTIVE`, `NOT_FOUND` | Restore/re-authenticate or leave the scan; do not retry under another identity automatically. |
| Conflict | `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT` | Reconcile current status; preserve edits; fix key/body mismatch. |
| Admission | `CONSENT_REQUIRED`, `RATE_LIMITED`, `QUOTA_EXCEEDED` | Explain the specific action/wait; no retry storm. |
| Upload | `UPLOAD_EXPIRED`, `UPLOAD_INCOMPLETE` | Reconcile existence before new authorization; never overwrite a consumed target. |
| Image | `IMAGE_INVALID`, `IMAGE_UNSUPPORTED`, `IMAGE_LIMIT_EXCEEDED` | Choose another photo or enter ingredients manually. |
| Sanitization | `SANITIZER_UNAVAILABLE`, `SANITIZER_TIMEOUT` | Bounded infrastructure retry while media remains eligible; otherwise manual recovery. |
| Recognition | `RECOGNITION_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_INVALID_OUTPUT` | Manual fallback or eligible bounded retry. Unconfigured recognition is not auto-retryable. |
| Lifecycle | `SCAN_EXPIRED`, `CANCELLED` | Start a new attempt; never reopen a terminal job. |
| Internal | `INTERNAL` | Safe retry only where the operation is idempotent; use correlation ID for support. |

Zero detections and explicit abstention are valid assessed outcomes, not infrastructure failures. Whether a future recognition assessment counts as usable for quota finalization remains part of the unresolved quota policy; do not charge unavailable/failed recognition or manual entry.

## State-machine specification

The transition graph and guards in `state-machine.ts` are executable research artifacts. Invalid transitions throw; stale effect generations/image revisions and old server versions are ignored. `offline` is a view over a network-dependent state, not a durable server transition.

| Stage | Allowed destination/action |
| --- | --- |
| idle | Permission, ready camera, selected photo, manual, cancel |
| permission-required | Granted camera, selected gallery photo, manual, failure, cancel; denial stays here |
| camera | Revoked permission, selected/captured photo, manual, failure, cancel |
| captured | Retake, preparing, replacement photo revision, manual, failure, cancel |
| preparing | Authorized uploading, manual, failure, cancel |
| uploading | Server-verified sanitizing, manual, failure, cancel |
| sanitizing | Approved/provider-available queue, manual, failure, cancel |
| queued | Leased recognizing, manual, failure, cancel |
| recognizing | Valid assessed confirmation draft, eligible retry queue, manual, failure, cancel |
| needs-confirmation | Edit/self, acknowledged confirmation, cancel |
| confirmed | Begin a new draft revision; deletion uses its own lifecycle |
| failed | Stage-specific authorized recovery, new photo, manual, cancel |
| cancelled | Terminal; a new flow gets a new identity/state |

Additional guards and effects:

- Capturing/selecting increments image revision and effect generation. Generic progress events cannot synthesize a captured photo.
- Camera requires permission, hardware readiness and foreground focus. Backgrounding releases camera resources in future UI code; resume rechecks them.
- Upload requires a prepared artifact, no known-offline signal, valid capability and available processing. Unknown connectivity is not proof of offline; actual request failures remain authoritative. No unavailable-provider household uploads.
- Sanitization requires server upload acknowledgement. Queuing/recognition requires passed sanitization and provider availability; manual mode cannot dispatch recognition.
- Retry requires a retryable failure, current artifact, attempts remaining and server permission. No retry extends image expiry.
- Confirmation requires explicit action, a nonempty selection, positive current draft revision and successful acknowledgement carrying a newer server version. A received acknowledgement remains authoritative even if connectivity changes during the request. Editing offline remains possible without claiming confirmed persistence.
- Cancellation immediately fences local effects. A local-only attempt cancels immediately; an accepted server scan stays cancellation-pending until acknowledgement. Offline cancellation is visibly pending, not a false guarantee that remote work stopped.
- Manual fallback fences late recognition locally immediately and transactionally on the future server before its save acknowledgement. It preserves edits rather than replacing them with an empty provider result.
- Polling after resume may skip visual stages: validate an authoritative snapshot through `scanStatus`, match account/image identity, ignore older versions, and preserve dirty drafts. The step transition function does not manufacture all missed events. Native restoration/persistence remains deferred implementation.
- Late results cannot overwrite a confirmed draft, manual fallback, cancellation, deletion, expired scan or superseded image. Client suppression supplements, and never replaces, server fencing.

## Privacy lifecycle invariants

Raw/transient server images, including sanitizer outputs awaiting processing, expire absolutely within 24 hours of first upload, with earlier deletion after sanitization/completion/rejection/cancellation. Retries and merges do not reset the deadline. Client cache cleanup is best effort on discard/completion and next activation, not a timer guarantee on a powered-off phone. Never delete the user's gallery original.

Account deletion must prevent new work and fence jobs before cleanup, and must handle already-issued capabilities and late writes. The local spike proves current bearer capabilities survive Auth deletion. Persistent tombstones/cleanup inventories and operational retries are required future work, not something this phase installed.

Retained photos remain explicit opt-in, separately sanitized derivatives. History defaults to ingredient/results data. Future providers receive verified sanitized images only. No image data, paths, GPS/EXIF values or ingredient text enters telemetry.


## Durable transition and recovery obligations

| Current server state | Authorized next states | Required condition |
| --- | --- | --- |
| awaiting_upload | sanitizing, needs_confirmation, cancelled, expired, failed | Verified completion, manual switch, cancellation, deadline or safe failure |
| sanitizing | queued, needs_confirmation, cancelled, expired, failed | Sanitizer approval bound to immutable digest/revision before queue admission |
| queued | recognizing, needs_confirmation, cancelled, expired, failed | Active fenced lease; manual/cancel/delete/expiry wins before dispatch |
| recognizing | needs_confirmation, queued, cancelled, expired, failed | Valid assessment and new draft revision; retry only within attempt/retention bounds |
| needs_confirmation | needs_confirmation, confirmed, cancelled, expired | Versioned draft edit or explicit confirmation of selected rows |
| confirmed | needs_confirmation | Explicit edit invalidates snapshot; recipe work is outside scope |
| failed | awaiting_upload, sanitizing, queued, needs_confirmation, cancelled, expired | Typed stage-specific recovery; valid artifact, active owner and remaining deadline |
| cancelled / expired | none | A new scan is a new resource |

Deletion is available for every owned state and immediately replaces ordinary access with a minimized receipt/tombstone. Its `mediaDeleteBy` is at most the original image deadline (and never more than 24 hours after acceptance); the executable receipt validates the latter bound, while the server must enforce the earlier existing deadline. Retained opt-in derivatives have their own disclosed retention policy and are deleted on explicit scan/account deletion.

The local reducer is the step/effect contract, not a durable job implementation. Terminal expiry is shown through a typed `SCAN_EXPIRED` failure with no retry authorization; deletion dismisses the flow and invalidates its generation. Resume must fetch/validate a complete authoritative status rather than replaying intermediate visual stages. Native process restoration, transactional fences, capability consumption, duplicate ingredient resolution and polling/retry scheduling are still implementation work. Nothing in this specification proves those deployed behaviors exist.
