# v2.6.0 release preparation (private; not published)

User Experience & Personalization adds local bounded diagnostics, personalized Settings and supported drawing groups, clearer navigation, accessible yarn and selection controls, enlarged previews, original motifs, About, offline release notes, a consolidated illustrated guide, and Crochet View collapse, Center and yarn-letter controls.

Routine Insert/Delete Row/Column and Apply Dimensions now preserve zoom and map the viewport-center stitch through the existing structural transformation. A fractional stitch offset is retained. When the focal stitch is removed, its nearest surviving location is used. Advanced resize, detected-grid resizing and photo conversion retain their intentional fitting behavior. No project schema or backup format changes are introduced.

## Acceptance record
The user reports all 19 Build 22 acceptance checks passed on Galaxy S24 Ultra and Galaxy Tab S12 Ultra, including production in-place installation, data preservation, offline chart/PDF access, backups and tablet S Pen. This does not certify Build 23: targeted physical retesting is required after the viewport correction.

## Distribution
Android 2.6.0 Build 23 uses com.deescrochetstudio.app and the existing production signing identity. PR #25 remains draft. No tag, release or deployment is authorized. Website cache identity is prepared as dorette-crochet-v2.6.0; no public update has occurred.

## Known limitations
Chromium intermittent first-time offline installation abort remains tracked in Issue #24 and is not fixed here. Safari and iOS Home Screen physical testing remain unverified. Advanced motif resizing and recognition research remain deferred. Core offline operation and separate chart ZIP, Settings JSON and .deewritten backups are retained. No paid services, subscriptions or recurring services are introduced.
