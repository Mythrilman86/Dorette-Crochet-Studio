# Pattern Publisher feasibility kernel (local experiment)

Start: published v2.6.0, f4c8ce8ba5b20e7d8fea92494744b3890435f6cd.
Run from repository root:

    node --test experimental/pattern-publisher/core.test.mjs

Read docs/pattern-creator-270-architecture.md before integrating anything. This code is not loaded by Studio or its packaging/precache. No page, native version, published source, existing database or backup format is changed.

Scope: read-only visible chart capture via existing shared helpers; bounded section/step text; explicit refresh; immutable authoring snapshots; mandatory integrity checks on a prototype-only text/chart backup. No persistent storage or PDF generation. Unsupported assets/sizes/templates/snapshot archives are rejected. The prototype never certifies publication readiness.

Use synthetic data only. Version-0 backup bytes are disposable and are not a final .deepattern format or a replacement for chart ZIP, Settings JSON or .deewritten.
