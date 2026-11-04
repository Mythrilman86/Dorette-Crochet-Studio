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
