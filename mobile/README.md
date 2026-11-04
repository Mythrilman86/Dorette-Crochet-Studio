# Dee’s Crochet Studio mobile

Build 1.8.3 uses the v1.8.1 Complete engine and the scanner/layout already present in the website source. The Android application ID and iOS bundle identifier are both `com.deescrochetstudio.app`. Both platforms bundle the web files and illustrated PDF. The app uses the existing local storage origins, schema and ZIP format.

## Install and preserve your projects

1. In your current app or website, select **Back up all** and save the ZIP in a folder you can find outside the app. Keep the ZIP intact.
2. To test a development APK, copy it to the Android device and open it in Files. Verify the APK comes from this project and compare its SHA-256 to the release checksum. Allow installation from Files if prompted, and turn that permission off again afterward.
3. Android accepts an in-place update only if the APK uses the same app ID and signing key and satisfies version-code rules. If Android rejects the signature, retain the existing app and its data until you have exported and checked your backup. Use **Restore backup** after switching builds or moving between devices. Restore creates project copies.

## Build on Windows or a Mac

Use Node.js 22+, JDK 21, and Android SDK Platform 36. From the repository root, run:

```powershell
node scripts/build.mjs web
node scripts/build.mjs mobile
node --test tests/*.cjs
cd mobile
npm ci
npm run sync:android
cd android
.\gradlew.bat assembleDebug
```

Open `mobile/android` in Android Studio if you prefer its build menu. The APK is under `mobile/android/app/build/outputs/apk/debug`. A first build needs internet for dependencies. The Android package works offline after installation.

On a Mac, run `npm ci` and `npm run sync:ios` from `mobile`, then open `ios/App/App.xcodeproj` and select the **App** scheme. Xcode resolves Swift packages. For a signed device build or TestFlight, select your Apple Developer team under Signing & Capabilities. Archive for a physical device using a distribution certificate and matching provisioning profile, then upload via Xcode Organizer or your approved CI signing setup. The CI simulator artifact is unsigned.

## Android signing and migration

- The 1.8.2 Samsung test installs use the certificate SHA-256 `18e1b2ee1bfcc482a8d89633fd449858d81cd590c54c6721610e60f21a9e35bb`. The retained private debug keystore was verified against this fingerprint. Keep an encrypted private backup of the keystore. For a local continuity build, set `STUDIO_DEBUG_KEYSTORE` to the absolute path of that retained standard Android debug keystore, then run `assembleDebug`. Confirm both APKs have the same certificate using `apksigner verify --print-certs`, and check the package ID and version code before installing. Use a higher version code for the next tester delivery.
- GitHub's debug build uses the runner's disposable key and is for CI. Distribute continuity builds privately after testing an in-place upgrade on an emulator with a saved project. Keep the continuity key out of Git, CI artifacts and the Play signing process.
- Build the Play bundle with `bundleRelease -PstudioPlay`. After approval, sign it with the registered upload key and validate it on a Play testing track. Play App Signing supplies the certificate on installed Play builds. Before switching signing channels, export a ZIP outside the app and verify it by restoring a copy in a separate installation. Keep the original ZIP and confirm the restored projects open before relying on the new installation.

## Prepare an approved release

- Edit the root website files once. Both builds use `release-config.js` for the installed version. Advance that version alongside the package and lock, Android version name and code, and Xcode marketing version and build number. Change the website service worker cache name with each changed website shell. The tests check that both staged builds and native version declarations agree.
- PRs compile the website, Android and iOS simulator builds. A matching version tag or manual run stages GitHub Actions artifacts for review. The Android artifacts include a disposable-key debug APK and an unsigned Play AAB. The iOS simulator build uses signing disabled. Test a signed iOS device build or TestFlight separately after setting up the Apple Developer team and provisioning.
- `release.json` describes published availability, independently of the installed build. It uses schema 1. Set each of `web` and `ios` to null until that platform's update is available. An available channel is an object with `version` and `notes`; the top-level `version` and `notes` mirror the web entry for older clients, iOS also requires `storeUrl` for the actual App Store product. Publish the manifest only after verifying the corresponding deployment or store listing. The HTTPS endpoint must allow the Capacitor iOS origin via CORS.
- **Updates** runs only after a tap and skips requests while offline. Web and iOS check their own manifest entries. Web applies a waiting service worker through **Save and update Studio**. Play builds use Play's update prompt after the app's save check. Development installs display private APK and backup guidance. A web deployment, release entry or store submission requires separate approval.

The approved artwork is rasterized by `scripts/icons.ps1` on Windows. Pass the approved master to `-Artwork` and optionally a folder to `-Preview`. The script writes an opaque 1024-pixel iOS asset, density-specific Android launchers, and adaptive foregrounds centered over cream. The web favicon remains the existing Dorette website icon.

The original master is included at `mobile/artwork/approved-icon.png`.
