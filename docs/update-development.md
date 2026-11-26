# Windows and iPhone update development (provisional v2.7.2)

This is an unpublished development candidate based on v2.7.1, not a new release.
All version codes, native identities and public release metadata remain unchanged.

## Windows: one transition, then in-app updates

The v2.7.1 launcher cannot update itself. For the first updater-enabled release,
make external backups, save work, close every Studio window, stop the old helper
normally, extract the new reviewed Windows package once into a writable permanent
folder, then use its ordinary Open Dee's Studio shortcut with the same Windows
account, browser and regular profile. The address stays http://127.0.0.1:17828.
Do not clear site storage, uninstall a browser or change ports. Close any old
Studio/Creator/Companion/Publisher windows before completing the existing website
Save & Update notice. This one-time bridge uses v2.7.1's existing chart-save guard.
Use external backups first because an older page cannot gain the new guards
until it has updated. No profile or project migration is performed by the helper.

Subsequent compatible releases appear in Updates with current/available versions,
short release notes, Save & Update and Remind Me Later. Save and close other
Studio windows. Save & Update checks the chart/storage guards, freezes editing,
downloads the official public repository's exact Windows asset, checks the HTTPS
release-asset SHA-256 and size, validates every manifest entry and required file,
and stages a separate version. A final save/window check precedes the atomic
app-file pointer switch. The existing service worker prepares its complete cache
and activates with consent. Studio reloads in the same tab and profile. No helper
restart is necessary for this protocol; the helper instance and address remain.
Update Complete is shown only when the running page and helper version agree.

The trust root is the existing official GitHub repository over system-validated
HTTPS, using GitHub's release-asset digest. It is not a separately signed update
catalog and cannot protect against compromise of the repository owner or this
Windows account. No credential, account or subscription is needed to download.
Only github.com and the explicitly allowed GitHub release CDN hosts are followed.
Missing digests, changed helper code, incompatible protocol or malformed packages
fail closed; they never trigger a less secure fallback.

The helper/launcher PowerShell and CMD files are immutable through in-app updates.
An actual helper/security change requires another explicitly reviewed manual
transition. Future ordinary release packaging must set windowsUpdateProtocol:1,
use matching real release versions, include a complete PACKAGE-MANIFEST.json and
retain the same helper bytes. This candidate's development:true package cannot
be accepted as a public update. Do not upload a test fixture as a release.

## Interrupted update and recovery

Before pointer commit, an error leaves current app files selected. Incomplete
downloads/extractions remain in unique StudioUpdates folders and are never
resumed/reused or automatically retried. The original installation and previous
staged versions are retained; the active pointer also records its predecessor.
After commit, a failed offline setup keeps the current browser document open.
Do not repeat the download: use the existing Check for Studio updates control to
finish the cached app update when connected. A lost apply response is uncertain;
inspect the displayed running/helper versions before any separate retry decision.
Closing/reopening uses a fully reverified active package. A failed verification
stops rather than silently choosing unverified files. Keep the failed folder for
review. A return to older code after new code has used storage needs separate
review, because a program-file rollback is not a data rollback.

No updater operation deletes browser databases, project records, profiles or
external backups. Retained program versions/caches consume disk; no automatic
cleanup is included. At least700MiB free space is required for Windows staging.
Browser quota failures keep the old worker active and report incomplete setup.

## Browser-to-helper boundary

The existing TCP helper binds only IPv4 loopback and requires the exact Host.
Update endpoints require a custom request header and same-origin browser context.
Mutation additionally requires exact Origin and a per-process unpredictable
capability token obtained through the protected same-origin endpoint. Tokens
are not stored in browser storage, URLs or logs. No CORS allowance is returned;
OPTIONS/simple-form/foreign-Origin/DNS-rebinding/duplicate-header requests cannot
authorize an update. No client-supplied URL, hash, path or shell command is used.
This boundary does not defend against already-compromised same-origin scripts,
extensions with broad rights, or malware running as the same Windows user.

## iPhone Safari and Home Screen

The existing origin and web manifest identity stay unchanged. Use Check for
Updates or the non-modal Update Available notice. Save and close other Studio
windows/pages, then Save & Update. The active page flushes chart writes; the
safety monitor detects pending/aborted IndexedDB writes and failed localStorage
writes. Activation requires a complete cache and exactly one recognized Studio
client. No other tab is automatically reloaded. Remind Me Later hides the notice
for this page session; a later explicit check or reopened page can show it again.
Interrupted/offline downloads never activate an incomplete cache. A new page
opened during the final browser activation interval remains a browser race;
keep other Studio pages closed until the reload completes.

Creator has its own save chain, dirty state, pending photos and snapshot writes.
Companion has its own progress writes, unsaved personal notes and marker draft;
closing it with these pending requests a leave warning. Publisher's transient
review/export page is not a safe update surface: save needed outputs and close
it first. Charts also refuse updates during known edits, file selections and
conversion/crop operations. Known write failures latch an update block for the
page: resolve/save/export work before a deliberate reload; the updater never
silently dismisses a failed save or exports a supposed universal backup.

Modern browser capabilities remain required; no Safari version compatibility
claim is added. Browser/OS storage eviction is outside the updater's control.
Safari and a Home Screen app may have distinct storage contexts: continue using
the same existing launch mode. Do not remove/re-add the Home Screen app or clear
website data to update. No cross-platform or cross-browser synchronization exists.

## Backups remain independent and external

- Chart-library ZIP: editable charts, yarn, progress and recycled records.
- Settings & Layout JSON: supported preferences/layout.
- .deewritten: Companion work and its required original linked PDFs.
- .deepattern: Creator draft, original images, retained chart and frozen snapshots.

Retain backups in Files/Downloads plus an owner-controlled external location,
outside Studio's browser storage and program/update folders. PDF publication is
not an editable backup. These formats and their restore semantics are unchanged.

## Native iOS

The published manifest has ios:null. No App Store build exists. Native iOS stays
on the existing separately validated App Store-link discovery path if an actual
store release is later authorized. Website/Home Screen updates are not native
iOS updates. No sideload mechanism or Apple subscription is introduced here.

## Review and evidence limits

Automated browser tests use local fixture servers and new temporary profiles,
including a v2.7.1-to-development worker update, offline reload and exact persisted
record/blob comparisons. Windows HTTP tests use the real helper routing/staging
code with only public network adapters replaced by fictional release fixtures.
A separate transport test exercises the original HTTPS/download/hash code against
the existing public Windows asset. No test installs a release on a customer profile.
Windows filesystem tests run on PowerShell7. Native WindowsPowerShell5.1 script
execution was policy-blocked; policy was not changed. No installed WebKit test
runtime was available; phone-sized Chromium is not physical iPhone Safari proof.

After independent review only, the minimum acceptance tests are one disposable
Windows update on the supported old laptop/runtime and one website/Home Screen
update with fictional work on an iPhone, checking save, reload, reopen and offline
access. Do not run these tests or publish this candidate without separate approval.

## Reference evidence

- Microsoft archive safety: https://learn.microsoft.com/en-us/dotnet/standard/io/zip-tar-best-practices
- GitHub public asset/digest metadata: https://docs.github.com/en/rest/releases/assets
- WebKit storage/eviction limitations: https://webkit.org/blog/14403/updates-to-storage-policy/
- WebKit service-worker support: https://webkit.org/blog/8090/workers-at-your-service/
