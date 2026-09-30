# Android development launcher crash

Investigation date: 2026-09-29. Scope: repair the development launcher and rebuild the arm64 APK. No Phase G or product features.

## Root cause

The installed `expo-dev-launcher` 57.0.20 source matches the reported stack trace at `android/src/debug/java/expo/modules/devlauncher/DevLauncherController.kt:448`:

```kotlin
intent.categories?.let {
  categories.addAll(it)
}
```

`intent` is the consumed pending intent. The unqualified `categories` belongs to the **new destination intent**, the receiver of `createBasicAppIntent().apply`. The null check protects only the source set.

`wrapReactActivityDelegate` saves the activity class in `sLauncherClass`. Consequently `createBasicAppIntent` constructs `Intent(context, sLauncherClass!!)`. In Android 10, that constructor sets only the component; `getCategories()` returns the still-null `mCategories` field. `addCategory()` allocates the set when needed. A pending deep link with categories therefore reaches `addAll` on null before KitchenCam JavaScript starts. This is not an Android 10 compatibility restriction or a malformed Metro URL.

The launcher stores development-client URL intents in `pendingIntentRegistry` in `handleIntent`; it also stores external non-MAIN intents before the app loads. `createAppIntent` consumes them during `loadApp`. The reported NPE proves that the pending intent had a non-null category set, although its exact incoming category values cannot be recovered from the supplied stack trace.

Sources: [Android 10 Intent implementation](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android10-release/core/java/android/content/Intent.java), [Expo issue 46313](https://github.com/expo/expo/issues/46313), [upstream fix 46328](https://github.com/expo/expo/pull/46328/files).

## Supported package check and fix

The npm registry and [SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/sdk/dev-client/) identify 57.0.19 as the current SDK 57 dev-client, with launcher 57.0.20. The published 57.0.20 tarball was checked separately from node_modules and contains the same faulty code, despite the upstream PR's published label. There is no newer stable SDK 57 launcher release available at investigation time.

The persistent `patches/expo-dev-launcher@57.0.20.patch`, registered through pnpm `patchedDependencies`, makes the smallest backport of the upstream category-copy fix:

```kotlin
intent.categories?.forEach { category ->
  addCategory(category)
}
```

This preserves each category using the Android API that initializes its backing set. It leaves the surrounding extras handling unchanged. The patch was prepared in a temporary directory and applied by pnpm, not edited directly in node_modules. Normal pnpm installs reapply it. When moving to a fixed upstream release, inspect its source and remove this version-specific patch and registration.

Expo's dependency check also identified four outdated SDK 57 patch dependencies. They were aligned with:

```sh
fnm exec --using 24.19.0 pnpm exec expo install expo expo-camera expo-constants expo-router expo-dev-client
```

| Package | Before | After |
| --- | --- | --- |
| expo | 57.0.25 | 57.0.26 |
| expo-dev-client | 57.0.19 | 57.0.19 |
| expo-dev-launcher | 57.0.20 | 57.0.20 + persistent patch |
| expo-dev-menu | 57.0.18 | 57.0.18 |
| expo-manifests | 57.0.2 | 57.0.2 |
| expo-updates-interface | 57.0.2 | 57.0.2 |
| expo-camera | 57.0.5 | 57.0.6 |
| expo-constants | 57.0.19 | 57.0.20 |
| expo-router | 57.0.23 | 57.0.24 |

Expo's own dependency graph also updates expo-modules-core to 57.0.20. pnpm recorded version-specific release-age exceptions for the explicitly installed fresh patches. SDK 58 was not installed.

## Intent and app configuration

No app configuration change is needed for this crash. Existing development package ID: `com.kitchencam.app.development`. Existing schemes: `kitchencam-development` and dev-client's generated `exp+kitchencam`. The main activity has the standard MAIN/LAUNCHER and VIEW/DEFAULT/BROWSABLE filters. Manifest filter categories do not initialize a separately constructed Intent's runtime category set.

The debug manifest permits cleartext HTTP for Metro. A local Metro smoke check returned `packager-status:running` and an Android manifest with runtime `exposdk:57.0.0`, the correct package ID, and an HTTP bundle URL on `127.0.0.1:8081`. On this host, plain `--localhost` resolves to IPv6 `::1`; the documented Node `--dns-result-order=ipv4first` flag makes binding match the USB IPv4 URL. The temporary Metro server was stopped after verification. The development-client link is `exp+kitchencam://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`; the launcher's URL helper recognizes the `expo-development-client` host and reads the `url` query parameter. `http://127.0.0.1:8081` is the URL to enter directly in the launcher when using adb reverse.

The pre-existing uncommitted development package ID, Reanimated alignment, and generated/cache lint exclusions were preserved.

## Device regression check

No adb device was attached during the initial launcher investigation. A subsequent physical-device validation on the Xiaomi Mi 9 (Android 10) confirmed that KitchenCam launches correctly with the repaired launcher. The categorized cold-launch command below remains available for reproducing the original path after rebuilding/reinstalling:

```sh
./.cache/android-sdk/platform-tools/adb shell am force-stop com.kitchencam.app.development
./.cache/android-sdk/platform-tools/adb shell am start -W \
  -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d 'exp+kitchencam://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' \
  -p com.kitchencam.app.development
```

The user confirmed successful app launch on the physical Mi 9 after the launcher repair, with no `Set.addAll` NPE. The [device testing guide](ANDROID_DEVICE_TESTING.md) records the validated setup and camera flow.

## Local validation and rebuild

`pnpm check` passed: TypeScript, ESLint, Prettier, 21 Jest suites / 261 tests, and 8 Node boundary checks. `expo install --check` reports dependencies up to date. Expo Doctor passed all 21 checks.

Android was regenerated with `CI=1 EXPO_PUBLIC_APP_ENV=development pnpm exec expo prebuild --platform android --no-install`. Prebuild cleared and recreated the ignored Android project. The prior 768 MiB metaspace setting was restored afterward. Checksums of generated source/configuration files, including the debug signing key, match the files before regeneration. `app.config.js` is unchanged by this repair. The only native code edit is the dependency patch.

Build command, from `android/` (existing cached toolchain, no SDK/NDK reinstall):

```sh
JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
ANDROID_HOME="$PWD/../.cache/android-sdk" \
GRADLE_USER_HOME="$PWD/../.cache/gradle" \
EXPO_PUBLIC_APP_ENV=development \
fnm exec --using 24.19.0 ./gradlew :expo-dev-launcher:clean :app:assembleDebug \
  -PreactNativeArchitectures=arm64-v8a \
  -Pkotlin.compiler.execution.strategy=in-process \
  --max-workers=2 --no-parallel --no-daemon --offline
```

The app build output was removed by prebuild; the launcher output is explicitly cleaned before compilation. Unchanged dependency outputs and toolchain caches are reused.

Build result: **BUILD SUCCESSFUL in 12m 55s**, 496 actionable tasks (471 executed, 25 up-to-date). No toolchain downloads were needed.

APK: `android/app/build/outputs/apk/debug/app-debug.apk` (repository-relative)

- Size: 99,328,818 bytes.
- SHA-256: `2d4bb0e3c52cc9786dc259e9e0a25f128a4a908788abd7edb6f1d3cf3e29d342`.
- Packaged DEX inspection confirms `createAppIntent()` invokes `Intent.addCategory(String)` and has no `addAll` call.
- Packaged DEX inspection confirms both the `KitchenCamImageModule` class definition and its registration in `ExpoModulesPackageList`.
- The APK is debuggable, allows development cleartext traffic, retains both development schemes, and has application ID `com.kitchencam.app.development`.
- Native libraries are exclusively `arm64-v8a`.
- Both merged and packaged manifests retain exactly the prior ten permissions listed in [Android device testing](ANDROID_DEVICE_TESTING.md). No microphone, storage/media, or location permission is present.
- ZIP integrity, APK v2 signature, and 16 KiB ZIP alignment checks passed.

The source/bytecode checks verify the crash-causing operation was replaced in the installed artifact. The subsequent physical Android 10 validation confirmed that KitchenCam launches correctly on the Mi 9 and that the cold camera flow works; see [Android device testing](ANDROID_DEVICE_TESTING.md).
