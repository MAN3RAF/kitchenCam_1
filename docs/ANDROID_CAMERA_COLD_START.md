# Mi 9 camera cold-start investigation

Investigation dates: 2026-09-29–30. Device reported by the user: Xiaomi Mi 9, Android 10, MIUI 12.0.4, Snapdragon 855, arm64-v8a. Scope: camera acquisition only. No Phase G, commits, pushes, native changes, or APK rebuild.

## Evidence and limits

The user reports a black/unavailable KitchenCam preview when Xiaomi Camera has not been opened first, and a working preview plus valid capture after opening Xiaomi Camera. Retake/re-entry sometimes fails too. This supports investigating native initialization/reacquisition, rather than treating granted permission as sufficient.

The Mi 9 was initially absent from adb, then connected and confirmed as Android 10 / MIUI V12. The user rebooted/unlocked it and left Xiaomi Camera and KitchenCam unopened. The original camera path was temporarily restored with startup-only diagnostics (no behavioral changes) for comparison. The user confirmed **black preview/unavailable** on the cold run.

The cold native log shows CameraService opening camera 0 for KitchenCam, then the size-triggered teardown/replacement: old surfaces close at `23:18:03.806`, replacement surfaces are created at `.846–.867`, and those replacement surfaces close at `.885–.887`. At `23:18:04.397`, Camera3 reports `Error queueing buffer to native window: No such device (-19)`. At `23:18:04.943`, CameraService disconnects KitchenCam's camera client. No later reconnect occurs in this captured interval.

Camera-only Metro events prove the first callback fired, selection returned `4000x3000`, the second callback fired, and JS set `ready: true`. The query itself succeeded. This reproduced failure is therefore **after native OPEN/readiness, during remount/rebinding**, not permission denial or a missing first ready callback. Host Metro timestamps and device logcat timestamps have different clock offsets; compare ordering within each stream rather than equating their wall-clock timestamps.

Installed Expo teardown calls `unbindAll()` on the shared provider. Destruction of the old view after replacement setup can therefore unbind the replacement. The observed replacement-surface closures and disconnect support this teardown/rebinding race as the best cause; the allowlisted logs do not contain a direct call stack proving which `unbindAll()` invocation ran. Vendor CamX error-level messages alone are not enough to diagnose a Xiaomi HAL defect.

Local evidence is kept in ignored `.cache/camera-cold-start/original-cold-native.log` and `original-cold-metro.jsonl`. No photos or unrelated app logs were collected. A later original-code warm recording also exists as `original-warm-native.log` and `original-warm-metro.jsonl`; it was recovered during the September 30 continuation. The first patched cold run and its capture-admission result are recorded below.

The warm recording includes Xiaomi Camera opening camera 120 at `23:22:42.983`, KitchenCam opening camera 0 at `23:23:15.955`, and additional app switches/reacquisitions. KitchenCam replacement surfaces again close at `23:23:16.211–.213`. The same `No such device (-19)` buffer error appears during stock Camera teardown and multiple KitchenCam transitions. It is therefore not a unique signature of cold failure. The final KitchenCam acquisition creates replacement surfaces at `23:23:29.489–.494` that remain in use through the end of the recording at `23:23:57.949`; the Metro trace also records repeated ready callbacks. This supports timing-dependent teardown/rebinding, but does not prove visible preview or successful capture for any particular warm attempt. Multiple app switches mean this recording is not a controlled single-attempt comparison.

## Audited startup sequence

Before this change:

1. Focus/AppState update increments the mount epoch, resets readiness/size, and checks permission. Even duplicate active notifications restart acquisition.
2. Permission granted mounts the back camera with no selected picture size.
3. The first `onCameraReady` calls `getAvailablePictureSizesAsync()`.
4. The app selects the largest enumerated JPEG size at most 12 MP and changes both `pictureSize` and the React key.
5. React destroys that ready instance and mounts another. Only the second `onCameraReady` enables capture.
6. Empty/unsupported enumeration or a query exception permanently marks access unavailable for that attempt. A single 15-second deadline covers the entire sequence; there is no automatic startup retry.

The picture-size query was **after** the first ready callback, not before native readiness. Its mandatory result and key-changing second acquisition were unnecessary dependencies on the startup path. This is a concrete sequencing problem supported by the captured cold failure, not a proven Xiaomi HAL defect. If the first callback never arrives, that query cannot have caused that particular failure.

`useCameraPermissions` and `Camera.isAvailableAsync` were not used. The app uses `Camera.getCameraPermissionsAsync` / `requestCameraPermissionsAsync` through its permission controller. `nativeCameraAvailable` is only an Android/iOS + `expo-device.isDevice` support check; it is not a native availability probe. The old code did wait for a ready callback before capture, but mixed native startup failures into permission/access state.

The camera ref was shared across the two keyed instances. Existing epoch/size checks attempted to fence callbacks, but readiness and startup orchestration were embedded in the screen. Routes already used `router.replace` for Camera/Preview/Retake rather than stacking camera screens.

## Installed native and upstream review

- Installed `expo-camera`: **57.0.6**. Installed Expo's `bundledNativeModules.json`, the [SDK 57 camera documentation](https://docs.expo.dev/versions/v57.0.0/sdk/camera/), and the npm registry latest endpoint all agree. No dependency changes in this task. Package/lockfile modifications visible in Git predate it.
- The [SDK 57 changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo-camera/CHANGELOG.md) lists iOS fixes in 57.0.6. The Android launch-error handling fix in 57.0.3, [PR 47818](https://github.com/expo/expo/pull/47818), is already installed. No newer supported patch addressing this symptom was identified. Historical Android black-preview reports are not evidence for this device's cause.
- Installed `android/build.gradle` selects CameraX **1.6.0** with Camera2. `ExpoCameraView.configureAndBindCamera()` awaits `ProcessCameraProvider`, builds the preview surface and capture use cases, calls `unbindAll()`, then binds to the activity lifecycle.
- `observeCameraState()` emits `onCameraReady` on CameraX `CameraState.Type.OPEN`. It does **not** wait for `PreviewView` streaming. An OPEN event with a black preview remains a possible native surface/session failure; JS cannot prove visible frames from this callback.
- `getAvailablePictureSizes()` reads Camera2 JPEG output sizes from the bound camera's configuration map, or returns an empty list when camera/info is absent. Setting picture size selects a resolution strategy affecting preview and capture. With no size specified, Expo selects its default highest available strategy.
- `OnViewDestroys` calls `cleanupCamera()`, including `unbindAll()`. Expo has no public JS callback acknowledging hardware release. Android does not implement the iOS `active` prop as a substitute for unmounting.

Source files inspected: `node_modules/expo-camera/android/src/main/java/expo/modules/camera/ExpoCameraView.kt`, `CameraViewModule.kt`, and `node_modules/expo-camera/CHANGELOG.md`. No node_modules patches were made.

## Implemented behavior

`camera-acquisition.ts` owns an explicit state machine, independently of permission:

```text
focus + active AppState + granted permission
  → mounting → initializing
                  → Android: selecting-size → configuring same view → ready
                  → iOS: ready (only current onCameraReady)
                    ↓ timeout / mount error
                 releasing (no CameraView rendered)
                    ↓ after that commit, next JS task
             fresh mounting → initializing → ready
                                    ↓ timeout / mount error
                                  failed (no CameraView)
```

Each attempt has a **10-second startup deadline**, beginning after its mount commit and covering Android size selection/rebinding too. The first failure removes the view before scheduling exactly one retry. The retry receives a fresh generation and its own deadline. The next-task yield is a commit separation, not a camera warm-up sleep or polling loop. It gives native teardown an opportunity to execute but is not a hardware-release acknowledgement. Actual native teardown/reopen ordering must be verified in logcat.

Generation and phase checks reject old ready/error/timeout callbacks, including callbacks after blur, background, or route replacement. The capture handler also checks live controller readiness and permission, rather than relying on an older render's button state. Permission changes synchronously suspend acquisition through the permission subscription. Settings revocation is checked again on foreground/focus; Android may also terminate a process when permission is revoked.

The screen initially mounts a minimal back-facing CameraView. On Android, its first ready callback queries supported still sizes and selects the largest enumerated size within the existing 12 MP source limit. It applies `pictureSize` to **the same CameraView with the same React key/generation**. Capture stays disabled until that configured view reports ready again. Duplicate initial callbacks and late query results cannot enable capture or configure a newer generation. Query failure, no admissible size, or a rebind timeout follows the same bounded retry path. iOS retains its single-ready path because the installed native implementation does not emit another ready event on preset changes. No camera switching, flash/torch configuration, or additional native probes are introduced. Failed attempts show the existing unavailable/retry/library/manual UI. Explicit user Retry or a new foreground/focus acquisition starts a new bounded attempt pair; there is no automatic infinite loop.

Successful capture suspends the camera before replacing the route with Preview. Retake already discards the previous photo and replaces Preview with Camera; the new controller starts unready with a process-unique generation. Blur/background also release the camera and cancel pending capture.

Development builds log only `[KitchenCamCamera]` plus phase, generation, attempt, and a fixed failure category. No native error strings, photo URIs, or account data are logged by this instrumentation.

**Capture-size follow-up:** the initial minimal-path experiment removed native size selection and produced a moving cold preview on the Mi 9, but the resulting capture exceeded the 12 MP admission limit. Android bounded-size selection was therefore restored as a separate same-view configuration step. The old size-dependent React key is not restored. Source-file and pre-decode 12 MP admission limits remain enforced, including if CameraX returns a fallback size larger than requested. The bounded-size configuration has now passed capture-to-preview on a rebooted cold start.

## Validation

Lifecycle unit tests and rendered-screen tests cover cold/delayed readiness, the iOS minimal config, Android bounded size selection without remounting, stale size-query results, committed unmount before retry, both failure types, stale events, second-generation success, bounded failure, route blur/refocus, background/resume, permission revocation, cancellation during the release gap, duplicate active notifications, and Camera → capture → Preview → Retake without stacked CameraViews. Existing permission/capture/file/preparation tests remain in the suite.

`pnpm check` passed: TypeScript, ESLint, Prettier, 23 Jest suites / 285 tests, and 8 Node boundary checks. `git diff --check` passed. The logging boundary checks now allow only the dedicated development diagnostic module; runtime tests verify allowlisted metadata and no production logging. Rebooted cold preview and capture-to-preview are verified below. Ten-cycle Retake and background/re-entry behavior remain recommended follow-up coverage.

### September 30 continuation checkpoint

- Recovered the working tree, saved original/patched files, cold and warm device recordings, and prior validation logs before editing. The current `camera-screen.tsx` and `camera-access.ts` exactly match the saved patched copies. Before the first resumed physical test, no camera behavior was changed; the warm-recording analysis above updated the evidence. The subsequent Android size-selection follow-up is described separately.
- Re-ran `pnpm check`: TypeScript, ESLint, Prettier, all 23 Jest suites / 278 tests, and all 8 Node boundary checks passed. Output: `/tmp/kitchencam-camera-resume-check.log`.
- Existing Metro on `127.0.0.1:8081` returned a successful Android bundle containing the acquisition controller/hook and minimal camera screen, with no baseline diagnostic code or screen-level size query. Saved bundle: `/tmp/kitchencam-camera-resumed-android.bundle`.
- The existing APK still hashes to `2d4bb0e3c52cc9786dc259e9e0a25f128a4a908788abd7edb6f1d3cf3e29d342`, matching the documented launcher-repair build. No native/configuration/dependency changes or rebuild were made in this continuation.
- ADB initially had no device; the owner reconnected the Mi 9, and Android 10 / MIUI V12 were reconfirmed. The owner then confirmed a rebooted/unlocked cold state with both camera apps unopened. USB forwarding was restored and the existing APK launched against Metro without a rebuild.

### First patched cold device run

Evidence: ignored `.cache/camera-cold-start/patched-cold-native.log`, `patched-cold-js.log`, `patched-cold-metro.jsonl`, and `patched-cold-start.json`. The latter records the Metro offset and owner's cold-state confirmation. Native logging used a camera-tag allowlist and a three-minute bound; Metro extraction retained only `[KitchenCamCamera]` events.

Generation 1 reached ready on attempt 1, **785 ms** after initializing (822 ms after mounting). Native camera 0 opened at `13:14:54.552`; its original surfaces stayed bound until `13:15:18.268`, rather than being replaced immediately after readiness. JS subsequently transitioned to idle. Generation 2 also reached ready on attempt 1 in **197 ms** after initializing. Neither acquisition recorded a timeout or mount error. Buffer errors in this run occurred during teardown, again showing that the error alone is not a startup-failure signature.

The owner reported that taking a photo led to **“No photo is available. Retake it or choose another photo.”** on Preview. This is not a completed capture-to-preview success. The owner subsequently confirmed a **live, moving cold preview** and the additional **12-megapixel resolution-limit** error. This identifies source-admission rejection after capture, rather than a lost photo session or a camera-startup failure. It motivates the same-view bounded-size follow-up above. No stock-camera warm-up has been requested for this patched run.

### Same-view bounded-size device run

After the Android size-selection follow-up, TypeScript, ESLint, Prettier, all **23 Jest suites / 285 tests**, and all **8 Node boundary checks** passed (`/tmp/kitchencam-camera-size-check.log`). A final null-ref guard and explicit iOS test platform were followed by another successful TypeScript check, targeted lint/format checks, and both camera suites (37 tests). No native dependency/configuration change or APK rebuild was needed.

The first launch was interrupted by a USB reconnection: ADB's transport changed and its reverse-port list was empty while Metro and the app process remained running. Forwarding was restored and the app reopened. This was not counted as a camera failure. Evidence is saved under `.cache/camera-cold-start/patched-size-*`.

The successful run recorded `mounting → initializing → selecting-size → configuring → ready` on **generation 1, attempt 1**, with 442 ms from initializing to ready. Native replacement surfaces created at `13:25:44.141–.148` remained bound until `13:26:01.143`, when the camera was released after capture. Unlike the original failure, they were not immediately closed by old-view cleanup. The owner confirmed **a live preview and a real captured photo displayed on Preview**, without opening Xiaomi Camera.

### Final rebooted cold run

The owner rebooted and unlocked the Mi 9 again with both camera apps unopened. After restoring `adb reverse tcp:8081 tcp:8081`, the existing development APK launched against Metro. Evidence is saved as `.cache/camera-cold-start/final-cold-native.log` and `final-cold-metro.jsonl`.

The final run recorded `mounting → initializing → selecting-size → configuring → ready` on **generation 1, attempt 1**. JS reached ready at `13:28:40.057`; the configured replacement surfaces remained active until route release at `13:28:41.487`, then CameraX disconnected normally. The owner confirmed **the camera works end to end after reboot**, with live preview and successful capture to Preview. No Xiaomi Camera warm-up was used. This is the physical confirmation that the size fix preserves both cold preview and admissible capture.

## Physical retest: existing APK plus Metro

Use the existing development APK from the launcher repair, which already includes expo-camera 57.0.6. **Do not rebuild for this JS/TS change.** No install is needed if that APK is already on the Mi 9. Keep Xiaomi Camera unopened until Test 5.

From the repository root, start Metro in one terminal:

```sh
EXPO_PUBLIC_APP_ENV=development fnm exec --using 24.19.0 node --dns-result-order=ipv4first node_modules/expo/bin/cli start --dev-client --localhost --port 8081
```

After connecting/unlocking the USB-debugging-authorized phone (and again after reboot):

```sh
./.cache/android-sdk/platform-tools/adb devices -l
./.cache/android-sdk/platform-tools/adb reverse tcp:8081 tcp:8081
```

Open KitchenCam's development launcher and select `http://127.0.0.1:8081`. Reload once to load this code, then perform a true force-stop/reopen for process tests. Fast Refresh alone is not a cold start.

1. **Cold phone:** reboot the phone, unlock it, reapply adb reverse, and **do not open Xiaomi Camera**. Start the focused log capture below before opening KitchenCam Camera. Verify a moving live scene, then a valid real photo. Note whether attempt 1 succeeds or a retry occurs. Allow up to about 20 seconds for the two bounded attempts; record failure if unavailable appears. Capture baseline logs before warming anything if this still fails. Force-stopping KitchenCam alone does not reset the camera service.
2. **Fresh KitchenCam process:** force-close using the command below, reopen KitchenCam through the same development launcher/Metro URL, then open Camera. Verify a moving preview and capture. Do not open stock Camera in between.
3. **Retake ten times:** Camera → wait for live preview and enabled Take Photo → Take Photo → inspect Preview → Retake → wait for the fresh live preview. Repeat **10 times**. Record failures/attempt numbers. Each Retake must start disabled until its new ready event. Verify no stacked Camera routes on Back navigation.
4. **Background/reacquire:** from a ready Camera press Home, return to KitchenCam, and verify a fresh preview. Repeat once while “Opening camera” is displayed to exercise cancellation during initialization.
5. **Warmed comparison:** only now open Xiaomi Camera and confirm its live preview; leave it, force-close/reopen KitchenCam, and open KitchenCam Camera under the same focused log capture. Compare success, time to readiness, retry count, and capture with Test 1. KitchenCam must work without needing this warm-up. For repeated controlled cold/warm comparisons, reboot before each cold run.

```sh
./.cache/android-sdk/platform-tools/adb shell am force-stop com.kitchencam.app.development
```

The minimal-path experiment passed one owner-confirmed cold live-preview test but failed capture admission because the default still exceeded 12 MP. The Android same-view size configuration then passed both a non-rebooted and a rebooted cold preview/capture test. The user subsequently confirmed Retake and camera re-entry stability on the physical device. Permission denial, photo picker, rotation/mirroring, transparency, and background/resume remain separate device checks; no native patch is indicated by the successful cold runs.

## Focused logcat capture and comparison

Start each capture before entering KitchenCam Camera. Use `cold` for Test 1 and `warm` for Test 5. Stop with Ctrl-C immediately after the startup/capture result (roughly 30 seconds). These commands use tag allowlists and only new log entries; do not collect a bugreport, full logcat dump, screenshots, or other apps' data. Do not clear the device's logs.

Terminal 2, native camera/session events:

```sh
./.cache/android-sdk/platform-tools/adb logcat -T 1 -v threadtime \
  Camera:V Camera2:V CameraManager:V CameraManagerGlobal:V CameraService:V \
  CameraProviderManager:V CameraDeviceClient:V Camera3-Device:V \
  Camera3-Stream:V Camera3-OutputStream:V CameraDevice-JV-0:V \
  CameraCaptureSession:V CameraCaptureSessionImpl:V \
  CameraX:V Camera2CameraImpl:V CameraStateRegistry:V CameraRepository:V \
  CameraValidator:V Camera2CameraControlImp:V CaptureSession:V \
  UseCaseAttachState:V DeferrableSurface:V SurfaceRequest:V \
  PreviewView:V SurfaceViewImpl:V TextureViewImpl:V CameraViewModule:V \
  '*:S' > /tmp/kitchencam-camera-cold-native.log
```

Terminal 3, only KitchenCam's camera lifecycle events from React Native:

```sh
./.cache/android-sdk/platform-tools/adb logcat -T 1 -v threadtime \
  -e '\[KitchenCamCamera\]' ReactNativeJS:I '*:S' \
  > /tmp/kitchencam-camera-cold-js.log
```

Repeat both commands with `warm` in the output filenames for Test 5. Also preserve the matching Metro `[KitchenCamCamera]` lines if this development runtime routes JS logs only to Metro. Do not export unrelated Metro messages. OEM camera tags vary; an empty native capture is not evidence of no native error. If needed, identify the device's camera-specific tags before expanding the allowlist.

Compare matching timestamps and camera IDs for: provider initialization, open requests, OPEN/CLOSED transitions, busy/in-use/disconnected errors, device-open timeouts, use-case/session binding, output/surface negotiation, preview streaming, and whether old cleanup happens after a new bind. Correlate those with JS generations, timeout/mount-error failures, and the successful attempt. See the evidence section for captured runs and their limits. A `ready` event with a visibly black scene should be reported explicitly; the current timeout covers missing readiness, not native frame delivery after OPEN.
