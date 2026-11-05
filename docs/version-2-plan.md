# Dee’s Crochet Studio 2.0 development plan

Baseline reviewed on November 4, 2026. GitHub main at 87c7fbe released v1.8.4. The website and both native apps package one shared engine. Android GitHub updates use the continuity signing certificate and verify downloads before opening the system installer. Google Play has its own update path. iOS is buildable in simulator CI and still needs device signing and provisioning.

## What v1.8.4 already provides

- Guided crochet already supports bottom-left numbering, a selectable canvas, pinch and wheel zoom, panning, a configurable first row direction and alternating rows, stitch and row completion, a saved guide position, and history. Selection bands and numbered margins already exist. Crochet View reduces clutter but still shares layout and history with the editor.
- The scanner already imports images or uses the camera, supports crop and magnification, ranks template matches, and allows manual marking, reordering and legend confirmation. It has six basic stitch identities and US/UK abbreviation search. The reported generated-glyph checks measure tolerance to image conditions. Real chart and fabric accuracy is still unmeasured.
- The offline encyclopedia contains original entries and symbol artwork. Fabric comparison is visual guidance with an uncertain result. There is no trained fabric classifier or cloud recognition service.
- Individual project and full-library ZIP export and restore already exist. Keep the existing local schema and copy-on-restore behavior. Native share sheets and cross-device transfer of all supported project fields still need end-to-end validation.
- The web app caches its shared files after a successful first online load. Native builds bundle those files. Keep scanner, encyclopedia, project editing, saving and backups usable without a connection.

## Milestones and release gates

| Stage | Implementation | Verification |
| --- | --- | --- |
| Guided Crochet View | Screen-filling chart, safe selection and progress controls. Reuse the current canvas, guide, chart orientation and saved data. Refine gestures and direction settings in focus mode. | Check 79 × 117 and small charts, portrait and landscape, mouse, touch and real S Pen use. Check anchored pinch, labels, progress, history and offline reopen. |
| Offline scanner and encyclopedia | Add nondestructive rotation, exposure controls and region review before testing perspective correction or a learned classifier. Extend the existing library with original instructions, US/UK aliases, troubleshooting and linked scan results. | Collect permission-cleared real chart, legend and fabric samples, recording source and license. Split by design and photographer to avoid near duplicates across development and evaluation. Measure top-1 and top-3 matches, abstention and wrong clear matches by condition. Keep confirmation mandatory. |
| Local help and transfer | Build indexed answers and project-aware guidance using the encyclopedia and selected chart context. Add offline bookmarks and native sharing of existing portable ZIPs. Use OS file pickers and user-selected providers for transfer. | Check source-linked answers, missing-answer behavior, no silent edits, native share cancellation and round-trip of colors, layers, notes, settings and progress. Imports create copies. |
| Optional recognition and references | Benchmark a compact classifier or OCR first. Consider optional model downloads only after licensing, memory and accuracy checks. Keep Offline Scan available. Add Online Enhanced Scan and Combined Analysis only if privacy, quota and quality gates pass. Start online references with curated links and license-aware search. | Use the same real evaluation set for local and online comparison. Measure download size, peak memory, latency and battery impact separately on Android, iOS and browsers. Exercise refusal, cancellation, exhausted quota and offline fallback. |
| Stable 2.0.0 | Integrate validated improvements from GitHub branches. Document deferred or experimental capabilities and the supported modes. | Run all tests, website offline smoke, Android in-place upgrade from 1.8.4 with the same signer and a higher version code, ZIP recovery, iOS simulator CI, and public release verification. Publish the verified signed APK and website only after the gates pass. |

## Recognition and zero-cost decision

Provider documentation checked November 4, 2026. These are candidates, with no accounts or services provisioned.

| Option | Practical role | Decision |
| --- | --- | --- |
| Local templates and preprocessing | Shared across web, Android and iOS. Small bundle, no inference bill, no upload. | Ship as the default and extend using real chart tests and uncertainty thresholds. |
| ML Kit, LiteRT and MediaPipe | ML Kit offers local text recognition on Android and iOS and custom image-label models. Test OCR for printed legends. Use a small labeled classifier through LiteRT or MediaPipe only if it improves on templates. Browser support needs its own compatible runtime and device checks. | Prototype separately. General-purpose image labeling cannot establish crochet stitch accuracy. |
| Gemma family with LiteRT-LM | Gemma 3n supports images and has model-specific redistribution conditions. Google’s newer mobile examples include a 2.6 GB Gemma 4 E2B package. Native and browser runtimes and weights are separate compatibility decisions. | Keep out of the base app. Consider an optional version-pinned, checksum-verified download after license review, real photo validation, and memory, latency and battery measurements. |
| Cloudflare Workers AI Free | 10,000 neurons per day shared across the account. The Free plan rejects requests when the allocation is exhausted. Cloudflare documents zero retention for Workers AI customer content, with separate terms for third-party routes. Its catalog includes vision models with their own license requirements. | Candidate for a limited, consent-based evaluation only. Require a Free-only account, bounded inputs and outputs, strict shared and per-user quotas, no storage or image logging, server-side credentials, and a kill switch. Provider capacity and free allowances do not guarantee public availability. |
| Gemini API unpaid tier | Selected models accept images with model- and project-dependent quotas. Unpaid terms generally permit product improvement and human review, with regional exceptions. | Defer public photo processing. Free access alone does not meet a predictable privacy and service-capacity standard. |
| Hugging Face hosted inference | Free users receive limited experimental credits. Free CPU Spaces are a separate option and do not establish adequate capacity or latency for production vision inference. | Evaluate downloadable models with licenses reviewed individually. Do not rely on shared hosted inference for the public app. |
| Openverse and curated references | Openverse can find potentially reusable images with attribution metadata. Check each original source and license. Curated written tutorials and video links can be shown without copying the underlying work. | Start with links and local bookmarks. Bundle original or verified licensed material only. This is search, not automated recognition. |

Sources

- [ML Kit](https://developers.google.com/ml-kit) and [MediaPipe Image Classifier](https://ai.google.dev/edge/mediapipe/solutions/vision/image_classifier)
- [Gemma 3n model overview](https://ai.google.dev/gemma/docs/gemma-3n), [Gemma terms](https://ai.google.dev/gemma/terms), and [Google LiteRT-LM example](https://github.com/google-ai-edge/litert-samples/blob/main/skills/litert-lm/SKILL.md)
- [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [data use](https://developers.cloudflare.com/workers-ai/platform/data-usage/), and [vision model](https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), and [terms](https://ai.google.dev/gemini-api/terms)
- [Hugging Face inference pricing](https://huggingface.co/docs/inference-providers/pricing) and [Openverse licensing guidance](https://docs.openverse.org/api/reference/made_with_ov.html)

The app can remain free for charting, offline templates, the library, structured help, project transfer and updates. Dependable, unrestricted hosted image inference for every user is outside the verified no-cost envelope. The baseline fallback is improved offline scanning plus curated references and manual review. Before enabling any cloud trial, disclose the provider, exact cropped image, retention and purpose, require confirmation for each upload, and omit project metadata. Disable the online option on quota or service failure. This stage adds no recurring operating expense or paid service.

## Development checkpoint · Offline scanner, help and sharing

The draft adds local straightening and quarter-turn rotation, exposure and contrast adjustments, and single-region comparison. Rotation asks before clearing marks. Exposure and contrast preserve manual labels and confirmations while clearing old shape scores. Repeated chart scans preserve marked regions. Basic template matching remains the default. Perspective correction, sharpening, noise reduction, and broader validated template coverage remain follow-up work.

The encyclopedia now includes original paths and instructions for an increase, V-stitch, bobble, and magic ring. It supports categories and links from corrected scan marks. Offline crochet help provides bundled instructions and troubleshooting. It uses keyword matching. Online references are curated links with local bookmarks. They do not run a general web search or send the entered question. Project sharing uses the existing ZIP format and native share sheets, with browser download as a fallback.

An isolated Tesseract.js 7.0.0 prototype used a local English tessdata_fast file and an original four-line legend rendered in Arial. It read three abbreviations exactly and read dc as de. The run took about 180 ms including worker initialization on the development computer. This is a smoke test, with no accuracy or mobile performance claim. The app does not bundle the OCR engine yet. A browser build needs pinned local worker, WASM and language files. Native alternatives include bundled ML Kit on Android and Apple Vision on iOS. Validate against printed legends with abbreviations, line breaks, skew and shadows before enabling OCR suggestions.

Cloudflare remains a bounded trial candidate on its Free plan. No provider account, image upload, API credential or paid resource was added. Keep recognition suggestions separate from project data and from confirmed stitch labels.

[Local Tesseract.js assets](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) · [Tesseract training data](https://github.com/tesseract-ocr/tessdata_fast) · [Android ML Kit OCR](https://developers.google.com/ml-kit/vision/text-recognition/v2/android) · [Apple Vision OCR](https://developer.apple.com/documentation/vision/recognizing-text-in-images)

A real [CC0 single-crochet swatch photographed by Kawan856](https://commons.wikimedia.org/wiki/File:Single_crochet_swatch.jpg) was imported into the offline browser test. Fabric mode enlarged the sample and returned Uncertain as designed. The photograph was used as a local test asset. This confirms safe handling of one real swatch. It does not measure classifier accuracy or replace a labeled chart and fabric benchmark.

## Development checkpoint · Project organization

The project panel groups matching pinned projects ahead of other matching projects and keeps Favorites independent. Both deletion entry points use the same pinned-project check. The Recycle Bin stores full project records locally and requires confirmation for permanent deletion. Organization mutations commit before the project list changes, and ZIP restores insert new IDs.

Project category selectors include Manage Categories and place Add New Category last. The filter contains names only. Custom category renames and reassignments update active and recycled projects in one transaction. Default categories are protected. Full-library ZIPs preserve catalog names and recycled records using an optional organization field while keeping the original backup version. Restore an older ZIP normally. Use a full backup before moving between application versions, since v1.8.4 has no Recycle Bin interface.

## Development checkpoint · Real-image benchmark and integrated 2.0 candidate

The benchmark catalog, attribution records, and local runner live in [benchmark](../benchmark/README.md). The published symbol and photo sources are evaluation material and are outside the app bundle. The scanner retains manual confirmation. Thin-stroke resampling stays in the benchmark because the pilot found mixed results. In help, users can explain the selected chart row locally or explicitly send a typed search to Wikimedia Commons. Only the search terms are sent. Saved result links remain available offline.

The local OCR prototype read parts of the published multilingual terminology sheet but misread DC in the cropped US abbreviation column. Neither OCR nor a fabric classifier is bundled. Free cloud inference remains deferred. The same-image cloud comparison would require an enabled provider and permission to send the test images. No cloud account, service charge, or image upload was introduced.

## Physical-device verification · Version 2.0.0

After publication, the project owner reported that both the Samsung Galaxy S24 Ultra and Galaxy Tab S12 Ultra updated successfully through Studio's in-app Android updater. The owner confirmed that 2.0.0 runs on both devices, project pinning works, and Samsung S Pen selection works. The owner also confirmed that creating a temporary project, adding a custom category, moving the project to the Recycle Bin, and restoring it worked on their Samsung devices. These are owner-reported physical-device checks, separate from the emulator upgrade, offline, and signing checks in the 2.0 release report.

## Version 2.1.0 physical-device verification

The owner reported that 2.1.0 is installed and working on the Samsung Galaxy S24 Ultra and Galaxy Tab S12 Ultra. Single/Dual switching, upright vertical HELLO, independently increasing letter width, and lettering persistence after reopening all worked. Painting and erasing HELLO worked after selecting its text layer and enabling **Paint and erase on selected text layer**. The owner reported that a lock icon appeared locked while painting was permitted. The icon-only report does not identify which control they saw. The next milestone separates the global Pattern Lock status from each layer's lock status and names the current brush target.

## Version 2.2 development milestone

- Crochet View shows the selected row's complete colorwork sequence from the existing pattern engine. It follows the project direction and alternation settings. The dock can collapse without changing progress. It describes colors and stitch counts only.
- Select a stitch and open **Rows & columns** to insert above, below, left or right, or delete the selected line. Confirm the preview. With safe edits enabled Studio works on a saved copy.
- Structural changes shift chart and layer stitches. Deleted-line reminders move to the nearest surviving line. Inserted cells start in the background color and incomplete. Previous row completion is retained on the surviving stitches.
- Text layers retain the remapped stitch entries, including hand edits, and remain editable. Regenerating the lettering shape still requires confirmation when it would replace those entries. If a reference photo is attached, Studio keeps it and hides its overlay so the user can review alignment. Existing checkpoints and design versions remain separate historical records.
- The current scanner remains the default. Recognition experiments remain outside this milestone.

## Version 2.2.0 physical-device verification

The owner confirmed eight checks on the Samsung Galaxy S24 Ultra and Galaxy Tab S12 Ultra, including in-app updating, project retention, Crochet View Row Color Instructions, middle-column insertion, populated-row deletion with Undo/Redo, Pattern and Layer Lock, offline reopening, and S Pen selection, zoom and panning on the tablet. These results apply to 2.2.0.

## Version 2.3 workspace development

The edge controls state where rows and columns are added or removed. The Settings milestone adds collapsible headings, section navigation, local favorites, and whole-section ordering. Find a Tool uses local keywords and aliases, with separate favorite and recent tool lists. The app menu routes to existing controls. Projects opens as a drawer on smaller screens and remembers visibility separately from Settings. Full ZIP backups can optionally include workspace preferences. Restore asks before applying them. The bundled guide begins with the current quick-start pages and keeps the earlier illustrated reference. Physical Android back-button and S Pen checks, native upgrade verification, and release verification remain pending.

## Version 2.3.0 physical-device verification

The owner confirmed in-place updating and project preservation, Find a Tool, top menus, the Projects drawer, workspace transfer, safe resizing and the offline guide on both Samsung devices. Tablet S Pen testing passed. Customize Layout showed only three sections on both devices and did not pass. The 2.3.1 draft separates its complete section list from ordinary Beginner and workspace filters.

## Version 2.3.4 settings transfer and reliability review

The standalone JSON allowlist covers Settings sections, tool shortcuts, panel visibility, display preferences, chart layout, safe copies, phone toolbar, lettering styles and built-in reference favorites. Project-level display, gauge and editing settings remain in the project ZIP. Current project selection, motifs, yarn library content, Commons results, updater preferences and reminders, locks, diagnostics, caches and temporary files stay local. Chart split and wake lock are session controls. Responsive safe areas are calculated on the destination.

Studio already debounces project writes, serializes them, tracks failed writes for retry, uses a single editing owner across tabs, and audits project records before backup. Restore saves copies through an IndexedDB transaction. Storage estimates and save warnings are advisory. The settings import waits for pending saves before reopening and restores previously written preference keys on a write error. Legacy ZIP workspace import shares this rollback path.

Rendering caches composed colors and visible chart tiles by revision. The existing worker handles expensive image conversion. Offline browser tests cover cache reuse and save/reopen, and the Android fixture checks offline startup. Long-running memory growth, sustained frame timing on very large charts, and Android background/resume under nearly full storage still need device profiling. Prioritize a repeatable large-chart trace and a near-quota interrupted-save recovery drill before changing the render or save engines.
