# Albert — QA Reference Pack

**v1.3.0**

The [browser report](browser-report.json) records the actual Chromium version, 24 interaction/viewport assertions, 14 axe-core audits, and 16 visual comparisons. It also records the outstanding manual review scope.

## Included captures

- `baselines/reference-1440.png`, `768`, `390`, and `320`: the catalog at four viewport widths.
- `../templates/screens/exports/`: desktop/mobile captures of the dashboard, onboarding, worksheet, and settings.
- `screenshots/email-*.png`: previews of the four transactional templates.

These are generated reference baselines ready for review. They do not imply that the user has already approved every new design. The screenshots show actual browser rendering of the packaged sources, not generated mock screenshots.

## Repeating browser and visual checks

From the brand-kit root, install the test-only dependencies:

```sh
npm install --prefix tests
npx --prefix tests playwright install chromium
node tests/browser-qa.cjs
```

The tests also support an installed compatible Chromium through `ALBERT_BROWSER`. The provided report was generated with the installed Linux Chromium named in the report. Compare baselines using the same browser version, fonts, viewport, device scale, and platform when possible.

The runner builds self-contained fixtures from the packaged local files. It tests native browser layout, focus, keyboard, validation, and accessibility semantics without making an API call or depending on a hosted preview. It does not test deployed routing, authentication, email delivery, uploads, or AI behavior.

## Visual changes

Ordinary test runs **do not overwrite baselines**. Comparison allows at most a 0.3% changed-pixel ratio after a small antialiasing tolerance. A failed comparison writes the actual image under `screenshots/actual-*` and records the result.

After deliberately reviewing a design change, update captures with:

```sh
node tests/browser-qa.cjs --update-baselines
```

Review changes alongside the source. Do not update baselines solely to hide a regression. The threshold is an initial practical setting, not a replacement for design review.

## Human review still required

Real screen-reader use, actual browser zoom, user font settings, deployed product flows, and Gmail/Outlook/Apple Mail rendering are not established by these fixture checks. Use [the production checklist](../PRODUCTION_CHECKLIST.md) for those reviews.
