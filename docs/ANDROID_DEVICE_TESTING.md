# Android physical-device development testing

Prepared from Phase F checkpoint `2afabad84da6d8c56de6bdf3f124a9e8f8753c54` for a Xiaomi Mi 9 (`arm64-v8a`). This is a custom Expo SDK 57 development client. Expo Go cannot include the app-local `KitchenCamImage` module. The development application ID is `com.kitchencam.app.development`; this does not select a production application ID.

## Local toolchain and build

The local setup uses the installed Java 17 JDK and project-ignored caches for Android SDK and Gradle. Android Studio and an emulator are not required for a command-line APK build. Run commands from the repository root:

```sh
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME="$PWD/.cache/android-sdk"
export GRADLE_USER_HOME="$PWD/.cache/gradle"
export EXPO_PUBLIC_APP_ENV=development

cd android
fnm exec --using 24.19.0 ./gradlew :app:assembleDebug \
  -PreactNativeArchitectures=arm64-v8a \
  -Pkotlin.compiler.execution.strategy=in-process \
  --max-workers=2 --no-parallel --no-daemon
```

The existing generated `android/` project is reused and ignored by Git; do not rerun prebuild just to repeat this build. The Gradle output is `android/app/build/outputs/apk/debug/app-debug.apk`. This development APK needs Metro to load the JavaScript application; it is not a standalone release APK.

The local toolchain uses Java 17, Node 24.19.0, Gradle 9.3.1, Android platform 36, Build Tools 36.0.0 (plus 35.0.0 requested by a dependency), NDK 27.1.12297006, and CMake 3.22.1. The ignored `android/gradle.properties` retains a 2 GiB heap and uses 768 MiB metaspace after the first build reported the generated 512 MiB limit was insufficient.

The first native build exposed an incompatible auto-installed Reanimated 4.7.0 with the existing Worklets 0.10.1 pin. `pnpm-workspace.yaml` now pins Reanimated 4.5.1, matching the installed Expo SDK 57 native dependency catalog; the lockfile records that resolution.

ESLint and Prettier exclude the ignored `.cache/` toolchain and generated `android/` output. App source and the app-local native module remain separate from these generated directories.

## Verified local APK (2026-09-29)

The latest local build completed successfully in 12m 55s after the launcher repair and SDK 57 patch alignment, with 496 actionable tasks (471 executed, 25 up-to-date). Android was regenerated and the launcher output cleaned. The build ran offline against the existing SDK/NDK/Gradle caches. No EAS cloud build was used. See [the launcher investigation](ANDROID_LAUNCHER_CRASH.md) for the root cause and persistent patch.

- Repository-relative path: `android/app/build/outputs/apk/debug/app-debug.apk`
- Size: 99,328,818 bytes (94.73 MiB)
- SHA-256: `2d4bb0e3c52cc9786dc259e9e0a25f128a4a908788abd7edb6f1d3cf3e29d342`
- Application ID: `com.kitchencam.app.development`
- Native ABI: `arm64-v8a` only
- Minimum SDK: 24 (Android 7.0), compatible with Android 10
- `expo.modules.kitchencamimage.KitchenCamImageModule` is present as a class definition and registered in the APK's Expo module list; both were verified from packaged DEX code.
- The APK's `DevLauncherController.createAppIntent()` calls `Intent.addCategory()` and contains no `addAll()` call.
- ZIP integrity, APK v2 signature, and 16 KiB ZIP alignment checks passed.
- TypeScript, ESLint, Prettier, all 21 Jest suites (261 tests), all 8 boundary checks, Expo dependency compatibility, and all 21 Expo Doctor checks passed after the repair.

Both the final merged manifest and packaged APK contain these permissions:

```text
android.permission.ACCESS_NETWORK_STATE
android.permission.ACCESS_WIFI_STATE
android.permission.CAMERA
android.permission.CHANGE_WIFI_MULTICAST_STATE
android.permission.INTERNET
android.permission.SYSTEM_ALERT_WINDOW
android.permission.USE_BIOMETRIC
android.permission.USE_FINGERPRINT
android.permission.VIBRATE
com.kitchencam.app.development.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
```

Neither contains `RECORD_AUDIO`, any `READ_MEDIA_*`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, or location permissions.

## Install with USB and adb

After a successful build, connect the phone with a data-capable USB cable. Enable Developer options and USB debugging, unlock the phone, and accept this computer's debugging authorization. If MIUI blocks installation, check its Developer options for Install via USB.

From the repository root:

```sh
./.cache/android-sdk/platform-tools/adb devices
./.cache/android-sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
./.cache/android-sdk/platform-tools/adb reverse tcp:8081 tcp:8081
EXPO_PUBLIC_APP_ENV=development fnm exec --using 24.19.0 node --dns-result-order=ipv4first node_modules/expo/bin/cli start --dev-client --localhost --port 8081
```

Open KitchenCam (development) and connect to `http://127.0.0.1:8081` from its development launcher. Reapply `adb reverse` after reconnecting/rebooting when needed. USB debugging is required for adb installation and port forwarding.

The Node DNS flag makes localhost bind to IPv4 on this machine, matching `127.0.0.1`; without it Metro binds only to `::1`. The launcher category crash and persistent SDK 57 dependency patch are documented in [Android launcher crash](ANDROID_LAUNCHER_CRASH.md), including a categorized deep-link regression command.

## Manual installation and Wi-Fi

1. Copy the completed APK to the phone's Downloads folder using USB file transfer or another trusted local transfer method.
2. Open the APK in the phone's file manager. Allow that app to install unknown apps when prompted, install KitchenCam (development), then turn that permission off again if desired.
3. Connect the phone and laptop to the same trusted Wi-Fi network. Avoid guest/client-isolated networks.
4. Start Metro from the repository root:

   ```sh
   EXPO_PUBLIC_APP_ENV=development fnm exec --using 24.19.0 node node_modules/expo/bin/cli start --dev-client --lan --port 8081
   ```

5. Open KitchenCam (development), then select the development server or enter the laptop's Metro URL (`http://<laptop-LAN-IP>:8081`).

Manual installation plus Wi-Fi does not require USB debugging. The laptop firewall must allow TCP 8081 from the phone/trusted LAN. UFW is active on this machine; its rules could not be inspected without a sudo password. No firewall rule was changed. USB forwarding avoids opening Metro to the LAN.

## Physical-device result (2026-09-30)

Validated on a Xiaomi Mi 9 running Android 10 / MIUI 12.0.4 with the custom arm64 development APK and Metro. The app launches correctly, and the camera works from a cold start without opening Xiaomi Camera first. Live preview, capture, Preview, Retake, and camera re-entry were confirmed on the device. Camera size selection remains within the existing 12 MP policy. The device validation also confirmed stable camera reacquisition across Retake/re-entry. No Phase G work was started.

## Scope of phone validation

The validated device flow covers app launch, cold camera preview, capture, Preview, Retake, and camera re-entry. Android's photo picker, Use Photo, rotation/mirroring, transparency, permission denial, and background/resume still need separate device coverage. The APK includes `expo.modules.kitchencamimage.KitchenCamImageModule`. Camera permission is intended; microphone and broad media/storage permissions are blocked in Expo configuration.

No backend public configuration is supplied by this build preparation. Camera/gallery/preparation can be tested locally. Saving ingredient lists and account flows require a reachable Supabase instance and the paired public URL/publishable key configured separately. Server/service credentials must never be placed in public environment variables. Recognition and production upload ingress remain unimplemented, and processing remains disabled.

The generated project's current minimum is Android 7.0 (API 24). The Mi 9 validation used Android 10. Successful compilation alone does not validate device rendering, real-camera metadata removal, memory behavior or native lifecycle handling.
