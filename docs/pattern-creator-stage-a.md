# Pattern Creator Stage A — private integrated candidate

Baseline: published v2.6.0 f4c8ce8ba5b20e7d8fea92494744b3890435f6cd plus architecture/prototype 4cfe12f84c913aeb6e7b2dd8bd6e1dc46dee7987. Branch: feature/pattern-creator-stage-a. Website/native candidate 2.7.0; Android Build 24. This is a private authoring preview, not a PDF publisher or Etsy package generator. Public source draft PR/CI was separately authorized in chat. No merge, tag, release, Pages deployment, app-store submission or public APK publication is authorized.

## Implemented interface

Separate Pattern Creator page with Studio/Companion/Creator navigation; My Pattern Drafts; Project & Materials; Instructions/Pieces & Sections; Photos & Charts; Review & Snapshots; independent editable backups. Purple responsive interface, labeled controls, keyboard controls, Up/Down reordering, native Back/dialog handling and actual safe-area CSS values. No misleading PDF/Etsy export controls.

Linked graph drafts and standalone garment/amigurumi drafts; author metadata, terminology, yarn/hooks/materials, sizes/measurements, glossary, technique and construction notes. Piece/section/row/round/note records have stable UUIDs. Numbering is computed within sections, independent for rows/rounds. Duplicate preserves text with a new ID; delete is confirmed with bounded session Undo. Repeat ranges reference stable step IDs in the same section; review detects missing ranges and cycles. Counts and size-specific values are supplied by the author. No language parser, automatic grading or shaping.

Pattern/section/step image attachment and chart attachment; original PNG/JPEG bytes stored as Blobs, image preview/caption/order/removal, author permission confirmation. Maximum image 5 MiB/16 MP, 50 MiB referenced originals including snapshots, bounded before decode where possible. No upload or photo recompression. Originals may retain EXIF; future buyer-facing derivatives must strip sensitive metadata. Unreferenced stored originals are not aggressively garbage-collected, to preserve session Undo/recovery; origin storage can therefore exceed the current export's referenced-byte total and can still fill up.

## Data separation and preservation

Charts are accessed only through a readonly adapter to the existing database, without schema upgrade. Recycled/catalog records are excluded. Visible layers are composed with the existing shared helper. Chart dimensions/palette/runs are factual; selected authored yarn metadata is imported into a separate provenance view. Owned inventory, chart notes, annotations, progress, settings and recovery state are not imported as pattern content. No garment gauge is inferred from yarn usage.

A content fingerprint excludes progress-only changes. Check on draft opening/focus or explicit button shows changed/missing source state. Refresh requires confirmation and changes only reviewed chart facts; authored text stays unchanged. Missing source leaves the reviewed chart usable. The original project is never written by Creator.

Creator storage is separate IndexedDB dee-pattern-creator v1 with drafts, original image Blobs and frozen snapshots. Saves are serialized and revision checked in atomic transactions. Captured draft identity/revision protects asynchronous saves. Saved status follows commit only. Failed/quota saves retain in-memory edits; Retry, recovery copy and external backup are provided. Stale writes fail instead of overwriting another tab. Closing/process termination can still lose edits not successfully persisted; no recovery promise is made for those edits. The last committed draft remains in the library.

## .deepattern v1

Binary DEEPAT1 newline signature; 4-byte header length; bounded UTF-8 envelope with manifest, format/version and mandatory SHA-256; original image bytes follow in declared order. Manifest includes draft metadata, pieces/sections/instructions/repeats/counts/sizes, notes, chart facts, original image descriptors/captions and frozen snapshots. Every original image has size/hash checks and actual image validation. Snapshots have independent content hashes. Current and snapshot-retained originals are required. Truncated/extra/missing bytes, unsupported version/fields, invalid identities and mismatched hashes are rejected before import. SHA-256 detects corruption, not authenticity or ownership.

Limits: 8 MiB header, 80 MiB entire file, 2,000 instructions, 150 sections, 50 pieces, 20 sizes, 100 current images, 10 snapshots. Backup covers all fields currently supported by Stage A; there are no presentation-template fields yet. Existing chart ZIP, Settings JSON and .deewritten are unchanged and remain separate.

Restore previews title/counts, supports Cancel, and atomically creates new draft/image/snapshot records. Restore as Copy never replaces an existing draft. Original draft/revision provenance is retained, while the new local copy starts a fresh save revision. Backup is useful without its source Studio chart.

## Frozen snapshots

Explicit author review acknowledgment, structural review and complete image verification precede freeze. New snapshot ID/time/content hash; snapshot content is saved independently with its referenced originals. UI is read only; later author/chart/caption changes do not replace it. Additional revisions create new snapshots. No Ready to Sell claim. Software review is not a test crochet or rights certification.

## Reproduce checks

Build both asset sets first:

    node scripts/build.mjs web
    node scripts/build.mjs mobile
    node --test tests/*.cjs
    node --test experimental/pattern-publisher/core.test.mjs

Set STUDIO_TEST_BROWSER to a Chrome/Edge executable and run scripts/test-creator-browser.cjs plus the five existing browser suites. The Creator test uses disposable storage and synthetic chart/photo data, compares original chart/catalog/recycle records and Companion records before/after, simulates transaction/quota failures and revision conflicts, verifies refresh cancellation/missing-source retention, and reopens assets offline. Test-only probes are injected by the local server and are not packaged in the app.

GitHub CI includes the new Creator browser suite. iOS build checks are not Safari or physical iPhone tests. Samsung touch/S Pen, native file provider save/restore and physical upgrade require the actual private APK and user acceptance. Issue #24 remains unresolved; no speculative fix is included.

## Focused Samsung checklist

1. Export chart ZIP, Settings JSON and important .deewritten backups outside Studio before any production-package candidate update.
2. Update over Build 23 without uninstalling; verify existing projects, categories/pins, Recycle Bin, layers/progress and Companion PDFs.
3. Open Pattern Creator; link a disposable chart. Enter title/materials/technique, sizes and author instructions.
4. Add two pieces/sections, rows/rounds, duplicate/reorder/delete/Undo and repeat ranges. Confirm numbering changes but authored text does not.
5. Import an original PNG/JPEG, caption/order and attach it to a section/step. Reopen the draft and photo.
6. Edit the source chart in Studio; return and check changed status. Cancel refresh, then confirm it. Written instructions stay intact. Recycle a disposable source and confirm the draft retains the reviewed chart.
7. Review/freeze, change draft text/caption/source, and confirm the frozen content/photograph remains unchanged.
8. Prepare/save a real .deepattern file externally; preview/cancel restore; restore a new copy. Restore on the second device without the source chart. Verify all text, sizes, counts, photographs, chart and snapshots.
9. Reject a corrupted backup without changing current work.
10. Airplane-mode cold restart; open/edit/save Creator, chart and Companion PDF. Check navigation, Android Back, portrait/landscape, touch and tablet S Pen.

## Deferred

Professional PDF layouts/rendering, customer-ready review, listing files/images/copy/tags, Etsy account actions, advanced grading, stitch-chart authoring and AI are not implemented. Stage B/C/D need separate authorization. No new PDF library, cloud service, subscription, account or recurring cost is introduced.
