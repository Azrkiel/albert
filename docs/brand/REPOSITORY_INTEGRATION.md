# Brand kit and the Albert application

This folder publishes the user-requested Albert brand/design kit v1.3. It is a documentation and asset handoff, with isolated HTML/CSS examples and QA fixtures. It does not install those examples as application routes or replace `src/lib/brand.ts`, the existing canvas, or shared application contracts.

The authoritative release scope remains [current-scope.md](../plan/current-scope.md): course-context learning, PDF annotation, and stroke-aware on-page tutoring. Broader account, onboarding, progress, and dashboard patterns in this kit are design references for future use; they do not restore features deferred by the current release plan. The kit's proposed route map is not a replacement for `docs/plan/contracts.md`.

Start with [README.md](README.md), [MASTER_DESIGN_SYSTEM.md](MASTER_DESIGN_SYSTEM.md), and [PRODUCTION_ASSETS.md](PRODUCTION_ASSETS.md). To inspect the static examples, open `reference/index.html` or the individual `templates/screens/*.html` files in a suitable local browser workflow. GitHub displays the source rather than running these pages.

The package contains the selected Scholar wordmark, serif A+, original/normalized mascot files, licensed fonts, icon/social exports, screen/email templates, and QA evidence. [VERIFICATION.md](VERIFICATION.md) separates completed fixture checks from real product, screen-reader, and email-client acceptance.

Publication of this kit does not mark P8.5 or any application acceptance criterion complete. Future implementation should select only patterns consistent with the active release scope and run the repository's required checks.
