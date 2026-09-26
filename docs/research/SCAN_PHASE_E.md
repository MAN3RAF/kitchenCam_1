# Phase E — Local client image preparation

> **Final validation retry, 2026-09-26: PHASE E READY FOR CHECKPOINT.** The independently reviewed implementation is unchanged. The remaining Expo Doctor gate now passes all 21 checks with no issues. Earlier external-service failures are preserved in the review history below. Native compilation and physical pixel/device validation remain open; checkpoint readiness does not close those gates.

Date: 2026-09-26. Scope: client image preparation only. Starting and final checkpoint: `6e6ad8630702ee5478fab62c562a30d0571f0995` (`feat: implement camera and gallery capture`), branch `main`.

The owner requested review and continuation of another session's unfinished Phase E work. On resumption there were seven modified tracked files and nineteen untracked files, including native renderers, TypeScript preparation modules, and tests. The tree was therefore not clean on resumption; the earlier session's clean-start claim cannot be established. Existing work was preserved and reviewed against Phase A–D, the approved contracts, security/architecture/foundation documents, installed SDK source, and Phase D tests. No commit, push, staging, backend change, or Phase F work was performed.

## IMPLEMENTED + TESTED

### Architecture and preparation contract

The existing capture feature owns the entire local pipeline. UI calls `PhotoSession.preparePhoto()`; policy and orchestration stay outside React. Modules have explicit interfaces:

| File | Responsibility |
| --- | --- |
| `preparation-policy.ts` | Limits, safe errors, dimensions, orientation matrices, `PreparedPhoto` and preparation port |
| `image-reader.ts`, `image-inspection.ts` | Bounded random-access container inspection and orientation parsing |
| `photo-preparation.ts` | Admission, serialization, bounded retries, verification, cancellation and intermediate cleanup |
| `preparation-files.ts` | Expo FileSystem adapter, owned cache paths, metadata segment removal and deletion retries |
| `preparation-native-module.ts` | Minimal native render/verify bridge; safe unavailable-build error |
| `modules/kitchencam-image/` | Local Expo module: Android BitmapFactory/Canvas and iOS ImageIO/CoreGraphics/WebP rendering |
| `photo-session.ts`, `photo-provider.tsx`, `preview-screen.tsx` | Revision/session lifetime, preview admission, honest preparation UI |

Input is the reviewed Phase D `LocalPhoto`. Output contains only `uri`, `width`, `height`, literal `mimeType: 'image/jpeg'`, measured `size`, unique preparation `revision`, matching `sourceRevision`, and literal `appOwned: true`. The revision is a per-attempt UUID, not a claim of server sanitization. No timestamp is needed. No bytes, base64, EXIF, original filename, upload authorization, storage path, credential, or provider metadata enters this descriptor or React state.

Pipeline:

1. Check source ownership/readability and actual file size.
2. Parse the encoded signature, dimensions, structure, and limited orientation metadata using small file reads. Admission also gates mounting the native preview image.
3. Reject source policy violations before the Phase E full pixel decode. Repeat inspection when Use Photo is pressed; descriptor dimensions/size are hints only.
4. Compute canonical dimensions and an orientation matrix, then allocate unique intermediate/final paths.
5. Native code checks its file boundary and dimensions, decodes pixels, transforms once, resizes, composites on white, and encodes fresh JPEG pixels.
6. Inspect the encoded intermediate, remove all JPEG APP/COM segments into the final file, and delete the intermediate.
7. Check the final byte cap; retry deterministically only for an oversized encoding.
8. Inspect the actual final file and invoke a separate native pixel decode/verification before returning the descriptor.
9. Recheck the active generation/source/preparation relationship. Late results are removed instead of becoming current.

### Accepted formats and source limits

- JPEG: supported 8-bit baseline, extended sequential, and progressive frames with one or three components. Unsupported precision, CMYK/four-component, and other frame types fail safely.
- PNG: static supported PNG containers; CRCs checked. Known critical/color/alpha chunks are allowed. Animation, unknown chunks, and compressed metadata such as `iCCP`, `zTXt`, and `iTXt` are conservatively rejected before native decode. This intentionally does not claim support for every valid PNG variant.
- WebP: static lossy VP8 and lossless VP8L, including VP8X containers; reject animation and inconsistent canvas/bitstream dimensions. Native iOS decoding uses the existing SDK-compatible WebP coder.
- HEIC/HEIF, AVIF, GIF, SVG, TIFF, RAW, arbitrary files, appended payloads, and unsupported/malformed containers do not enter preparation. MIME hints must agree with the actual signature; hints alone cannot admit a file. The Phase D JPEG/PNG/WebP signature checks and awaited asynchronous copy are unchanged.

The actual source ceiling is **25 MiB inclusive**, checked before inspection reads. Positive encoded dimensions must fit **12,000,000 pixels inclusive**. JPEG/PNG dimensions are additionally compared against native header properties before full decode; Android does this for WebP too. iOS WebP relies on the bounded container parse before its native decode, then checks decoded dimensions. Dimension headers are admission evidence, not proof that compressed pixels are valid; native decoding remains required.

The **12 MP ceiling is provisional engineering policy**, not a permanent product requirement or a proven mobile memory guarantee. A 4032×3024 photo exceeds it. Larger-image subsampling/conversion is not implemented. Phase D's ownership copy and any OS camera/picker processing precede Phase E and cannot be retrospectively bounded by this check. No upload occurs; the existing Storage bucket ceiling stays 10 MiB.

The Phase A metadata budget of 64 KiB is preserved, along with bounded segment/chunk counts and individual reads no larger than 64 KiB (ordinary scan/copy blocks are 16 KiB). The parser does not expand compressed metadata or traverse GPS/thumbnail/nested EXIF data. It is a conservative local parser, not a hostile-image security certification.

### Orientation, resizing, alpha and color

EXIF IFD0 orientation 1–8 is parsed for JPEG, PNG eXIf, and WebP EXIF. Both endian forms are supported; invalid/duplicate orientation fields or EXIF segments fail closed. A shared matrix includes rotations and mirrors. Orientations 5–8 swap canonical width/height. Android BitmapFactory and iOS raw CGImage paths provide raw pixels; the explicit matrix is applied once. Native renderers do not request an additional automatic EXIF transform, and the output cannot retain orientation metadata. Shared corner-mapping and dimension tests cover all eight orientations; physical native corner-pixel validation remains open.

Resize uses `scale = min(1, 2048 / max(orientedWidth, orientedHeight))` and rounds each scaled dimension deterministically. No stretch, crop, or upscale. Examples: 4000×3000 → 2048×1536; 3000×4000 → 1536×2048; 1200×800 stays 1200×800. The approved Phase A **256 px minimum on each prepared dimension** also remains in force: tiny or excessively narrow images are rejected, never upscaled or cropped to force admission.

Alpha is composited onto opaque **white** before JPEG encoding. Android requests sRGB on API 26+ and draws into an ARGB8888 output canvas; older Android relies on platform defaults. iOS draws into an explicit 8-bit sRGB RGB context. Source color profiles are not copied into the final file. Native decoder/color conversion precision, wide-gamut/HDR behavior, WebP profile handling, and white compositing at transparent edges require device fixtures. No sophisticated color-management system is introduced.

### JPEG strategy, metadata and output verification

Encode at quality **0.8**, then **0.7**, then **0.6** only if the stripped output still exceeds **4 MiB**. Dimensions remain unchanged between attempts. There are at most three encodes; no lower-quality degradation or unbounded loop. If all attempts exceed the cap, return the safe output-too-large error and remove created files. Each retry decodes the same owned source afresh, releasing native buffers between calls.

Fresh pixel decode/re-encode is the primary metadata boundary. Source EXIF/GPS, timestamps, make/model, thumbnails, XMP, IPTC, comments, and profiles are never passed to the encoder. The filesystem adapter additionally removes **every APP0–APP15 and COM segment**, including metadata generated by the platform encoder, while copying pixel-stream data in bounded chunks. Tests exercise the actual stripping adapter with synthetic APP/COM segments and verify byte preservation outside those segments. These structural fixtures do not demonstrate native pixel fidelity or real camera GPS removal; that device gate remains open.

Success requires an existing/readable actual file, positive measured size ≤4 MiB, JPEG structure/signature, expected positive canonical dimensions in 256–2048, no APP/COM metadata, orientation 1, and successful separate native decoding with matching dimensions. Android decodes the final bitmap; iOS forces a draw into a fresh context. The controller also rejects mismatched source/preparation revisions or a non-owned result. An encoder's return object alone never establishes success. Future consumers must revalidate if the OS evicts the cache after success.

This is **client-side defense in depth**. It does not make an image trusted or remove sensitive visible pixels. **Phase F must independently re-encode and verify on the server**, under its own enforceable resource boundary.

### Concurrency and file lifetime

`PhotoSession` combines a monotonic generation with object/revision checks. Repeated Use Photo taps cannot start another job; a prepared current source is reused. The app-wide preparation service serializes native work across account scopes; native implementations also serialize rendering/verification. Cancellation suppresses results but cannot forcibly terminate an OS decoder. A new preparation while an old cancelled native call is settling returns a safe busy message and allows retry/manual recovery.

Replacement, Retake, manual fallback, route exit, account identity change, provider unmount, preview blur, and backgrounding fence late preparation. Same-account refresh and Strict Mode effect reconnects preserve the live scope. Preview admission observes both focus and session changes, including acquisition that completes after focus. No obsolete result can revive the old UI or replace the newer descriptor.

| File class | Lifetime |
| --- | --- |
| User gallery original | Never edited or deleted |
| Phase D working source (`kitchencam-photos`) | Retained for current preview/retry and picker-cancel recovery; removed on replacement/abandonment. If a native job still reads it, deletion waits for completion. |
| Phase E intermediate (`kitchencam-prepared`, `-encoded.jpg`) | Removed after stripping, between retries, and on terminal failure/cancellation |
| Phase E final (`kitchencam-prepared`, `.jpg`) | Kept only for the active local journey; removed on replacement/abandonment or stale completion |

Names use unique preparation UUIDs, and existing targets cannot be overwritten. Cleanup is idempotent and best effort. Failed owned-file deletions are retried on activation; the first activation in a new JS process sweeps obsolete owned files. Subsequent activations do not sweep the current output. Process termination/OS eviction can leave files until a later sweep; there is no background deletion guarantee on a powered-off app. Retaining the working source while it powers the preview is intentional. No user asset is admitted into the prepared-cache deletion boundary.

### UI and privacy

Use Photo shows **“Preparing photo…”** with the existing accessible loading state, no fake percentage. Success says the photo is prepared on this device and upload/recognition are unavailable. The prepared descriptor remains in the photo session for a future phase. No Supabase record or processing state is created.

Missing/unreadable source, excessive bytes/pixels, unsupported/malformed input, native/build unavailability, invalid output and terminal oversized output map to safe copy. Retake, Choose Another and Enter Ingredients Manually remain available during preparation. Failed preparation keeps a recoverable source; failed admission removes the unsafe preview. Picker cancellation can return to the previous photo. Controls retain the shared 48 dp targets, scrolling/safe areas, semantic colors, scalable text, and reduced-motion behavior. No new animation was added.

Capture/preparation code has no upload, fetch, Supabase operation, telemetry, or image logging. URIs, filenames, image bytes, metadata values and decoder internals stay out of navigation, analytics and crash metadata. No complete encoded image is converted into a JS string or retained in React state. Bounded typed-array reads are transient. The iOS decoder may memory-map/read up to the admitted 25 MiB natively; full pixel buffers stay native.

### Dependencies and API evidence

No new npm library, SDK major, app configuration, permission, or production upload dependency was introduced. Expo's online compatibility gate required four patch updates, recorded in `package.json` and the lockfile:

| Dependency | Before | After |
| --- | --- | --- |
| Expo | 57.0.24 | 57.0.25 |
| Expo Image Picker | 57.0.19 | 57.0.20 |
| Expo Linking | 57.0.10 | 57.0.11 |
| Expo Router | 57.0.22 | 57.0.23 |

The lockfile also updates seven existing Expo transitive packages by one patch: CLI, router-server, UI, Babel preset, glass-effect, modules-core, and modules-jsi. React Native 0.86.3, React 19.2.3, Node, and pnpm remain unchanged. Installation encountered registry timeouts; retries combined the scoped updates, reused cached metadata, lowered download concurrency, and increased the fetch timeout.

The new native surface is an **app-local Expo module**, discovered by Android and Apple autolinking. It uses ExpoModulesCore 57.0.19. iOS declares `SDWebImageWebPCoder ~> 0.14.6`, the same constraint already required by installed Expo Image 57.0.5; this exposes that existing native dependency directly to the local module. Android uses platform graphics APIs only. Module version is 0.1.0 on both platforms.

The native module is needed for explicit raw-pixel orientation, white alpha flattening, pre-decode native bounds checks, and final decode verification. Expo ImageManipulator's public API does not provide this combined guarantee; its documented extent/background operation is web-only. Sharp/libvips remains solely in the unchanged isolated Phase A research tooling and is not imported into the app or used to implement a server worker here.

Primary references reviewed alongside installed SDK source:

- [Expo local native modules](https://docs.expo.dev/workflow/customizing/), [autolinking](https://docs.expo.dev/modules/autolinking/), and [module API](https://docs.expo.dev/modules/module-api/).
- [Expo ImageManipulator API](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/).
- [Android BitmapFactory.Options](https://developer.android.com/reference/android/graphics/BitmapFactory.Options) for bounds-only decode and preferred color space.
- [SDWebImageWebPCoder 0.14.6 implementation](https://github.com/SDWebImage/SDWebImageWebPCoder/blob/0.14.6/SDWebImageWebPCoder/Classes/SDImageWebPCoder.m): static decoding returns raw pixels with upright UIImage orientation, leaving the explicit source-EXIF matrix to this module.

### Tests and review fixes

Seven Phase E suites cover inspection/policy, preparation orchestration, filesystem behavior, session races, real provider lifecycle wiring, UI, and static native/privacy boundaries. Fixtures are explicitly structural and the native bridge is mocked in Jest; static assertions about native source are not native execution.

Coverage includes missing/unreadable sources, unsupported/mismatched signatures, JPEG/PNG/lossy/lossless WebP admission, >25 MiB and >12 MP rejection, exact 12 MP admission, resize/no upscale/aspect ratio/minimum dimensions, orientations 1–8 and mirrored corner mappings, animation/truncation/CRC/appended payloads, metadata budgets, output signature/dimensions/read/decode verification, metadata stripping, deterministic fallback and terminal failure, duplicate taps, stale completion, source replacement, cancellation during verification, route/account/unmount/background changes, Strict Mode, current-file protection, and gallery-original protection. White flattening and sRGB calls are checked structurally; pixel behavior needs native fixtures.

Review repairs made during resumption:

1. **Preview admission race:** the inherited focus-only validation missed a source acquired after focus or replaced on the same mounted preview. Session subscriptions now admit those revisions; regression tests cover both cases.
2. **Cleanup lock:** an unexpected rejection during final cleanup could skip resetting the preparation lock. Final cleanup now remains best effort while always releasing it; a test verifies the next job succeeds.
3. **iOS ownership comparison:** compare canonical directory paths and explicitly construct a directory URL, avoiding trailing-slash/file-versus-directory URL equality rejecting owned files. This is a code-review repair; iOS execution remains unverified.
4. **Incomplete UI test setup:** all 13 inherited Phase E UI cases initially failed because AppState was not initialized to active. Explicit foreground setup fixes the fixture without removing production lifecycle guards. All 60 Phase D tests passed on the initial run.
5. Added direct filesystem-adapter tests, provider lifecycle integration tests, read-only inspection handles, matching native module versions/license metadata, formatting, and this report. No reviewed Phase D signature/copy protection was weakened.
6. Repaired the four inherited SDK patch mismatches reported by Expo dependency checks/Doctor. The first full check also caught one new test-harness CommonJS import lint warning; it now uses Jest's typed module loader. No check was disabled.

### Validation

Final results below were obtained against the completed SDK patch installation. All package commands use pinned Node 24.19.0 / pnpm 11.19.0. Initial sandbox execution could not open pnpm's package-manager database; approved host execution was used for those checks. `pnpm check` passed before the patch updates; the equivalent complete sequence (typecheck, lint, format check, full Jest, both Node boundary suites) passed again afterward, with Jest JSON used to count each phase precisely.

| Check | Result |
| --- | --- |
| TypeScript / ESLint / Prettier | Passed; lint has zero warnings; repository formatter passed its existing configured scope |
| Full Jest / Phase E | **260/260 tests, 21/21 suites**; Phase E **119/119 in seven suites**; zero skipped/failed tests |
| Phase D regression / Phase C regression | **60/60 in five suites** / **45/45 in two suites** |
| Static security/boundary tests | **8/8 passed**; Phase D/E privacy boundary suites also passed within Jest |
| Expo dependency check / Doctor | Passed; dependencies current and **21/21 Doctor checks** |
| Android / iOS / web exports | All passed again with the final dependencies; Hermes native bundles and web bundle generated |
| Android and Apple module autolinking | Passed; KitchenCamImage discovered on both platforms |
| Phase A recorded evidence assertions | **6/6 passed**; evidence and experiments unchanged |
| Secret/local-path scan / whitespace checks | Passed for all 36 changed files against four actual local secret values, without printing values; tracked, staged and every untracked file passed whitespace checks |
| Database/backend runtime / Deno | Not rerun: no backend/schema/function/server-lockfile changes; CI does not require Deno for this client-only change. Existing static boundary tests passed. |
| Native compilation / native pixel fixture execution | Not run: no Android SDK/build setup or Xcode/iOS toolchain available in this workspace |

The final full Jest run emitted one non-failing React `act(...)` warning from the unchanged Phase C `LoadedScan`/TanStack Query UI suite; its 45 tests still passed. No warning was suppressed or test skipped. Exports also emitted a harmless NO_COLOR/FORCE_COLOR diagnostic. These are not evidence of native execution. The initial Phase E focused run's 13 UI failures and the lint/dependency failures described above were repaired, then the complete final checks passed.

## IMPLEMENTED BUT NOT PHYSICAL-DEVICE VALIDATED

Open gates, with no claim that exports or unit tests close them:

- Rebuilt Android and iOS development clients: native compile/link first, then module discovery and actual render/verify calls. Expo Go and old clients cannot exercise this module.
- Real Android camera JPEGs and gallery JPEG/PNG/static WebP (lossy/lossless, transparent, metadata-bearing, progressive where applicable).
- All eight EXIF orientations, including mirrored cases, checked with visibly labeled corner pixels. Verify canonical width/height, no second rotation, no crop/stretch, and equivalent preview/output display.
- Real EXIF GPS/make/model/date/thumbnail, XMP/IPTC/comments/ICC fixtures: inspect actual native output with an independent metadata tool and decode it independently.
- Transparency: verify white fully transparent areas and blended edges for PNG/WebP. Verify sRGB/default-color behavior, wide gamut and OS differences; unsupported profiles should fail safely.
- Sources near 12 MP and 25 MiB, outputs near 4 MiB, memory pressure, repeated fallback encodes, preparation latency, and low/mid-range Android devices. The synchronous bounded JS parser/stripper still uses the JS thread; near-limit UI latency must be measured.
- iOS behavior, lifecycle interruption during native transforms, background/resume, picker activity recreation, navigation/retake/replacement, account switch, and process termination while files are in flight.
- Small/large phones, landscape, safe areas, largest system text, dark/light appearance, reduced motion, TalkBack/VoiceOver announcements/focus and manual recovery.

Memory is not hard bounded by JS policy. A 12 MP RGBA raster alone is about 46 MiB; preview, source decoder, resize surfaces, verification, compressed data and OS caches can coexist. PNG precision/color conversions can cost more. Native calls have no killable timeout or subprocess isolation; a stalled/crashing decoder cannot be made safe by a JS timer. These limits are honest client constraints, and the independently isolated Phase F sanitizer remains essential. Do not relax the provisional limit without measured evidence and owner review.

## FUTURE PHASE

Phase F trusted sanitizer and all upload/ingress/authorization/Storage integration remain unimplemented. No migration, RLS/storage policy, Edge Function, generated database type, backend RPC, or processing admission flag changed. Recognition, AI providers, detections, recipes, nutrition, subscriptions, ads and community are outside this work. No fake progress or provider data was added.

## UNRESOLVED / OWNER DECISION

No new product/backend decision is needed to review this implementation. Owner review is required before any checkpoint or later phase. Native compilation and the device matrix above remain release gates. The conservative format subset and 256 px minimum follow Phase A; widening formats, raising 12 MP, or adding persistent/offline photo retention needs separately reviewed evidence. Existing hosting/provider/privacy/budget decisions remain open and are not decided here.

## Files, Git status and review disposition

Changed files are enumerated exactly below: **14 modified tracked files and 22 new files**, all unstaged. The new files comprise the Phase E report, seven local-module files, six preparation/inspection TypeScript modules, one structural fixture helper, and seven Phase E test suites. Existing changes integrate provider/session/preview, preserve Phase D regression expectations, allow the local native source directories in Git, update five current documents, and apply the four required SDK patches and lockfile resolutions.

HEAD and local `origin/main` both remain `6e6ad8630702ee5478fab62c562a30d0571f0995`; the branch is `main`. The index is empty. Exact `git status --porcelain=v1 --untracked-files=all`:

```text
 M .gitignore
 M README.md
 M docs/ARCHITECTURE.md
 M docs/ENGINEERING_FOUNDATION.md
 M docs/ROADMAP.md
 M docs/SECURITY.md
 M package.json
 M pnpm-lock.yaml
 M src/features/capture/photo-provider.tsx
 M src/features/capture/photo-session.ts
 M src/features/capture/preview-screen.tsx
 M tests/scan-phase-d-provider.test.tsx
 M tests/scan-phase-d-ui.test.tsx
 M tests/scan-phase-d.test.ts
?? docs/research/SCAN_PHASE_E.md
?? modules/kitchencam-image/LICENSE
?? modules/kitchencam-image/android/build.gradle
?? modules/kitchencam-image/android/src/main/AndroidManifest.xml
?? modules/kitchencam-image/android/src/main/java/expo/modules/kitchencamimage/KitchenCamImageModule.kt
?? modules/kitchencam-image/expo-module.config.json
?? modules/kitchencam-image/ios/KitchenCamImage.podspec
?? modules/kitchencam-image/ios/KitchenCamImageModule.swift
?? src/features/capture/image-inspection.ts
?? src/features/capture/image-reader.ts
?? src/features/capture/photo-preparation.ts
?? src/features/capture/preparation-files.ts
?? src/features/capture/preparation-native-module.ts
?? src/features/capture/preparation-policy.ts
?? tests/fixtures/phase-e-images.ts
?? tests/scan-phase-e-boundary.test.ts
?? tests/scan-phase-e-files.test.ts
?? tests/scan-phase-e-inspection.test.ts
?? tests/scan-phase-e-lifecycle.test.ts
?? tests/scan-phase-e-preparation.test.ts
?? tests/scan-phase-e-provider.test.tsx
?? tests/scan-phase-e-ui.test.tsx
```

**Phase E is READY FOR INDEPENDENT REVIEW of the local implementation**, with native compilation and physical-device validation explicitly open. This is not release approval or proof of native pixel behavior. No owner decision beyond review is needed to keep this scope local. Nothing was committed or pushed. Phase F has not begun. Stop for owner review.

## Independent owner review — 2026-09-26

This review inspected the actual unstaged changes against HEAD, every untracked Phase E artifact, native implementations and registration/build declarations, all seven Phase E suites, relevant Phase D filesystem/session/provider/preview code and regression tests, the manifests/lockfile/configuration, and the required Phase A–E/security/architecture/foundation documents. The preceding report was treated as a claim, not validation evidence. No backend/schema/function change is present, so backend/database and Deno reruns were unnecessary. The committed checkpoint, index, and branch were preserved.

### Defect reproduced and repaired

**Medium — revision generation could permanently lock preparation and reject with an unmapped native exception.** `preparePhoto()` set `busy`, `preparing`, and `preparingSource` before calling Expo Crypto, but called its UUID generator outside `try/finally`. An exception bypassed safe error mapping and lock release. The new lifecycle regression first failed with a rejected promise carrying the synthetic private exception. Moving that single call inside the existing `try` makes failure resolve `false`, preserves the source, reports the safe INVALID message, releases both state flags and the source guard, and permits a successful retry. No native transform starts on this failure.

Only one regression was added: `revision generation failure is safe and releases preparation for retry`. Only `src/features/capture/photo-session.ts`, `tests/scan-phase-e-lifecycle.test.ts`, and this report changed during this independent review. No dependency, native renderer, backend, policy, or upload implementation was added by the review.

### Direct implementation findings

| Area | Independent finding and limit |
| --- | --- |
| Source admission | Missing/unreadable/unsupported/mismatched files fail safely. Actual bytes/signatures/container dimensions are used; descriptor hints cannot authorize a decode. >25 MiB is rejected before inspection reads. Exact-end checks reject appended payloads; CRC, animation, duplicate frame/EXIF and metadata checks provide conservative admission. Native decode is still needed to reject corrupt compressed pixels; this is not exhaustive polyglot detection. |
| 12 MP/resource policy | The encoded pixel ceiling is inclusive and repeated against Android native bounds for all three formats, and ImageIO properties for iOS JPEG/PNG. iOS WebP has JS container admission before full decode and a post-decode comparison, without an independent native pre-decode dimensions check. Parser/decoder disagreements, allocation overhead, preview buffers, OS processing and decoder failures remain native risks. No hard memory/time containment is proved. |
| Orientation | All eight matrices and dimension swaps are consistent on inspection. Android requests raw BitmapFactory pixels; iOS uses raw CGImage and explicit coordinate transforms. The reviewed SDWebPCoder 0.14.6 source constructs upright UIImage wrappers around decoded CGImages. No additional EXIF transform is requested. Native corner-pixel output, especially iOS mirrors/rotations, remains unexecuted. |
| Resize | Independent checks confirmed 4000×3000→2048×1536, portrait equivalent, unchanged 1200×800 and 800×1200, unchanged 2048 square, and 2049×2048→2048×2047. Zero, negative, impossible, over-limit and extreme-aspect inputs fail. The approved 256 px minimum rejects narrow/tiny results rather than making zero dimensions or upscaling. Rounding gives ordinary integer-pixel aspect approximation. |
| Transparency/color | Both native renderers fill opaque white before drawing; iOS explicitly creates an sRGB context and Android requests sRGB where supported. Structural assertions are not white-pixel evidence. PNG/WebP transparent edges, native profile conversion and color fidelity remain device gates. |
| JPEG/fallback | Three bounded qualities, 0.8/0.7/0.6, with fixed dimensions. Actual stripped-file size controls retry and terminal failure. No unbounded degradation or loop was found. Oversize Jest fixtures are synthetic entropy payloads, not real high-entropy native encoder output. |
| Metadata | Fresh native pixel encoding is implemented, followed by removal of all APP/COM segments. The real-file experiment below confirms the production stripping algorithm on decodable JPEGs. Native camera GPS/thumbnail output evidence is still absent. Phase E remains defense in depth; Phase F sanitization is future work. |
| Output verification | Actual file readability/size/structure/metadata/dimensions and separate native decode are required; source/preparation revisions are fenced before success. Targets are generated inside the owned cache and cannot overwrite an existing file. OS cache eviction after verification remains possible, so a future consumer must revalidate; the descriptor is not durable authority. |
| Concurrency | Duplicate taps, replacement, cancellation during verification, late completion, route/account/unmount/background changes and current-output protection pass controller/provider/UI tests. The service lock spans native work and cleanup; the reviewed cleanup regression releases it after failure. Cancellation cannot terminate an OS decoder. |
| File lifecycle | Gallery originals remain outside deletion boundaries. Sources needed by an in-flight native job are retired after it settles; current preview/retry sources remain active. Intermediate/stale outputs are removed; cleanup failures are best effort and retried. Unique preparation names prevent stale cleanup from targeting a newer artifact. |
| Ownership/path comparison | The iOS repair compares resolved parent paths with an explicitly constructed directory URL, addressing URL trailing-slash equality. Actual installed Expo JS path helpers were exercised with ordinary, single-slash, localhost, percent-encoded and dot-normalized file URLs; equivalent parents match. Outside paths and case mismatches fail closed. This does not execute Foundation or establish case-insensitive iOS filesystem behavior. |
| Preview admission race | Temporarily removing the session subscription reproduced both regressions: mounted replacement had only one admission call and acquisition completing after focus never mounted the image. Restoring the implementation passed all 15 UI cases. The temporary mutation was restored byte-for-byte and is not part of the final diff. |
| SDK/native compatibility | Lockfile comparison found exactly four direct and seven existing transitive Expo patch replacements, with no new npm package. The current dependency compatibility check passes. There is no monkey-patching or private Expo API use in the new bridge. Installed ExpoModulesCore queue/config APIs and Expo Image's matching WebP pod/import pattern were inspected. Android/Apple autolinking discovers KitchenCamImage. Export/autolinking do not prove compilation/linking. |
| Privacy/boundary/UI | Capture/preparation has no upload, Supabase Storage/authorization/job call, telemetry or image logging. Fixed routes contain no image parameters. Errors map to safe copy. Preparing/success messages remain local and truthful; manual/retake/another-photo recovery remains available. No F/G/H behavior or backend changes were found. |
| Test quality | The inherited 119 cases are real parameterized assertions, but many use structural nondecodable images, a mocked native bridge, or static source assertions. Controller races use deferred completion; provider tests exercise actual wiring. They cannot establish native alpha/orientation/color/metadata guarantees. The new regression raises Phase E to 120; experiment assertions below are not added to Jest counts. |

### Additional real-file and policy experiments

An isolated temporary Node experiment used the **existing unchanged Phase A Sharp package only as a fixture generator and independent decoder**. It did not import Sharp into the mobile app or implement a server worker. The actual Phase E TypeScript parser admitted 12 decodable files: eight baseline/progressive JPEGs with EXIF orientations 1–8, and opaque/transparent PNG and WebP. A real 4001×3000 JPEG was rejected above 12 MP.

For the eight JPEGs, the production `preparationStorage.stripMetadata` ran through a Node-filesystem adapter with real files/handles. Independent Sharp inspection found no EXIF/XMP/IPTC/ICC/orientation in the stripped outputs, and raw decoded pixels matched the original JPEG pixels exactly. This establishes the stripper's byte preservation and metadata boundary on real JPEGs, **not pixel orientation normalization**: no KitchenCam native renderer was invoked. The first fixture-generation attempt inadvertently wrote orientation 1; explicitly setting generator metadata orientation repaired the experiment before the eight assertions passed. Temporary files were cleaned.

Separate direct checks exercised six requested resize examples, six invalid/extreme dimension cases, and five equivalent path forms using the actual installed Expo path utilities. These checks passed without changing production policy or inflating Jest counts.

### Independently run validation

Package commands selected Node 24.19.0/pnpm 11.19.0. Sandbox child-process/package-manager/telemetry restrictions required host retries for applicable commands. Node's sandbox test runner initially reported only a file-level wrapper for Phase A; that result was not counted as six tests. The host rerun printed and passed all six named assertions.

| Command/check | Independent result |
| --- | --- |
| `pnpm exec jest --runInBand tests/scan-phase-e tests/scan-phase-d --json ...` | 180/180 across 12 suites: E 120, D 60 |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Passed; lint zero warnings, formatter's existing scope unchanged |
| Full `pnpm exec jest --runInBand --json ...` | 261/261, 21 suites; E 120/7, D 60/5, C 45/2; no skipped/failing cases |
| `node --test tests/client-boundary.test.cjs tests/backend-foundation.test.cjs` | 8/8 passed |
| `pnpm deps:check` | Passed, dependencies up to date |
| `pnpm run doctor` | **Not green.** Three independent attempts: directory-service unexpected response; host retry Expo config API connect timeout; final host retry directory-service unexpected response with 20/21 checks passed. Checks were not disabled or bypassed. A successful online rerun remains required. |
| `pnpm export:check` | Android/iOS Hermes and web exports passed |
| Android/Apple `expo-modules-autolinking resolve` | KitchenCamImage discovered on both platforms |
| `node --test tooling/scan-phase-a/evidence.test.cjs` | Host rerun 6/6 passed; original evidence unchanged |
| `node tooling/scan-phase-a/review-scan.cjs` | 36 artifacts checked against four actual local secret values; passed, no values printed |
| Tracked/staged/untracked whitespace | Passed; index empty |
| Native compile/build | **Unavailable.** No Android SDK/sdkmanager/adb/Gradle/Kotlin compiler or Swift/Xcode/CocoaPods toolchain found. Java alone is insufficient. No unsigned APK, simulator binary, native renderer execution or build success is claimed. Autolinking/API inspection is the strongest completed native integration check. |

The unchanged Phase C UI suite still emits a non-failing React act warning. All 45 Phase C tests pass; no warning was suppressed. The two intentionally red preview cases were run with a test-name filter, then the entire restored UI suite passed. The UUID regression was also observed failing before its one-line fix.

### Disposition and remaining gates

**CHANGES REQUESTED: independent required validation is incomplete.** The reproduced code defect is repaired and no further reproducible Phase E code defect was found. Checkpoint recommendation is withheld pending a successful online Expo Doctor rerun; the external service failure is not misreported as a repository defect. Native compile/link and physical-device gates remain open and are not inferred from passing exports or mocks.

The entire earlier device matrix remains required: Android camera and real gallery JPEG/PNG/WebP; all eight rotated/mirrored EXIF fixtures; real metadata-bearing outputs; white transparency/blended edges and color spaces; near-12 MP/25 MiB/4 MiB files; memory pressure, latency and repeated fallback; low/mid-range Android; iOS; and lifecycle interruption during native transforms. No owner decision is required to widen scope: these are evidence gates under the existing policy, not authorization to start Phase F.

Final Git inventory is exactly the 36 paths in the preceding status block (14 modified tracked, 22 untracked), all unstaged, with HEAD/origin/main still `6e6ad8630702ee5478fab62c562a30d0571f0995` on `main`. The review changed only the three files listed above. No commit, push, staging, Phase F work, or backend/database change occurred. Stop for owner review.

## Final Phase E validation retry — 2026-09-26

The initial status, diff stat and whitespace check matched the independently reviewed state: 14 modified tracked files and 22 untracked files, index empty, same committed base. Comparison with the pre-review baseline found only the three recorded owner-review changes; the temporarily altered preview was still restored byte-for-byte. No implementation was changed during this retry.

The normal `fnm exec --using 24.19.0 pnpm run doctor` invocation first encountered a sandbox package-manager database error before Doctor started. The host-access rerun completed successfully: **21/21 checks passed. No issues detected.** No dependency/configuration problem was reported, no check was disabled, and no further service retries were needed. This closes the external validation gate that blocked the preceding review disposition.

Only this report changed. The already-passing independent validation remains applicable: 261 Jest tests (Phase E 120, D 60, C 45), TypeScript, lint, formatter, eight security/boundary tests, dependency compatibility, Android/iOS/web exports, Android/Apple autolinking, six Phase A evidence assertions, and secret/path/whitespace checks. These suites were not unnecessarily repeated against unchanged implementation. The final whitespace check passed.

**PHASE E READY FOR CHECKPOINT.** This supersedes the preceding external-validation blocker; native compile/link and the full physical-device matrix remain open. Git inventory and committed base remain unchanged, all Phase E work is unstaged/uncommitted. Nothing was committed or pushed and Phase F was not begun. Stop for owner review.
