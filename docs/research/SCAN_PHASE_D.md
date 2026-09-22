# Phase D — Camera and Gallery Capture

Date: 2026-09-22. Scope: local still capture, single-image selection, local preview, and temporary-file ownership only. No image preparation, upload, sanitizer, recognition, recipe behavior, or database change is included.

## IMPLEMENTED + TESTED

### Routes and entry

The existing `/scans` entry now offers **Camera**, **Photo Library**, and **Enter Ingredients Manually**. The new routes are `/scans/camera`, `/scans/gallery`, and `/scans/preview`. Navigation uses fixed route names only; image bytes, local URIs, credentials, and metadata never enter route parameters.

The existing manual journey remains the recovery path. Selecting **Use Photo** validates the local file and shows an honest local-only boundary: preparation and recognition are not available yet. No scan record, upload authorization, Supabase request, quota, or recognition state is created.

### Camera

`expo-camera` `~57.0.5` provides `CameraView` still capture. Camera access is checked only after entering the Camera route and the purpose text is shown before the request button. The implementation uses the rear camera, picture mode, flash off, torch disabled, microphone disabled, and barcode scanning disabled. Unsupported optional controls are omitted; there is no fabricated front-camera or torch capability.

The route handles undetermined, requestable denial, permanent denial with Settings, unavailable hardware, and permission revocation after resume. The camera view is mounted only while the route is focused, the app is foregrounded, permission is granted, and a supported native picture size is available. A native size at or below the provisional Phase A 12 MP engineering ceiling is requested; no resize, crop, re-encode, EXIF stripping, or image preparation occurs. `expo-device` prevents the simulator's generated sample image from being presented as a real camera capture.

Capture requests are serialized. Focus/background epochs fence late native callbacks, stale mount callbacks, unmounted screens, and navigation after a replaced request. Camera-owned temporary results are released after an app-owned copy is prepared.

### Gallery and preview

`expo-image-picker` `~57.0.19` launches a single-image, image-only system picker with editing, EXIF, and base64 disabled and maximum quality requested. The original gallery asset is never deleted or edited. Android pending picker results are recovered through `getPendingResultAsync()` after activity recreation without automatically launching another picker. Cancellation, provider errors, inaccessible assets, and unsupported formats map to safe user-facing messages.

`expo-image` `~57.0.5` displays the app-owned file with `contain` and no image cache or transition, preserving portrait and landscape aspect ratios. Preview actions are Retake, Choose Another, Use Photo, and Enter Ingredients Manually. Unreadable files remove the stale preview and offer recovery.

### Local descriptor and file lifecycle

`LocalPhoto` is memory-only and contains a revision, app-owned local URI, source (`camera` or `gallery`), reported dimensions, MIME hint, measured copied-file size, and selection timestamp. It has no image bytes, base64, signed URL, storage path, credential, provider metadata, or telemetry identity. All picker and camera metadata is treated as an untrusted hint.

The session copies the selected file byte-for-byte into a private `kitchencam-photos` cache directory. This is an ownership/lifetime copy only; it is not normalization or sanitization. Replacements, Retake, manual fallback, route abandonment, account changes, and preparation/read failures remove obsolete app-owned files. Cleanup is best effort and retried on the next activation. The original gallery URI is never removed. A live descriptor is not removed until it is replaced or the photo flow is abandoned.

The provider fences account identity changes and leaves the photo session alive across Strict Mode reconnects and transitions among camera/gallery/preview. Leaving the photo routes discards the active descriptor. Unsaved local capture is intentionally session-only and does not survive process death.

### Privacy and accessibility

No photo URI, filename, image metadata, image bytes, or private native error is logged or sent to analytics/crash metadata. No face inspection or privacy-sensitive content removal is claimed. During Phase D no image leaves the device. Native configuration includes only camera permission and explicitly blocks microphone, barcode, and broad photo-library permissions.

The screens reuse existing semantic colors, typography, spacing, safe-area handling, scalable text, reduced-motion navigation, `Screen`, `Button`, `LoadingState`, and `ErrorState`. Camera, picker, capture, Settings, preview, and manual controls have accessible labels and 48 dp targets. Selected source and local-only behavior are communicated as text, not color alone.

### Tests and validation

Focused Phase D coverage is in `tests/scan-phase-d.test.ts`, `tests/scan-phase-d-ui.test.tsx`, `tests/scan-phase-d-native.test.ts`, `tests/scan-phase-d-provider.test.tsx`, and `tests/scan-phase-d-boundary.test.ts` (**60 tests**). The tests cover permission timing and states, simulator/unavailable camera, foreground and focus fencing, duplicate capture, stale callbacks, picker cancellation and Android recovery, aspect-preserving preview, unreadable files, asynchronous working-copy creation, format signatures, replacement/abandon cleanup, original-asset protection, account/path cleanup, fixed-route privacy boundaries, and accessibility labels.

### Independent review fixes

The owner review reproduced two native adapter defects and fixed them with focused regressions:

1. **Unawaited working-copy creation.** Expo SDK 57's `File.copy()` returns a promise. The adapter checked and exposed the destination immediately, so a real asynchronous copy could be reported unreadable or race with cleanup. Preparation now awaits the copy; the native test filesystem deliberately completes copying asynchronously.
2. **MIME-only format admission.** Picker MIME/type fields are untrusted hints. Before the fix, a file declared as JPEG could pass after only a one-byte readability check. The adapter now checks the copied file's JPEG, PNG, or WebP signature before exposing it, and mismatched bytes are rejected without changing the original asset. This is basic local admission only; Phase E remains authoritative for full decoding, limits, normalization, and sanitization.

No upload, backend, database, permission architecture, or Phase E work was added while fixing these findings.

## IMPLEMENTED BUT NOT PHYSICAL-DEVICE VALIDATED

- Android and iOS camera hardware, permission Settings transitions, front/rear availability, flash/torch behavior, camera orientation, and native capture quality.
- iOS and Android picker provider variants, activity destruction/recreation with real assets, inaccessible cloud-only assets, HEIC/HEIF behavior, and large-photo memory pressure.
- Background/resume timing, native route transitions, process termination/relaunch, and SecureStore/session behavior in an installed development build.
- VoiceOver/TalkBack reading order, focus restoration, largest Dynamic Type, safe-area cutouts, landscape layout, and browser visual behavior.
- A rebuilt Expo development client. Exported bundles and Jest tests do not prove native-device behavior.

## FUTURE PHASE

Phase E owns trusted client-side image preparation: bounded source admission, decode limits, orientation correction, metadata removal, color normalization, resizing, re-encoding, and prepared-byte validation. Later phases own upload ingress, authorization, storage, sanitizer execution, AI recognition, confirmation from recognized results, recipes, nutrition, and retention workers.

## UNRESOLVED / OWNER DECISION

No new product or database decision is required for this bounded local flow. Physical-device validation and the Phase E preparation implementation remain gates. Native high-resolution/HEIC support remains intentionally deferred under the approved Phase A contract.

## Files and disposition

New route files: `app/scans/camera.tsx`, `app/scans/gallery.tsx`, and `app/scans/preview.tsx`. New feature files live in `src/features/capture/`. Focused Phase D tests live under `tests/`. Existing scan entry/layout and `app.config.js` were updated. Dependencies added are Expo SDK 57-compatible `expo-camera`, `expo-image-picker`, `expo-file-system`, `expo-image`, and `expo-device`.

No migration, schema, policy, grant, generated database type, backend RPC, or server function was changed.

Phase D remains uncommitted and unpushed and is ready for independent review after the validation gates below complete.
