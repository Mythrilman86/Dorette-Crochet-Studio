# Proposed v2.7.2 release notes

Windows and website update improvements. Save checks protect pending work before applying an update. Windows checks official package identity and integrity before staging application resources. The website downloads complete offline files before asking to activate an update; other open Studio pages and failed saves can block activation.

This release contains Windows and website artifacts. It does not include a new Android APK or native iOS application. The iPhone route is the existing website/Home Screen web app.

Accepted evidence: limited native Windows PowerShell 5.1 fictional update fixture (Report #230); isolated physical iPhone Home Screen candidate-to-candidate update and offline reopening (Report #234). One focused Chromium test verifies the published v2.7.1 old-button bridge against this candidate. The older Windows laptop and existing production iPhone origin have not been physically certified by these tests.

No automatic cross-device synchronization. Backups and browser storage remain local unless the owner deliberately moves files. Stop on saving/update errors; do not clear browser data or remove a Home Screen installation as a repair.
