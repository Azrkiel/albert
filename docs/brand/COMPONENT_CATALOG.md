# Albert — Component Catalog

**Version 1.3.0**

Open [the local reference](reference/index.html) for interactive specimens. “Example” below means functioning local front-end behavior. It does not imply that a production service has been integrated. Load [web-pattern CSS](tokens/albert.web.css) after the foundation and component styles.

## Foundations and controls

| Component | Contract | States | Delivery |
|---|---|---|---|
| Wordmark and A+ | Preserve the selected masters and accessible name Albert | Primary light-surface assets | Path-only SVG/PDF masters plus PNGs and reverse/mono variants |
| Mascot | Stable paper professor and event-driven poses | Eight defined poses | Eight original poses plus 32 aligned exports, a sprite, and a crossfade |
| Button | One main action, 44/48/56 px minimum sizes | Default, hover, pressed, focus, disabled | Reusable CSS and measured visual guide |
| Text/select field | Persistent label, appropriate input type, helper/error association | Empty, entered, invalid, disabled | CSS and validating example |
| Checkbox/radio | Native input, clickable label, legend for groups | Checked, unchecked, focus, disabled | Native controls in form example |
| Preference switch | Explicit preference label and clear state | On/off, focus | Native checkbox with switch role and local motion example |
| File selector | Native picker, declared format and size, meaningful errors | None, selected, invalid | Local PDF/PNG/JPEG and 10 MB checks |

## Navigation and content

| Component | Contract | Behavior | Delivery |
|---|---|---|---|
| Header/sidebar | Identity, context, useful destinations | Mobile disclosure and current location | Local reference and CSS |
| Breadcrumb | Hierarchy in a labeled nav and ordered list | Ancestors navigate; current item does not | Example and reusable CSS |
| Tabs | One selected view; correct roles and relationships | Arrow, Home/End, roving tab order | Example JS and CSS |
| Card/list | Group genuinely related content | One clear action; avoid competing nested links | Layout rules and page specimens |
| Badge | Text expresses status | Display-only, not a fake button | CSS and table example |
| Table | Accessible name, real column headers | Search, filter, sort, pagination | Local table with six illustrative rows |
| Pagination | Real current page and bounds | Clamps after filtering; disables unavailable actions | Helper logic, example, tests |
| Progress/stepper | Declared stages and actual state | Accessible current step; clear next/back | Manual progress specimen and onboarding example |
| Skill visualization | Evidence and meaningful labels | No fabricated precision | Product contract specified; assessment integration required |

## Feedback and layers

| Component | Contract | Behavior | Delivery |
|---|---|---|---|
| Inline validation | Field-specific correction and error summary | Focus summary, link to field, preserve input | Local form example |
| Notice/banner | Persistent context-specific information | Words plus status treatment | CSS and success/error specimens |
| Toast | Nonblocking confirmation | Polite status, dismiss, useful focus return | Local example JS/CSS |
| Empty state | Explain the absence and first useful move | Different first-use and filtered-empty copy | Page/table examples |
| Skeleton | Preserve geometry; no essential content inside | `aria-busy`, separate status text | Manual loading specimen; reusable appearance |
| Dialog | Accessible name/description, focused decision | Native modal, Escape, return focus | Review example and CSS |
| Accordion | Optional, understandable disclosure | Native details/summary | Example and CSS |
| Inline help | Essential instructions stay visible | Button disclosure, Escape | Local example |
| True tooltip | Nonessential short help only | Hover/focus access, Escape, no interactive contents | Specified for future need; not exported as a custom widget |
| Navigation dropdown | Ordinary links with a disclosure trigger | Full menu keyboard contract only if using ARIA menu roles | Pattern specified; mobile disclosure example provided |

## Page patterns and infrastructure

| Pattern | Included | Production integration |
|---|---|---|
| Landing page | Hero, benefits, CTA, help/policy destinations | Real public routing and approved content |
| Course hub | Table/list pattern, search/filter/empty states | Actual course records and access checks |
| Onboarding | Three-step interactive layout | Persisted setup, upload/import services |
| Worksheet | Work/tutor layout and question → step → waiting example | Actual canvas, course retrieval, tutor service, autosave |
| Recovery/404 | Supportive text and useful return route | Router and real error destinations |
| Progress | Evidence and practice contract | Actual skill assessment and data visualization |
| Settings/account | Preference and validation patterns | Authentication, persisted settings, recovery, account controls |
| Footer/help/policy | Structure and ownership requirements | Actual applicable text and maintained destinations |

## Component acceptance template

For each future addition, record:

1. The learner task and reason an existing component cannot solve it.
2. Anatomy, tokens, variants, sizes, and content limits.
3. Default/loading/empty/error/success behavior where applicable.
4. Keyboard operation, focus movement, announcements, and text alternatives.
5. Narrow-screen reflow, zoom behavior, and long/translated content.
6. Service dependencies and actual data boundary.
7. Verification performed, known limits, and a responsible owner.

Use the same fields when promoting a local example into production code. A visual specimen is not a completed backend or an accessibility certification.
