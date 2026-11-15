# Albert v1.3 — Verification Record

## Completed checks

| Check | Result |
|---|---|
| Pure behavior helpers | 11 tests pass: search/filter/sort, pagination, form validation, and file limits |
| Chromium interactions and responsive checks | 24 assertions pass |
| Automated accessibility | 14 axe-core scans, zero reported violations under the selected WCAG A/AA rule tags |
| Visual regression | 16 comparisons pass against the packaged reference captures |
| Production export validation | Path-only SVGs, 32 aligned poses, icon sizes/safe areas, social dimensions, sprite, motion, and email sets pass |
| Structural checks | Local references, labels/ARIA targets, image alternatives, CSS variables, JSON, and font notices checked |
| Packaging | Readable image files, PDF counts, archive integrity, and checksums checked |

The [machine-readable report](qa/browser-report.json) records the actual browser version, viewport measurements, assertion names, audit results, and changed-pixel ratios. The [QA guide](qa/README.md) explains how to repeat the checks and deliberately update baselines.

## Browser scope

The managed preview relay was unavailable and direct local-file navigation was restricted. The automated suite therefore loads self-contained fixtures assembled from the exact packaged HTML, CSS, JavaScript, images, and fonts. This exercises real Chromium rendering, native controls, keyboard focus, modal behavior, DOM validation, and responsive layout without requesting a network service.

The reference was checked at **1440, 768, 390, and 320 px**. All four screen masters were captured and audited at desktop **1440 px** and mobile **390 px**. Four email previews were rendered and scanned in Chromium. The native dialog's keyboard focus loop was corrected during review, then passed the complete rerun.

The original v1.2 limitation of no browser checks is superseded by these fixture results. The tests still do not establish deployed routing, authentication, actual uploads, persistent storage, a tutor backend, real browser zoom, or email delivery.

## Visual review and limits

The production wordmark/icon, normalized pose exports, sharing card, dashboard desktop, worksheet mobile, and recovery-email capture were visually inspected. The kit includes all remaining captures for review. Baselines are generated design references; they are not a claim that the user has already approved every screen.

**Real screen-reader listening/navigation and actual Gmail, Outlook, and Apple Mail rendering remain manual acceptance work.** An axe-core pass and a Chromium email screenshot do not substitute for those checks. The same applies to the integrated product's real learner flows, saved state, account permissions, and failure recovery. Those items remain explicit in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md).

## Repeatable checks

From the extracted kit:

```sh
node --test tests/logic.test.cjs
python tests/check-package.py
python tests/check-production.py
npm install --prefix tests
npx --prefix tests playwright install chromium
node tests/browser-qa.cjs
```

The production image checks require Pillow and NumPy. Browser testing supports `ALBERT_BROWSER` for an installed Chromium executable. Ordinary browser test runs compare screenshots and do not overwrite baselines; use `--update-baselines` only after reviewing the intended change.
