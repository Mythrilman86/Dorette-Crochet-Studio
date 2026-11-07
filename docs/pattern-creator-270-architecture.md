# Dee's Crochet Studio 2.7.0 — Pattern Creator & Publisher architecture

Status: investigation and isolated feasibility prototype only. Not a release candidate.

## 1. Baseline and scope

Audited main at f4c8ce8ba5b20e7d8fea92494744b3890435f6cd (published v2.6.0; Android Build 23). Original Studio editing remains the design workspace. Pattern Creator is a separate page, not a replacement editor or a paid service. The local branch is experiment/pattern-publisher-270-foundation. No UI entry point, service-worker entry, native metadata, production data or existing backup format is changed by this investigation.

The first private candidate should complete Stage A: a usable, safe authoring foundation. It must be labeled an authoring preview, not customer-ready publishing software. Stages B/C must pass their own gates before a pattern can be exported as Ready to Publish. Stage D is a separate substantial program.

## 2. Reuse audit

| Existing implementation | Reuse | Boundary/gap |
| --- | --- | --- |
| app.js, advanced.js compose | Read a copy of visible composed cells, including editable text/motif overrides | Do not save, flatten, mutate layers or touch progress in the source project |
| pattern-tools.js direction/runs/counts | Exact bottom-origin row numbering, alternating direction, color runs and color totals | These are colorwork facts, not stitch types or construction instructions |
| next-features.js structural edits | Existing artwork/position transformations remain in the chart editor | Creator must explicitly refresh after a chart change; authored text is retained |
| pattern-tools.js estimate | Optional measured-swatch usage estimates | Results depend on supplied usage and allowance. No claim of exact yarn quantities; inventory/owned-skein fields are private and excluded by default |
| app.js showSize/measurement UI, advanced.js gauge | Calculations from explicitly entered swatch measurements | Usage gauge is not garment stitch/row gauge. Not all current UI sizing inputs are persisted as portable project facts; require author entry/confirmation |
| pdf-export.js, pdf-worker.js | Existing vector chart geometry, tiling, row/column numbers, legends, monochrome options and color-run PDF | Current PDF writer is chart-specific, WinAnsi-limited, uses approximate text widths and Studio headers; it does not supply a full photo/Unicode/bookmark authoring layout engine |
| image exports, NF.svg, v16DrawTexture | Original chart previews/diagrams | A simulated swatch is not an actual finished-item photograph. Private reference photos must not be imported silently |
| stitch-library.js and offline reference UI | Terminology lookup and author-selected glossary entries, subject to source/license review | Never automatically translate ambiguous abbreviations or infer instructions from chart colors |
| assets/written-pattern.mjs | Separate-page UX, PDF.js preview, revision-checked transactions, busy states, native file bridge | Companion tracks an existing PDF; it is not a document authoring engine. Its database and .deewritten format stay separate |
| chart ZIP, settings JSON, .deewritten | Existing validation/error/retry patterns | None is a complete Creator backup. Do not change their meanings or imply they cover Creator work |
| studio-ops.js, recovery modules | Ownership/conflict protection concepts, confirmed-save messaging | Separate per-draft revision checks and atomic Creator stores are required. Existing chart recovery is not silently reused for new authoring data |

## 3. Local example review

The purchased AMA Dress (10 pages), Isla Dress (11 pages) and Kirby (11 pages) examples were available in Downloads. All pages were text-extracted locally to identify broad feature presence; cover and representative instruction pages were rendered for structural inspection. No instruction text, design, photograph, diagram or distinctive layout was copied into this branch. This is not a technical crochet audit of those patterns.

| Example family | General document needs observed | Studio reuse / missing authoring capabilities |
| --- | --- | --- |
| AMA garment | Finished-item cover, written row ranges, chart references, fit-dependent author guidance | Chart facts reusable; section cross-references and author-supplied construction required |
| Isla garment | Materials/gauge/abbreviations, multiple size counts, repeated rounds, separate construction panels, joining | Explicit size IDs/tables and piece-specific instructions; no inferred grading |
| Kirby amigurumi | Finished-item photo, separate pieces, round/count records, assembly and step photos | General piece/round/photo authoring only. The character/design is not an approved commercial template |
| Graph/colorwork (synthetic reference only) | Full/tiled numbered chart, legend, row runs, technique explanation | Strongest existing automation path |
| Applique (no separately reviewed sample) | Outline/placement, finishing and attachment guidance | Flexible section/image architecture; author supplies all construction |

The current samples are sufficient for foundation design. A permission-cleared original Dorette project and a genuinely made test item will be more useful for later acceptance than more purchased examples. Do not request or upload purchased files for test fixtures.

## 4. Architecture and exact data separation

Proposed page: pattern-creator.html, with narrowly scoped CSS and ES modules. Keep the purple Studio identity and existing Android inset handling. Top-level navigation is added only in a later explicitly reviewed integration change.

Three content layers:
1. **Source chart:** existing dorette-crochet-studio database. Open existing database without a version upgrade; use readonly transactions. List live chart projects, excluding catalog and recycled records. Flush the editor before navigation. Creator has no chart-writing adapter.
2. **Authoring draft:** new dee-pattern-creator database, schemaVersion 1. Author-created metadata, sizes, sections, steps, assets, layout choices and private notes. Refreshing linked facts never replaces this content.
3. **Publication snapshot/output:** an immutable content snapshot plus separate generated artifact records. PDFs and listing files are derived only from that snapshot, never from a live chart. Editing a frozen version requires creating a new draft/revision. Re-export records exact content/layout/font versions and artifact hashes.

Suggested records:
- drafts: id, revision, title, category(graph/garment/amigurumi), schemaVersion, createdAt, updatedAt; metadata; sourceLinks; sizes; sections; theme; assetIds; privateNotes; review acknowledgments.
- metadata: subtitle, designerDisplayName, description, difficulty, US/UK terminology, patternVersion, updateDate, materials, hooks/accessories, measured gauge with units, finished measurements, glossary, care, optional author-written usage notice.
- sourceLink: projectId, lastReviewedFingerprint, reviewedAt, whitelisted chart snapshot, selected imported yarn/gauge facts with provenance. Do not rely on updatedAt alone: fingerprints must include visible composition and relevant selected facts. Ignore progress-only changes.
- size: stable id, label, measurements/units, author-confirmed gauge/material/count overrides. Reordering sizes must not reassign counts.
- section: stable id, title, pieceId, ordered blocks. Blocks include plain/formatted text, row, round, repeat, image, chart and assembly note.
- step: stable id, row/round number or explicit range, instruction text, sizeValues keyed by sizeId, optional author-confirmed stitch totals, structured operations only where explicitly entered, image/chart links and repeat references by stable ID.
- assets: id/hash, original Blob, mime, byte count, dimensions, caption, alt text, ownership/permission status, provenance and optional edited derivative. No remote image URLs in buyer output.
- snapshots: immutable whitelisted authoring content, copied chart facts, embedded assets and all review choices; hash and revision.
- profiles/templates: local reusable designer details and layout defaults, independent from project data. Name/logo/contact inclusion requires explicit per-publication selection. Do not leak a previous pattern's text into a new one.
- artifacts: snapshotId, contentHash, kind, paper/theme, rendererVersion, fileName, mime, size, SHA-256 and Blob or explicitly regenerable status.

Copy-on-import for chart content; explicit Refresh linked chart shows old/new geometry, color counts, missing assets and affected references. Preserve authored instructions verbatim. Mark review acknowledgments stale whenever dependent content changes. A missing/deleted source chart does not destroy the saved authoring snapshot.

## 5. Proposed interface

Create → Document → Design → Review → Export; stages can be revisited.

- Create: select source chart(s) or standalone written pattern; type, title and designer. Explain read-only linking.
- Document: compact sections list and editor. Add Row/Round, duplicate, repeat range, attach image/chart, move section Up/Down, group by piece. Visible author-confirmed counts and size selector. Do not require drag/long-press.
- Design: sensible original templates, color/printer-friendly mode, Letter/A4, image captions, heading styles and explicit designer details. No free-position desktop-publishing canvas in MVP.
- Review: separate Errors, Needs author review, and Not software-verifiable. Navigate to precise fields/steps; inspect all PDF pages. Rights acknowledgment and test-crochet recommendation are distinct from software checks.
- Export: preview exact generated files and sizes, separate Editable backup / Buyer files / Listing materials. Show explicit Digital PDF pattern — not a finished physical item wording.

Desktop/tablet: sections sidebar, editor and optional preview pane. Phone: one pane at a time with persistent draft/save status and large controls. Keep keyboard navigation, focus restoration, Android Back dismissal, screen-reader labels and S Pen/touch targets. Use textContent or structured DOM for authored content; no arbitrary HTML/script insertion.

## 6. First private candidate / MVP

**A1:** separate page; draft library; graph/standalone creation; explicit read-only chart import; metadata; sections; rows/rounds; author-confirmed counts; duplicate/reorder; safe autosave; visible error/retry state.
**A2:** bounded image attachments with original bytes, captions/rights status, complete .deepattern backup, restore-as-copy, reload persistence and revision conflicts. Explicit reviewed chart refresh and immutable snapshots.

Graph/colorwork is the first polished supported category. Garment/amigurumi drafts can use the flexible editor, but no claim of automatic shaping, grading, stitch identification or complete construction support. Stage A has no customer-ready PDF or Etsy publication claim.

Deferred: sophisticated grading; automatic shaping/fit; stitch-symbol diagram editor; amigurumi placement math; freeform magazine layouts; cloud collaboration; AI writing/recognition; Etsy account integration. Do not add these implicitly to Stage A.

## 7. PDF generation decision

Use a renderer-independent page plan in a worker. Two passes measure actual font glyph widths, paginate blocks/tables/images and resolve page numbers/TOC links. Render from the same frozen plan used for preview. Numbered charts remain vectors; body instructions remain selectable text. Embed locally licensed fonts/subsets; flag unsupported glyphs instead of silently substituting '?' as the current chart writer does.

Provisionally prefer a pinned, vendored pdf-lib + embedded-font adapter for new Creator documents, reusing chart layout/tiling logic and vendored PDF.js for preview. pdf-lib supports browser-side text, images, fonts and PDF page embedding under MIT. This is a candidate, not a dependency installed or performance-validated by this audit. Its low-level pagination and outline/link handling need a focused spike. PDFKit is an alternative to measure, not an additional dependency to bundle. Extending the current bare writer with all these features is a larger maintenance risk.

Stage B gate: original synthetic cover + long instructions + PNG/JPEG + tiled 200×300 chart + Letter/A4 + monochrome + TOC/bookmarks. Validate text extraction, links, image orientation, clipping, row order and all pages independently with PDF.js and Poppler. Copying a chart's existing Studio-branded PDF as the whole commercial pattern is insufficient. Provide designer branding through a separate render path; do not change existing chart exports unnecessarily.

Keep headings with following text, avoid breaking short critical instructions; split an oversized block only at explicit safe boundaries with a continuation label. Long tables repeat headers. Store layout overflow diagnostics; author review cannot turn definite clipping into a valid document. Selectable text alone is not a claim of fully tagged accessible PDF; test reading order and document accessibility separately.

No server-side Chromium, CDN fonts or paid PDF service. A browser print dialog may be a development fallback, not the cross-platform buyer-file contract. Native Android printing and iOS share behavior require separate verification.

## 8. Etsy preparation (official sources reviewed 2026-11-07)

- Up to five buyer files, each up to 20 MB. Supported useful formats include PDF, ZIP, JPG/PNG and TXT. File names are buyer-visible, limited to 70 allowed alphanumeric/period/underscore/hyphen characters. Digital listings do not offer variations. Package sizes within files or separate deliberate listings; no automatic variant selector assumption.
- Conservatively enforce 20,000,000 bytes per final buyer file, explaining the chosen limit rather than confusing it with the Companion's separate 20 MiB import cap. Reject six-file packages and unsafe paths; never silently truncate names to collisions.
- Title cap 140 characters; up to 13 tags, each up to 20 characters. Propose factual tags only from approved fields; no ranking/sales guarantees.
- Generate preview/listing images separately from buyer-download files, with crop-safe margins and actual-document excerpts the author selects. Avoid giving away the entire pattern by default. Draft alt text stays editable.
- Current craft-pattern image guidance calls for at least one real, unedited photo of something made from the pattern. A simulated swatch or synthetic render is not evidence of a finished item.

Stage C output directories: Buyer Files (pattern, optional printer PDF/chart supplement/ZIP) and Listing Materials (cover/preview images, listing copy/tags and checklist). The outer local download bundle is not automatically an Etsy buyer file. A supplemental buyer ZIP needs its own complete contents/size/rights checks. Validate the final exported bytes, not estimates. Offline checks show the rule verification date; rules must be rechecked before stable release.

No account connection, OAuth, scraping, listing publication, payment handling or seller action. Studio exports remain free. This does not mean Etsy selling itself is free: marketplace fees and seller obligations remain outside Studio and no such charges are activated here.

## 9. Storage, autosave and complete backups

Use atomic revision-checked readwrite transactions across drafts/assets/snapshots when a change spans stores. A queued save captures the draft ID and expected revision. Reject stale tab writes; offer explicit reload/copy/reconcile, never last-write-wins silently. Show Saved only after transaction completion. Coalesce small edits, retain dirty content after errors, retry deliberately and offer an external recovery export. Lifecycle events can request flushing but cannot guarantee saving during process termination. Never promise recovery of unpersisted edits.

Budget assets by bytes and decoded pixels; show quota estimates as estimates. Use bounded previews, workers and one active PDF page. Garbage-collect only unreferenced Creator assets after verified transaction success; never touch chart/Companion stores. Use soft deletion and explicit permanent-delete confirmation for Creator drafts. Frozen snapshots must retain their assets even when the live chart is removed.

Proposed .deepattern v1: separate binary container with magic/version, bounded manifest, canonical metadata hashes and length/hash for every asset, followed by original image bytes and authoring snapshot data. Include authored text, selected chart copies, profiles only if selected, templates/settings needed to reproduce, asset provenance and frozen versions. SHA-256 is required and fails closed; it detects corruption, not authorship/authenticity. Do not label an incomplete backup complete. Restore validates file size before allocation, all lengths, limits, MIME/magic/dimensions, references and hashes, then previews and imports under new IDs atomically. Reject unknown versions and malformed/duplicate IDs; canceled/failed restore changes nothing. Keep schemas migratable and preserve exported v1 backups.

Final byte/pixel/asset limits must be measured on Samsung and browser storage. Proposed initial targets (not promises): 5 MB compressed image / 16 MP input, downsampled display derivatives, 50 MB total pattern-assets budget with explicit capacity checks. Large legitimate patterns need a clear error and export path, not silent data dropping. Avoid retaining base64 copies of every image. Never rely on localStorage for photos or full drafts.

## 10. Validation, privacy and originality

Errors: missing/broken referenced blocks/assets, impossible chart geometry, duplicate identity, incompatible file version, corrupt backup, missing required chart/legend colors, unresolved references, cycle in repeats, invalid page plan or file-count/byte violation.

Concerns: unexplained numbering gaps, inconsistent size labels, blank gauge/material fields or quantities without measurement provenance, ambiguous US/UK terms, unexpectedly changed source chart. Let authors explain legitimate exceptions with visible notes; do not invent values.

Human-only review: design ownership/licensing, real finished-item appearance, actual fit, stitch-count intent, construction feasibility, crochet test and commercial readiness. A software pass is not proof the pattern works or has commercial rights. Request explicit review of the exact frozen content and all pages before final export; changes invalidate that review. Track asset source/rights, including logo permission; never treat a copyrighted character from a purchased example as authorized commercial material.

Private project notes, reminders, progress, inventory quantities, hidden layers, device identifiers, local paths, recovery snapshots and diagnostic logs are excluded from buyer files by default. Preview shows exactly which designer contact/logo fields will appear. Photos stay local; remove EXIF/GPS from buyer/listing derivatives while preserving original bytes privately in the editable backup. External links are explicit HTTPS links, never automatic fetches. Disallow SVG/HTML uploads in MVP unless securely rasterized and sanitized in a later validated path. No remote embedded resources or template execution.

## 11. Acceptance matrix

A: graph and standalone drafts; existing live chart selection; source readonly proof; layer composition; author text preservation during refresh; source deletion; snapshot reproducibility; exact section/step identities; row/round ranges; stable size IDs; repeat ranges/cycles; blank fields; import/cancel/corruption; revision conflicts; failed/quota saves; retry; reload and offline reopen; original image bytes and complete backup round-trip.

B: simple/large (79×117,120×165,200×300), multi-page and combined patterns; multi-piece/multi-size synthetic examples; long/unbroken text; Unicode names and symbols; missing fonts; tall images; EXIF rotation/GPS; portraits/landscape; page overflow; links/bookmarks; Letter/A4; selectable text and chart-number orientation; independent render inspection; output-size limits; long-session memory and cancellation. Source artwork, progress and histories must remain byte-for-byte unchanged before/after generation.

C: five/six file boundary; 20,000,000 byte boundary; supported extensions, path/name collisions, unsafe names; title/tag length and duplicate checks; correct included-file summary; no private metadata; accurate digital-pattern wording; listing images separated; author-confirmed real photo; offline rule date; actual export download/save/reopen checks.

Platform/release: Windows Chrome/Edge, responsive phone/tablet, actual Samsung S Pen/Android Back/file picker/share, offline cold restart, interrupted operations, physical upgrade from approved Build 23; existing three backup formats remain compatible. iOS CI is a build check only. Safari/Home Screen requires real supported testing. Issue #24 remains separately tracked; do not expand precache without measuring setup time/failure frequency and storage.

## 12. Effort and risks

This is a major subsystem, not a PDF button. Stage A is high complexity (separate storage, authoring UX and preservation). Stage B is very high (measured typography, photos, charts, Unicode, cross-platform document correctness). Stage C is medium-high after B is stable. Stage D is a separate research/development scope. Estimate at least six substantial implementation/validation milestones, each potentially requiring multiple device-test iterations; a reliable completion date is not supported by the current spike.

Highest risks: silent source updates or overwritten author text; incomplete backups; mobile memory/origin quota; cross-tab saves; pagination/font coverage; misleading yarn or sizing claims; photo rights/privacy; false publication-readiness claims; native exports and unverified Apple behavior. Mitigate by immutable snapshots, strict output allowlists, atomic storage, independent renders, explicit missing-data flags and gated staged delivery.

## 13. Staged roadmap and exit criteria

1. A1 data/authoring UI: create/link/edit/reorder, read-only source adapter, deliberate refresh. Exit: existing source unchanged; authored text survives updates.
2. A2 persistence/assets/backup: revision conflicts, recovery export, images and complete .deepattern restore-as-copy. Exit: failures preserve last confirmed data and all assets round-trip. First private device candidate ends here; publishing remains disabled.
3. B1 layout/renderer spike: compare library size, measured typography, fonts, PNG/JPEG, TOC/bookmarks; independent synthetic PDF renders. Exit: choose one local engine based on measured evidence.
4. B2 graph-pattern document workflow: cover, materials, authored instructions, exact chart/color facts, all-page preview, frozen reviewed export. Exit: no clipping, no source mutation, realistic Samsung offline export verified.
5. C listing/package preparation: byte/file validation, factual draft copy/tags, original listing images and manual seller checklist. Exit: no Etsy account use and no implied rights/fit certification.
6. Integrated private acceptance: Stage A/B/C failure cases, upgrade, existing chart/Companion data and backups, full CI and exact signed artifact acceptance. Only then seek separate stable-release approval.
7. D separately scoped: advanced multi-size editing/grading assistance, stitch-chart authoring, richer amigurumi construction, independently validated optional AI.

## 14. What the current prototype proves (and does not)

experimental/pattern-publisher/core.mjs is a dependency-free feasibility kernel, not imported by any Studio page, worker or build entry point. It uses existing compose/runs/counts via a read-only injected adapter, creates bounded plain-text drafts, confirms chart refresh, preserves authored steps, excludes private chart state, freezes a hashed immutable authoring snapshot and round-trips supported text/chart content with mandatory checksum checks.

The prototype format is explicitly version 0 and not .deepattern v1. It rejects unsupported image/size/template fields instead of silently producing an incomplete backup. It has no UI, IndexedDB persistence, autosave, images, full repeat graph, finalized schema, PDF renderer, buyer package, Etsy action or publication-ready claim. Do not use it for real irreplaceable work. Tests run with original synthetic data only.

## Official sources

- https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings — file counts/sizes/types, names and digital variation limitation.
- https://help.etsy.com/hc/en-us/articles/115015628707-How-to-Create-a-Listing — title limit and manual listing workflow.
- https://help.etsy.com/hc/en-us/articles/360000336307-How-to-Use-Tags-to-Get-Found-in-Search — tags and length limits.
- https://help.etsy.com/hc/en-gb/articles/44297885802647-How-Do-Etsy-s-Listing-Image-Requirements-Apply-to-My-Listings — actual-content previews and real craft-pattern example photographs.
- https://pdf-lib.js.org/ — supported JavaScript PDF capabilities.
- https://github.com/Hopding/pdf-lib/blob/master/LICENSE.md — MIT licensing and notice requirements.

No service account, paid API, marketplace listing, native package or public deployment was created by this audit.
