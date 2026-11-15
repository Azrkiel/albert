# Phase 4 — Ink

**Purpose.** Albert's side of the page: a circle drawn around the wrong symbol, an arrow, and a note in red handwriting that writes itself in the margin. This is the moment people remember, and it is also the piece most likely to eat time, so it is built in levels: the first level is enough for the demo, and each later level only makes it prettier.

**Done looks like.** Tapping the hint mark on the missing-`dx` work draws a rough red circle around the right clusters, an arrow from the margin, and the question, with math typeset and a lecture citation beneath. It looks hand-made, it never covers the student's ink, and it replays.

| | |
|---|---|
| Depends on | Phase 2 (the surface, rows, clusters). Live hints need Phase 3; until then use mock hints |
| Unblocks | The demo |
| Time box | 6 hours, of which P4.5 gets at most 90 minutes (gate **G2** at T+16h) |
| Lane | A — Page |

Read first: [`contracts.md`](./contracts.md) §1, §4.3, §4.6, [`decisions.md`](./decisions.md) D3, D4, D13.

```
src/lib/ink/
  layout.ts        # layoutHint: where everything goes        (pure)
  geometry.ts      # cluster ids → circle / underline / arrow geometry   (pure)
  math.ts          # MathJax loader, latex → SVG node + size
  text.ts          # level 0 web-font text; level 1 glyph paths
  marks.ts         # roughjs shapes
  animate.ts       # revealStroke, revealWipe, sequence
  conductor.ts     # HintEvent stream → drawn AlbertMarks
src/components/work/AlbertLayer.tsx
```

**Constants** (put them in `src/lib/ink/constants.ts`):

```ts
const WRITE = {
  fontSize: 26,            // logical px, hint text
  citationSize: 18,
  lineHeight: 36,
  padX: 16,                // inside Albert's column
  charsPerSec: 22,         // brisk; real handwriting is far slower and would bore an audience
  mathGlyphMs: 45,
  circleMs: 550, arrowMs: 350, underlineMs: 300, crossOutMs: 400,
  circlePad: 10,           // logical px around the clusters
  fadedOpacity: 0.35,
} as const;
```

---

### P4.1 — Layout

**Goal.** Given a row and a hint, decide exactly where each word, formula and mark goes. Pure code, tested without a browser.

**Build.**
1. `geometry.ts`:
   ```ts
   function targetBox(clusterIds: string[], clusters: Cluster[], row: Row): BBox
   // union of the clusters' boxes; the whole row's ink box when the list is empty or unknown
   function circleFor(box: BBox): { cx: number; cy: number; rx: number; ry: number }   // box + circlePad
   function underlineFor(box: BBox): { x1: number; y1: number; x2: number; y2: number }
   function arrowFor(from: { x: number; y: number }, to: BBox): { path: string; head: [string, string] }
   // a gentle curve from the margin anchor to the nearest point on the target's padded edge
   function marginAnchor(row: Row): { x: number; y: number }    // (albertCol.x + 6, row centre)
   ```
2. `layout.ts`:
   ```ts
   type Measure = (seg: InkSegment, size: number) => { w: number; h: number };
   function layoutHint(args: {
     row: Row; segments: InkSegment[]; citation?: string;
     measure: Measure; occupied: BBox[];
   }): { items: Array<{ seg: InkSegment | { type: "citation"; text: string };
                        x: number; y: number; w: number; h: number; line: number }>;
         bbox: BBox }
   ```
   Rules: start at `(albertCol.x + padX, row.bbox.y + rowPaddingTop)`. Wrap at `albertCol.w − 2·padX`. Text wraps at spaces; a math segment never splits; `break` starts a new line. The citation goes on its own last line at `citationSize`. If the resulting box overlaps any box in `occupied`, move it down in steps of `lineHeight` until it does not.
3. The arrow's start is the margin anchor, which does not depend on the text. That lets the arrow be drawn as soon as a `mark` event arrives, before the hint exists.

**Acceptance**
- [ ] **P4.1-AC1** — Text wraps inside the column and never enters the student column. *Verify:* `tests/unit/layout.test.ts` with a fake `measure` (10 px per character): every item's `x ≥ albertCol.x` and `x + w ≤ albertCol.x + albertCol.w`.
- [ ] **P4.1-AC2** — A hint never overlaps an existing one. *Verify:* unit test placing two hints on the same row: the second box starts below the first.
- [ ] **P4.1-AC3** — Circles enclose their clusters. *Verify:* `tests/unit/geometry.test.ts`: the ellipse from `circleFor` contains all four corners of the target box.
- [ ] **P4.1-AC4** — Unknown clusters fall back to the row. *Verify:* unit test.

---

### P4.2 — Text and math, level 0

**Goal.** A hint appears in a handwriting font with correctly typeset math, revealed left to right. This level alone is acceptable for the demo.

**Build.**
1. **Font.** Choose one open-licence handwriting font that is legible at 26 px and has full Latin coverage (for example Kalam, Caveat or Patrick Hand; all are under the SIL Open Font License). Download the font file into `public/fonts/` with its licence text. Load it with `@font-face` and wait for `document.fonts.ready` before the first measurement.
2. **Math.** `math.ts` loads MathJax once, when the work page mounts, with the TeX input and SVG output components and `svg: { fontCache: "none" }` so every glyph is an inline path. Expose:
   ```ts
   async function mathToSvg(latex: string, sizePx: number): Promise<{ node: SVGSVGElement; w: number; h: number; glyphPaths: SVGPathElement[] }>
   ```
   Read the output's `viewBox` to compute the size at `sizePx` and set explicit `width`, `height`, `x`, `y` so it can be nested inside the page's SVG. Set its colour to `INK.albert`. Cache by `latex + size`.
3. **Text.** A text segment is an SVG `<text>` element in the handwriting font. `measure` for text uses `getComputedTextLength()` on a hidden element; for math it uses `mathToSvg`.
4. **Reveal.** `animate.ts`:
   ```ts
   function revealWipe(el: SVGGraphicsElement, ms: number): Promise<void>
   // clips the element with a rectangle whose width grows from 0 to the element's width
   ```
   Duration for text is `chars / charsPerSec`; for math it is `glyphs × mathGlyphMs`.
5. If MathJax fails on a formula, render the LaTeX source as plain text. Never drop the hint.

**As built (Nov 14).** Font: Kalam Regular (OFL) as `"Albert Hand"`, `@font-face` in `src/lib/ink/ink.css`; font loading and text measuring live in `font.ts` so `math.ts` can fall back to text without an import cycle. MathJax is `@mathjax/src` 4.1.3 imported on demand, and needs `linebreaks: { inline: false }`: v4 otherwise splits inline math into several `<svg>`s. `mathToSvg` also returns `fallback` and `baseline` (px from the top); `renderSegment` returns `baseline` too. Layout places items by their top edge, so P4.4 should align a line's math and text on their baselines. `prepareMeasure(segments)` typesets the math first so `layoutHint` stays synchronous. Formulas that need a MathJax font extension loaded at run time (rare symbols outside the base font) fall back to text, because no `asyncLoad` is configured for the browser.

**Acceptance**
- [ ] **P4.2-AC1** — Math renders as paths inside the page's SVG. *Verify:* `tests/e2e/ink-math.spec.ts` calls `mathToSvg("\\frac{dx}{d\\theta} = 4\\cos\\theta", 26)` through `window.__albert` and asserts at least 8 `path` elements and a width between 60 and 400.
- [ ] **P4.2-AC2** — Text is in the handwriting font, in red. *Verify:* the e2e test checks computed `font-family` and `fill`.
- [ ] **P4.2-AC3** — MathJax is ready before the first hint. *Verify:* the e2e test asserts `__albert.mathReady` is true within 3 seconds of page load.
- [ ] **P4.2-AC4** — Bad LaTeX degrades to text. *Verify:* unit or e2e test with `\frac{`.

---

### P4.3 — Marks

**Goal.** Circles, underlines, cross-outs and arrows that look drawn by hand and draw themselves.

**Build.**
1. Install `roughjs`. `marks.ts` creates shapes with `rough.svg(svgEl)`:
   - circle → `ellipse` with `roughness ≈ 1.6`, `strokeWidth 2.5`, no fill
   - underline → `line`, drawn twice with a slight offset by roughjs
   - cross-out → one diagonal `line` through the box
   - arrow → a `path` for the shaft from `arrowFor`, plus two short `line`s for the head
   Use `seed: hash(hintId)` so the same hint always draws the same wobble. That makes replay and screenshots stable.
2. `revealStroke(group, ms)`: for each `<path>` in the shape, set `stroke-dasharray` and `stroke-dashoffset` to its `getTotalLength()` and animate the offset to 0, the paths one after another, sharing `ms` in proportion to their lengths.
3. All marks go in a `<g class="albert">` layered above the student's ink, with `pointer-events: none` so the student can keep writing underneath.

**Acceptance**
- [ ] **P4.3-AC1** — A circle is placed over its target. *Verify:* `tests/e2e/ink-marks.spec.ts` replays `missing-dx.json`, triggers a mock hint, and asserts the circle group's bounding box contains the centre of the target clusters' box.
- [ ] **P4.3-AC2** — The same hint id draws the same shape twice. *Verify:* e2e test compares the two `d` attributes.
- [ ] **P4.3-AC3** — The arrow starts in Albert's column and ends within 12 px of the circle. *Verify:* e2e test on the path's end points.
- [ ] **P4.3-AC4** — It looks drawn. *Verify by hand:* the circle visibly traces around, the arrow shaft draws before its head.

---

### P4.4 — The conductor

**Goal.** Turn the live event stream into ink, in an order that feels like a person reacting.

**Build.**
1. `conductor.ts` consumes `HintEvent`s for one hint and keeps a queue of animations that run in sequence:

   | Event | What happens |
   |---|---|
   | `started` | The hint mark turns into a small pulsing red dot at the margin anchor (Albert is "looking") |
   | `reading` | Stored for the "Albert read…" tooltip (P4.6). Nothing is drawn |
   | `diagnosis` | If `deferredMethod` is present, queue a small grey note at the top of the margin: "You'll meet *partial fractions* in Unit 4." |
   | `mark` (circle, underline, cross-out) | Queue the shape on its clusters |
   | `mark` (arrow) | Queue the arrow from the margin anchor to its target |
   | `hint` | Lay it out, then queue each item's reveal in order, then the citation |
   | `done` | Remove the pulsing dot. Show the **More help** chip under the hint if the rung is below 3. Append a `hint_shown` session event with the drawn `AlbertMark`s |
   | `error` | Cancel the queue, remove every mark with this `hintId`, show the note from P3.8 |

   If the model sent no arrow but did send a circle, add an arrow automatically: a note in the margin should always point at what it is about.
2. **More help.** Tapping the chip requests the next rung for the same row. The earlier rung's writing fades to `fadedOpacity` and stays; the new one is laid out beneath it. The circle stays.
3. **Getting out of the way.** When the student writes new ink in the row a hint points at, that hint's marks fade to `fadedOpacity`. A "Clear Albert's notes" control on the problem removes them. A `correct` check fades all of that problem's marks.
4. **Interruptions.** If the student starts writing while an animation is running, finish it instantly (jump to the end state). Never make the student wait for Albert's pen.
5. **Reduced motion.** With `prefers-reduced-motion`, draw everything in its final state at once.
6. Wire the page: `onHintRequested` (from P2.6) → `buildHintRequest` → `useHint` → conductor.

**Acceptance**
- [ ] **P4.4-AC1** — **Gate G2, mock.** The full sequence plays from a mock stream. *Verify:* `tests/e2e/hint-ink.spec.ts` replays `missing-dx.json`, taps the mark, and asserts in order: a circle group, an arrow group, hint text containing "dx", a citation containing "Lecture 9", then the **More help** chip.
- [ ] **P4.4-AC2** — Rung 2 stacks under rung 1 and rung 1 fades. *Verify:* the same test taps **More help** and checks opacity and vertical order.
- [ ] **P4.4-AC3** — An error leaves no marks. *Verify:* e2e test with the error mock from P3.8.
- [ ] **P4.4-AC4** — New ink fades the hint. *Verify:* e2e test draws a synthetic stroke in the row and checks opacity.
- [ ] **P4.4-AC5** — Albert's ink never blocks the pen. *Verify:* e2e test draws a stroke through the circle's location and finds a new student stroke stored.
- [ ] **P4.4-AC6** — **Gate G2, live.** With the real model: write the missing-`dx` work by hand, tap the mark, and watch the circle land on the integrand and the question write itself, first ink within about three seconds. *Verify by hand,* three times in a row, and note the three times in `status.md`.
  *Note (Nov 14):* P3.6 streaming is deferred, so until it lands first ink arrives with the whole reply. Record the three times honestly; G2 passes on function, and the ~3 s target is re-checked after P3.6.

---

### P4.5 — Handwriting, level 1

**Cut (user, Nov 14).** Level 0 (the web font) plus circles and arrows is the demo.

**Goal.** The note looks written letter by letter instead of wiped in. **Time box: 90 minutes.** Stop when the time is up and keep level 0.

**Build.**
1. Load the same font file with `opentype.js`. For a text segment, get one path per glyph, positioned with the font's advance widths and kerning.
2. Give each glyph a small random baseline shift (±1 px) and rotation (±1.5°), seeded from the hint id, so the line is not mechanically straight.
3. Reveal glyphs one after another with a short wipe each (`1000 / charsPerSec` ms), with a slightly longer gap at each space.
4. Do the same for math using `glyphPaths` from `mathToSvg`: reveal each in document order.
5. Keep a single flag, `INK_LEVEL = 0 | 1`, so level 0 remains one line away.

**Acceptance**
- [ ] **P4.5-AC1** — Level 1 produces one path per visible character at the positions level 0 measured (within 3 px over a 20-character line). *Verify:* e2e test comparing total widths.
- [ ] **P4.5-AC2** — It reads as writing. *Verify by hand:* show two people a hint at level 0 and at level 1 without saying which is which. If neither prefers level 1, ship level 0.
- [ ] **P4.5-AC3** — Switching `INK_LEVEL` back to 0 still passes P4.4's tests.

**Stretch beyond this** (only in P8.7): true single-line pen strokes with a single-stroke font and stroke-reveal, so text draws the way the circle does.

---

### P4.6 — Finish

**Goal.** The small things that make it trustworthy and replayable.

**Build.**
1. **What Albert read.** Hovering or long-pressing a row number shows a small tooltip with that row typeset from the latest `reading` event, and its confidence. This is the answer to "how do I know it read my writing right?".
2. **Replay.** `hint_shown` events in a recording redraw their marks. At instant speed they appear in their final state; at 1× they animate.
3. **Narrow screens.** Under 900 CSS px wide, Albert's column moves below each row: the hint is laid out in a full-width band under the row and the arrow points up. (Layout variant of D4.)
4. **Print and export.** A "Save page" control downloads the SVG of the problem with both inks. Useful for the tutor report and for the write-up's screenshots.

**Acceptance**
- [ ] **P4.6-AC1** — The tooltip shows the reading. *Verify:* e2e test with the mock.
- [ ] **P4.6-AC2** — A recording with hints replays with its marks. *Verify:* record a session with one hint, add it as `fixtures/sessions/with-hint.json`, and test that replay shows the circle.
- [ ] **P4.6-AC3** — The narrow layout keeps everything on screen. *Verify:* e2e test at 800 px width: no element of the hint has `x + w` beyond the viewport.

---

## Phase exit — gate G2

```bash
pnpm verify      # layout, geometry
pnpm e2e         # math, marks, the full mock sequence, errors, fade, replay
```

- [ ] P4.4-AC6 done three times in a row with the real model.
- [ ] A screenshot of a live hint saved as `docs/tracks/img/hint-live.png` (used in the write-up).
- [ ] `status.md` records `INK_LEVEL` and the three first-ink times.
- [ ] From this point on, `main` always runs the demo.
