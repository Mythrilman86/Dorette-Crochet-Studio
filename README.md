# Dorette-Crochet-Studio
## Stitch Scanner & Encyclopedia

Open **Stitch Scanner** from the workspace toolbar. Browse the offline guide or search
by name or abbreviation. Use the US/UK filter if the same abbreviation has two meanings.

1. Select **Single chart symbol** or **Multi-symbol chart**. Open an image, use the
   phone capture picker, or open the live camera. The live camera requires browser
   permission and HTTPS or localhost. Use JPEG, PNG, or WebP if the browser cannot
   decode the source image.
2. Drag around the symbol or chart area, or enter the crop coordinates. Check the
   magnified preview and scan the crop. You can also mark the crop by hand.
3. Compare each result with the pattern legend. Choose the stitch and tick the
   confirmation box. Select, move, remove, add, or reorder boxes as needed. The
   confirmed list follows your mark order. Consult the pattern for row and round
   direction, repeats, joins and placement.

The scanner compares local pixel masks with bundled templates for chain, single
crochet (cross or plus), half double crochet, double crochet, treble and double
treble in US terms. Overlap scores are measurements of visual similarity. A
clear shape match requires both minimum overlap and separation from the runner-up.
Scores are uncalibrated and have no interpretation as probabilities. Clean upright
charts with separated marks work best. Touching symbols, rotated round charts,
text, grids, colored paper, glare and designer-specific glyphs can produce misses
or misleading matches. A pattern's own legend takes precedence.

**Fabric comparison (experimental)** magnifies the photo and gives visual
comparison guidance. It returns **Uncertain** because a validated offline
fabric classifier and labeled validation set are unavailable.

Images and marks live in memory for the current page session and are independent
of Studio projects. There is no photo upload, external runtime dependency,
account, or subscription. The Pages app needs one successful online load to
install its offline cache. A browser with a pending update uses the Studio's
existing update flow. Bundling the HTML, CSS and JS together makes the feature
portable to a later Capacitor integration. Native camera permissions, gallery
behavior and WebView packaging should be tested at that stage.

The bundled paths, teaching sketches, and examples were created for this
feature. No external graphics or datasets are included. References for standard
conventions and terminology are the Craft Yarn Council's
[chart symbols](https://www.craftyarncouncil.com/standards/crochet-chart-symbols),
[abbreviations](https://www.craftyarncouncil.com/standards/crochet-abbreviations),
and [graphics use guidance](https://www.craftyarncouncil.com/standards).

Run `node --test tests/stitch.test.cjs` for search, segmentation, scoring and
uncertainty checks. For browser verification, serve this folder over localhost,
load the Studio and wait for its service worker to control the page. Check image
import, crop, manual corrections, legend confirmation, camera permission denial,
then disconnect and reload the same URL to repeat the scan from the offline cache.
