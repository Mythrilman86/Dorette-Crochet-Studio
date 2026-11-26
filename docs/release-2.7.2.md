# Dee's Crochet Studio v2.7.2 release notes

Windows and website update improvements. Save checks protect pending work before applying an update. Windows checks official package identity and integrity before staging application resources. The website downloads complete offline files before asking to activate an update; other open Studio pages and failed saves can block activation.

This release contains Windows and website artifacts. It does not include a new Android APK or native iOS application. The iPhone route is the existing website/Home Screen web app.

Verification covered an isolated Windows PowerShell 5.1 update with fictional work, an isolated physical iPhone Home Screen update and offline reopening, and a focused Chromium test of the v2.7.1 website update bridge. The intended older Windows laptop and the existing production iPhone Home Screen transition have not been physically verified by these tests.

No automatic cross-device synchronization. Backups and browser storage remain local unless the owner deliberately moves files. Stop on saving/update errors; do not clear browser data or remove a Home Screen installation as a repair.
