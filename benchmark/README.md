# Offline scanner benchmark

This test-only folder is outside the website and Capacitor build inputs. It contains source and license metadata, and does not distribute third-party images.

Download the files named in catalog.json into a separate folder. For an exact repeat use testedUrl and testedFile where provided; otherwise use original and file. Copy catalog.json into that folder. Observe Wikimedia rate limits and leave unavailable files out. Serve the repository with a local HTTP server, open benchmark/index.html, select catalog.json and the images together, and run the benchmark. The browser reads the local files and prints a JSON report. The benchmark page blocks network connections.

The catalog separates WillowW development symbols from Tek evaluation symbols. The independent Aelfgifu symbol sheet has four manually transcribed crop labels and remains in evaluation. Do not move crop variants, related author series, or duplicate source files across splits. Treat labels for photos as source descriptions. They are not verified per-stitch annotations. The Craft Yarn Council chart is used for terminology and conventional shapes only.

Catalog images remain subject to their individual license. CC BY and CC BY-SA entries require creator and source credit, a license link and identification of changes on redistribution. Distribute adaptations of BY-SA images under the required license. The catalog records the source page and original asset for verification. Do not infer a file license from the Commons category. None of the catalog images are shipped with Studio.

The runner measures template overlap and reports top-1, top-3, wrong clear matches, uncertain results, and rejected single-symbol crops. It applies fixed rotation and contrast changes to the originals and compares the rotated raster with a corrected raster. These variants are repeated measurements of each source, not new samples. Annotated crops are scored separately from whole-page region counts. The symbol matcher does not score fabric classification or OCR. Perspectives, physical camera blur, and line-weight strata need more annotated material.

## Pilot results

The catalog lists 23 sources. This paired run used 20 files, with exact hashes in the catalog. It included 11 standalone symbols, two published diagrams, one multilingual terminology table, and six fabric photographs. Two WillowW development symbols and one Tek evaluation symbol were unavailable. Wikimedia thumbnails were used where noted, with the tested filename, URL, MIME type and hash. Use those renditions to reproduce these counts.

| Seven held-out standalone symbols | Default top 1 / top 3 | Thin-stroke experiment top 1 / top 3 | Default / experiment uncertain |
| --- | --- | --- | --- |
| Original | 3 / 5 | 3 / 4 | 6 / 4 |
| Tilted 12 degrees | 3 / 4 | 4 / 5 | 7 / 6 |
| Straightened raster | 3 / 5 | 3 / 4 | 6 / 4 |
| Reduced contrast | 3 / 5 | 3 / 4 | 6 / 4 |
| Contrast raised again | 3 / 5 | 3 / 4 | 6 / 4 |

Both approaches produced zero wrong clear matches and zero rejected crops on these seven sources across the listed conditions. Those counts do not establish a population error rate. The four development symbols had 2/4 top-1 and 3/4 top-three matches upright under either method. The published symbol sheet yielded 70 raw regions because its printed text and symbols were processed together. Four manually labeled crops yielded two default top-1 matches and two top-three matches. All four were uncertain. The decrease schematic produced one connected region, which is not evidence of correct stitch segmentation. Neither diagram has full region ground truth.

The default remains the established matcher. The thin-stroke experiment improved one tilted result and lost one upright top-three result. The experiment is available in this benchmark and is not selected by the app.

Tesseract.js processed the terminology table locally in about 164 ms on the development computer after initialization. The English worker recognized several stitch names, but omitted or misread short codes. The manually cropped US abbreviation column read CH and SC and misread DC. The source also uses DB for a UK abbreviation where the Craft Yarn Council uses dc. Transcription and terminology correctness must be scored separately. These are single-table measurements, not mobile performance or general OCR accuracy.

Fabric samples were kept separate from symbols. No fabric classifier was scored. The app shows visual comparison guidance and reports uncertainty. Perspective correction, calibrated region-level evaluation, broader stitch coverage, mobile OCR, and cloud comparison are deferred. No images were uploaded to AI providers and no services or billing were enabled.
