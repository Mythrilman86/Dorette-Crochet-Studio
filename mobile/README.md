# Dee’s Crochet Studio mobile

Build 1.8.2 uses the v1.8.1 Complete engine and the scanner/layout already present in the website source. The Android application ID and iOS bundle identifier are both `com.deescrochetstudio.app`. Both platforms bundle the web files and illustrated PDF. The app uses the existing local storage origins, schema and ZIP format.

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

## Prepare an approved release

- Edit the root website files once. `scripts/build.mjs` packages them for the website and Capacitor. Mobile adds its file bridge and display name and omits the website PWA manifest and service worker. Keep native edits in `mobile/android` and `mobile/ios`.
- Advance the version in `release.json`, `release-config.js`, the package and lock files, Android Gradle, and Xcode. Increase Android versionCode and Xcode build number. Bump the website service worker cache name. After review, tag the commit `v<version>`. PRs run checks and compile Android and the iOS simulator build. Tags and manual runs package website files, a test APK, an unsigned Play AAB and an unsigned iOS simulator build.
- Sign the Play AAB with your registered upload key. Publish through a Play testing track first. Play App Signing determines the certificate on delivered binaries. Build the Play AAB with `bundleRelease -PstudioPlay`; use Google Play’s testing flow to validate the in-app update prompt with a higher version code. Use a stable private signing key for development APKs if testers need in-place updates.
- After approval, publish the website artifact at the existing Pages URL and expose its `release.json`. It must allow requests from the Capacitor origins via CORS. The workflow only packages files. For a public update, fill in the App Store product URL and, if offering a separately signed development APK, the GitHub Release APK URL. Leave each field null until that channel is actually ready. Keep release notes short and align them with what has shipped.
- **Updates** checks only after a tap, skips the request if the device reports offline, and gives up on a slow connection. Play installs use Play’s update prompt where eligible. iOS opens the configured App Store product. Development builds can link to the repository’s HTTPS release APK. A local ZIP backup is the handoff between signing channels.

The approved artwork is rasterized by `scripts/icons.ps1` on Windows. Pass the approved master to `-Artwork` and optionally a folder to `-Preview`. The script writes an opaque 1024-pixel iOS asset, density-specific Android launchers, and adaptive foregrounds centered over cream. The web favicon remains the existing Dorette website icon.

The original master is included at `mobile/artwork/approved-icon.png`.
