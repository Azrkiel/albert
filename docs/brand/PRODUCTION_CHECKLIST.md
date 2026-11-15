# Albert — Production Acceptance Checklist

The local design-system examples are implemented. This checklist is for the integrated Albert website; unchecked items should not be assumed complete because a reference specimen exists.

## Design-system package

- [x] Chosen wordmark, A+ icon, palette, and eight mascot poses are retained.
- [x] Buttons, spacing, headers, lines, page structures, and slides are specified.
- [x] Navigation, input, content/data, feedback, layers, and complete-page contracts are added.
- [x] A self-contained HTML/CSS/JS reference uses local sample data.
- [x] Search/filter/sort/pagination and validation helpers have automated tests.
- [x] Fonts are supplied with their OFL license notices.
- [x] Production vector logo masters and mono/reverse variants are supplied.
- [x] Website/app icons, sharing cards, and an integration manifest are supplied.
- [x] Mascot poses have normalized sizes, alignment metadata, a sprite, and a one-shot transition.
- [x] Four responsive screen sources and eight reference captures are supplied.
- [x] Four communication templates include HTML, plain text, previews, and variables.
- [x] Chromium fixture keyboard/DOM assertions, axe-core scans, and visual comparisons pass.
- [x] Actual verification scope is documented in [VERIFICATION.md](VERIFICATION.md).

## Product integration

- [ ] Every route and navigation destination works, including deep links and reloads.
- [ ] Authentication, session expiry, account recovery, and return paths use the real identity service.
- [ ] The service enforces appropriate access for every course and material request.
- [ ] Courses, annotations, preferences, worksheets, and skill evidence persist correctly.
- [ ] Imports expose actual queued/uploading/processing/ready/error states and preserve retry context.
- [ ] File content and size checks are repeated server-side, matching the user-facing limits.
- [ ] Tutor hints use real course context and explicitly handle uncertain notation.
- [ ] Autosave and connection messages accurately represent acknowledged writes and failures.
- [ ] Destructive actions have explicit consequences, a cancel path, and correct authorization.
- [ ] Help, privacy, accessibility, and applicable policy content match the actual product.

## Browser and accessibility review

- [ ] Keyboard-only navigation covers the complete primary flow.
- [ ] Dialog focus entry, trapping, Escape, close, and focus return work in supported browsers.
- [ ] Form summaries, invalid fields, live announcements, and corrections work with a screen reader.
- [ ] Navigation, forms, and controls fit at 320 px without accidental page-wide overflow.
- [ ] Text zoom and 400% reflow retain essential content and actions.
- [ ] Reduced-motion behavior, visible focus, and text/control contrast are checked.
- [ ] Canvas annotations and important math have equivalent accessible representations.
- [ ] Long names, translated labels, user font settings, and real uploaded content are exercised.
- [ ] Loading, empty, partial, offline, timeout, unauthorized, and server-error paths are exercised.

## Delivery and operation

- [ ] Fonts and assets are served with appropriate caching and optimized production derivatives.
- [ ] Critical content has reserved image dimensions and stable layout.
- [ ] Public pages have useful titles, descriptions, canonical URLs, and sharing metadata.
- [ ] Private learner content is protected and not inadvertently indexed or placed in public metadata.
- [ ] Monitoring identifies failures without unnecessarily collecting sensitive worksheet content.
- [ ] Analytics and user preferences follow the actual product's collection and consent behavior.
- [ ] Product tests cover the primary learner journey and meaningful failure paths.
- [ ] Component ownership, version changes, and maintained help content are assigned.
