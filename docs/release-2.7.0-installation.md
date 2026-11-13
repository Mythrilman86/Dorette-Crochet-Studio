# Dee’s Crochet Studio v2.7.0 — installation and recovery

## Before updating

Wait for Saved. Export and verify external copies of all applicable backups: Studio ZIP, Settings and Layout JSON, Written Pattern .deewritten including its original PDF, and Creator .deepattern. Keep these private. Copying the Windows program folder or saving a finished PDF does not back up editable projects.

## Android

Use the APK named **Dees-Crochet-Studio-2.7.0-Android.apk**. Verify its SHA-256 against the release checksums. Leave your current app installed and choose Update. Do not uninstall, clear storage or accept a different application identity. If Android requires permission for the file manager/browser to open the package, follow Android’s normal user-controlled installation flow. No silent installation is performed.

This RC1 is version 2.7.0, code 33. Both public code 23 and private code 32 update in place in controlled emulator rehearsals. Private code 32 users need the APK manually because the updater compares release version names and both builds are 2.7.0. Do not interpret a higher code as a different signing identity.

If installation is rejected, stop and report the message while retaining the installed app and backups. Installing an old APK is not a guaranteed recovery method; Android may reject a downgrade. Never uninstall merely to bypass an update rejection.

## Windows

1. Close Studio work after Saved and make backups.
2. Stop the existing folder using **Stop Dee’s Studio.cmd**. Retain that folder.
3. Extract **Dees-Crochet-Studio-2.7.0-Windows.zip** to a separate permanent folder. Do not launch from inside the ZIP.
4. Open **Open Dee’s Studio.cmd**, using the same Windows account and regular browser profile.
5. Keep **http://127.0.0.1:17828**. If Save and update appears, wait for preparation before confirming. Do not clear site data.
6. Your browser stores projects independently from the program folder. Edge and Chrome also keep separate data. Avoid InPrivate/Incognito for work you want to retain.

To return to the retained Windows package, stop this folder and start the old folder at the same address/profile. Allow its cached update to finish if prompted. If it cannot read your work, keep the storage and use verified backups to restore independent copies in a supported version.

The Windows package uses the installed current Edge or Chrome and the included Windows PowerShell. It needs no Node, Python, compiler or administrator installation. Do not weaken an organization’s script policy to run it.

## Website

Keep the existing website origin and browser profile. Wait for Ready for offline use before disconnecting and verify that charts and PDFs reopen offline. Refresh/retry online if first setup aborts. Never clear site storage as an update step.

## Beta features

Pattern Creator (Beta) and PDF Publisher (Beta) are usable and still being improved. Keep editable .deepattern backups. PDF Publisher supports Graph / Colorwork; do not assume every pattern family has a professional PDF template. A frozen snapshot preserves the reviewed version while later draft edits remain separate.

## New project size

In Studio → Projects, choose **80 × 110** from the dimensions/starter-template selector, then Create project. It means 80 horizontal columns, 110 vertical rows and 8,800 cells. The existing chart is not resized by choosing this option. Other presets and manual sizes remain available.
