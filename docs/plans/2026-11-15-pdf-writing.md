# PDF writing and incorrect hint targets

The user reported a recorded missing-dx reply and an oversized ellipse over an empty row, then explicitly requested diagnosis, a detailed plan/prompt, implementation, testing, commit and merge. This work combines R2.2–R2.4 because page identity must remain consistent through input, persistence and export. Existing human gates remain open.

## Diagnosis

The mock route selected a fixed reply by problem and rung without checking current writing. Its reading/diagnosis/marks referenced row 3, while the student had written only in row 1. Ruled layout preallocated row 3; missing clusters fell back to its entire band, and the circumscribed ellipse grew to about 1103 × 209 logical pixels. Live reply validation also checked row existence without rejecting empty target rows.

```text
request -> compatible recorded example or neutral fallback
        -> live reply -> validate populated target rows -> repair/error if invalid
mark -> current problem + current ink -> compact annotation
     -> empty/erased/wrong problem -> no annotation

PDF bytes -> displayed pages -> full-width ink -> page/problem rows
         -> hint crop includes print + ink
         -> ordered session events -> latest matching session -> local restore
         -> PDF export -> original pages + ink
                       -> below-page notes -> labelled appendix pages
failure -> retain ink; show retry; never replace saved work with an empty session
```

## Implementation

1. Reproduce the hint defect in mock, geometry, live-validation and conductor tests. Reject empty/erased/wrong-problem mark targets. Preserve legacy explicit fixtures; label recorded mode honestly.
2. Reuse server PDF rendering/regions and the existing capture, session reducer, line inference and conductor. Default PDF-backed worksheets to stacked pages; preserve explicit legacy layout/replay routes.
3. Add optional positive page identity to strokes/rows and paired PDF source metadata to recordings/sessions. Partition line/divider inference by page and problem. Assign ownership by ink length within regions, with the picker as fallback.
4. Accept full-page input. Scope erase and history to the active page. Keep capture stable while annotation display height grows, and reset component state when worksheet/source identity changes.
5. Include a lightened printed problem crop in snapshots, filtered to the target page. Put labelled tutor notes in a shared below-page band and avoid long arrows across printed content.
6. Look up the latest open session for the same student/worksheet/PDF before creation. Restore without re-posting events, shift capture time, and resume append order. Failed lookup leaves capture disabled until retry.
7. Export perfect-freehand student outlines and SVG tutor paths/text using pdf-lib; embed Kalam with the planned fontkit dependency. Invert displayed CropBox/MediaBox/rotation geometry. Preserve original page geometry; append labelled notes pages only when below-page notes exist. Group text/math/citation together during pagination and fail clearly if one note cannot fit.
8. Run focused tests, verify, the full browser suite, build and production checks. Review lifecycle/export edge cases independently before commit/merge. Leave physical-device, live Mongo and independent-viewer human gates open where not run.

## Acceptance adjustment

The original R2.4 wording required page count to remain unchanged while also exporting tutor writing. Before R3.3 free-space placement, tutor writing is outside the physical page. Keeping it at those coordinates silently clips it. Preserve all original pages unchanged in size/order, keep page count unchanged for student-only/on-page annotations, and append labelled notes pages for below-page writing. This avoids overwriting print or silently losing notes.

## Reusable prompt

```text
Continue Albert from current main. Fix recorded hints that assume unrelated work
and marks that expand empty target rows into giant ellipses. Add failing tests;
validate current populated targets in both live validation and rendering, use a
neutral fallback for incompatible implicit fixtures, and identify recorded mode.

Implement R2.2–R2.4: stacked original PDF pages, full-width page-aware handwriting,
region-based problem ownership with picker fallback, page-scoped erase/undo/redo,
printed-page hint snapshots, matching-session restore before creation, and an
annotated PDF download with correct cropped/rotated geometry. Keep tutor notes in
a labelled below-page band until free-space placement is implemented. Export
those notes on labelled appendix pages, keeping each formula/note together.

Preserve ruled/free demos and recordings. Update schemas, fixtures, contract docs
and tests together. Use no live model calls or credentials. Preserve other
worktrees. Run unit/contract/browser/build/production checks, get an independent
review, fix blockers, then commit and merge after checks pass. State human-only
checks and recorded-preview limitations accurately.
```
