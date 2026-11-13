# Offline publishing dependencies

- pdfmake 0.2.23, MIT, https://github.com/bpampuch/pdfmake. The unmodified minified browser distribution includes its compiled transitive runtime. License retained in vendor/LICENSE; dependency provenance and exact lockfile retained in docs/publisher-dependencies/.
- Roboto font files distributed by pdfmake's vfs_fonts.js; Apache 2.0 license retained in fonts/LICENSE (https://github.com/googlefonts/roboto-2). Font embedding restrictions inspected: embedding and subsetting allowed. Coverage is the intersection of all four bundled faces, generated using fontkit. Latin, Greek and Cyrillic coverage is partial; unsupported characters block export. No arbitrary-script support is claimed.
- Existing Mozilla PDF.js is reused unchanged for preview, under its existing local licenses.

No runtime CDN, remote font, account or external image fetch is used. Font and PDF code are loaded into a disposable generation worker. Versions are pinned; the worker uses a tested private pdfmake adapter for same-pass bytes/layout validation and must be retested before upgrades.
