# Release plan — PDF tutor with course context

How to build [`current-scope.md`](./current-scope.md). That file says *what* this release is; this one says *how*, in the same
style as the phase files: subphases with files, contract changes, acceptance criteria and verify steps. `AGENTS.md` rules
apply unchanged (verified means run and seen, tests with the code, contract changes together, pure logic pure, no secrets).

**Starting point (main, Nov 14 23:00).** Canvas, rows/lines/clusters, stuck detection, snapshots and session sync (Phase 2);
the hint route with the validated reply, ladder rules, P3.8 failure handling and a 4-case eval (Phase 3); the ink conductor
with marks, layout, reading tooltip, replay, narrow band and SVG save (Phase 4); the GitHub source, import and course picker
(P5.1–P5.5); the course agent with tools, sub-agents and a 13/13 ingest whose last step builds a study plan (P6.1–P6.5);
evidence and levels (P7.1–P7.2). Not yet: the real worksheet page (P5.6), Learn this course, anything PDF.

| | |
|---|---|
| Replaces | G4 and the study-plan/report work (P6.7, P6.8, P7.3–P7.5): removed from this release, code kept |
| Gates | **R1** course context ready → **R2** write on the PDF → **R3** helper on the PDF → **R4** release proof (= old G5), then G6 |
| Live budget | 800 calls for the run; ~270 left at the start of this plan (see §Budget) |
| Time | 12–20 focused hours (current-scope.md estimate); a thin demo after R1 + R2.1–R2.4 + R3.1–R3.3 |

---

## R1 — Course context (context-only learning)

### R1.1 Context-only ingest

**Goal.** Learning a course produces validated cards, mapped worksheets and `/course/scope.md`, and never a study plan.

**Build.**
1. `src/lib/agent/agent.ts`: drop step 6 (planner) and the "first study plan" todo from `COURSE_AGENT_PROMPT`; the ingest
   ends after `/course/scope.md`. `subagents.ts`: `ingestSubagents()` returns unit-reader, worksheet-mapper, card-checker only;
   `planner` and `save_study_plan` stay exported for later but are not given to the ingest agent.
2. `functions/check-ingest.ts`: golden check 12 needs a todo list, ≥ 3 `subagent_start` events and the scope write (unchanged);
   check 13 becomes **context coverage**: every worksheet problem's `subskillIds`/`methodIds` resolve to a saved card, every
   taught card has `sourceFileIds` and at least one worked example with a lecture label, and **no** plan was saved by the run.
   Update the phase-6 golden table and `status.md` (the old check 13 is not claimed).
3. `scripts/agent-ingest.ts` unchanged apart from the checks.

**Acceptance**
- [ ] **R1.1-AC1** — Unit: the ingest agent's sub-agent list has no planner; check 13 passes on a stored ingest and fails when the
  run saved a plan (a plan from an earlier run is fine) or a problem tag is unresolved (`tests/unit/check-ingest-agent.test.ts`).
- [ ] **R1.1-AC2** — Live, one run: on the saved P6.5 state, a repeat ingest through the R1.2 route succeeds, golden checks
  1–13 (new 13) pass, card/worksheet ids and counts are unchanged, and `latestPlan` is unchanged. Record calls and time.

### R1.2 Learn this course

**Goal.** The button on `/courses` learns the course and shows progress in a compact panel.

**Build.**
1. `POST /api/agent/ingest` → `text/event-stream`, one `AgentEvent` per message; a run registry (`src/lib/agent/registry.ts`,
   pure map + injectable clock) attaches a second request to the running run. `GET /api/agent/runs/[runId]`.
   With `MOCK_LLM=1` the route replays `fixtures/agent/ingest-run.json` (a real stored run, tokens redacted) at 8× speed.
2. `src/components/source/LearnPanel.tsx` on `/courses`: idle → **Learn this course**; learning → todo progress
   (n of m), the latest event label, elapsed time; ready → "5 cards · 4 worksheets" and the worksheet list with **Open**
   links to `/work/[worksheetId]`; failed → the plain error and **Try again**, keeping the previous ready context visible.
3. Enable the disabled button in `CoursePicker.tsx`.

**Acceptance**
- [ ] **R1.2-AC1** — `curl -N -X POST …/api/agent/ingest` prints events over time (live; this is R1.1-AC2's run).
- [ ] **R1.2-AC2** — `tests/e2e/learn.spec.ts` (mock): idle → learning → ready, worksheet links open; a failing mock shows
  Try again and keeps the old ready list; a second click attaches instead of starting another run (also a registry unit test).
- [ ] **R1.2-AC3** — `fixtures/agent/ingest-run.json` parses as `AgentRun`.

### R1.3 The worksheet page (P5.6)

As written in phase-5 P5.6 (`/work/[worksheetId]` from `GET /api/worksheet/[worksheetId]`, typeset statements, deep link,
Original drawer, unit tag). It is the base the PDF surface builds on. P5.6-AC3 stays by hand.

**Gate R1.** By hand: import, Learn this course, open Worksheet 3 with ready context (replaces the old G3 check; the cited
hint part moves to R3).

---

## R2 — The PDF annotation surface (P5.8)

Contract changes in this phase go in one commit each, with schema, `contracts.md`, fixtures and the contract test.

### R2.1 Pages from the server

**Build.**
1. `GET /api/files/[fileId]/pages` → `[{ page, widthPt, heightPt }]`; `GET /api/files/[fileId]/page/[n]` → PNG rendered at
   2400 px (2×), then downsampled to AC2's explicit decoded width of 1200 px. It shares P6.1's `rasterizePdf` rendering
   path (single-page variant) and caches derived files by source id/content hash/version in the Repo. Only files already
   in the Repo; 404 otherwise.
2. Pure `regionsFromText(items, labels, pageSize)` in `src/lib/lms/regions.ts`: from pdfjs text items find each problem label
   ("1.", "1)", "Problem 1") at the left margin; a region runs from its label to the next label or the page end, in logical
   coordinates. **Contract:** optional `region: { page, bbox }` on `Worksheet.problems[]`, filled when the worksheet is served.
3. Normalize crop/rotation/y-flip before the pure region helper; cache normalized text geometry by source hash. Worksheet
   GET enriches validated responses without overwriting stored course knowledge. Bound native allocation before rendering
   (finite positive dimensions, at most 16384 px per dimension and 16000000 pixels); unsupported geometry is safe `bad_reply`.

**Acceptance**
- [x] **R2.1-AC1** — Unit: regions for the synthetic Worksheet 3 PDF give five problems on the right pages in label order;
  a page with no labels gives none (picker fallback).
- [x] **R2.1-AC2** — Route tests: page count and sizes match `pdf-lib`'s; the PNG decodes at 1200 px wide; unknown file 404.

**Evidence (Nov 15).** `35fc43d` contains the flagged contract/schema/fixture/test update; `0e6c4ef` adds bounded rendering
and worksheet integration; `a4962b2` preserves P5.6's published worksheet response contract. Unit/route coverage includes
the synthetic PDF, no-label fallback, cache replacement, crop/rotation and oversized allocation rejection. Real Next tests
decode both PNGs and assert all five served regions. Combined R1.1/R1.2/P5.6 main verify: 61 files, 852 passed / 16 skipped; three completed pre-Learn-integration
local full browser suites each 114 passed / 6 skipped; build passed; production PDF/replay 3 passed and production gating
5 passed. Independent follow-up review found no blocking issue. Live model calls: 0. Final combined-main browser/build/production and CI evidence is recorded in the PR;
R2.2 onward and every human gate remain open.

### R2.2 Writing on the pages

**Build.**
1. `?surface=pdf` (the default for worksheets that have a `fileId`; explicit `?surface=ruled|free` and legacy `?layout=` opt out; `ruled`/`free` stay for the demo
   worksheet and replays). One `WorkSurface` per PDF page, stacked; the page PNG is an `<image>` under the ink; logical width
   `PAGE.width` (1200), height `1200 × heightPt / widthPt`; free-layout line inference within each page.
2. **Contract:** optional `page?: number` on `Stroke` and `Row`; `SessionRecording.surface?: "pdf"` plus `fileId`.
   A stroke's `problemId` is the page region holding most of its ink length (not sample count), else the active problem from that page's picker. Row/stroke ids and page identity survive recording export and replay.
3. A compact problem picker above each page ("Problem 1 2 3 4 5") shows the active problem and overrides it.
4. Albert's column: none on PDF pages (D4 page-mode variant). The entire page, including its right edge, accepts ink and erasing. Tutor notes use the below-page band (P4.6) at every viewport width.
5. Pen, eraser, undo and redo use the active page. Erasing ignores the selected problem and finds every problem's intersected ink on that page. Undo/redo preserve the other pages' stacks.
6. Snapshots include a light-grey problem crop from the page PNG in the visible surface's logical coordinates; line inference and snapshot rows stay within each page. Marks resolve through live target rows; empty/erased/foreign rows draw nothing.

**Acceptance**
- [x] **R2.2-AC1** — `tests/e2e/pdf-surface.spec.ts`: on Worksheet 3, synthetic strokes on pages 1 and 2 carry the right page
  and problem; erase and undo work per page; geometry is identical at two viewport widths and after browser zoom.
- [x] **R2.2-AC2** — Snapshots on PDF pages draw the problem's page crop in light grey under the ink (P2.7 renderer takes a
  background image); unit test on the plan, e2e decodes the PNG.

### R2.3 Save and reload

**Build.**
1. **Contract:** `Repo.listEvents(sessionId)` in the interface and both implementations (today memory-only and outside the
   contract); `GET /api/session/latest?worksheetId=` → the latest open session's events.
2. Opening a PDF worksheet replays its latest session instantly, then keeps syncing (P2.8) into the same session.

**Acceptance**
- [ ] **R2.3-AC1** — e2e: write on two pages, reload, the same strokes (ids and points) are back on the same pages.
- [ ] **R2.3-AC2** — Unit/live Mongo test of `listEvents` order (skipped offline like the other live Mongo tests).

### R2.4 Annotated PDF download

**Build.** `src/lib/ink/pdf-export.ts` in the browser: `pdf-lib` copies the original bytes, then per page draws student
strokes (perfect-freehand outlines as SVG paths, logical → PDF points, y flipped) and Albert's marks (rough paths) and
writing (embedded Kalam via `@pdf-lib/fontkit` — new dependency, reason: custom font embedding; math as MathJax glyph paths).
The library is pure (bytes in, bytes out; fonts passed in as `fontBytes`; math as pre-rendered glyph path data, so MathJax stays out of it; `pageTransform` handles CropBox/MediaBox origins and /Rotate). **Save PDF** (the canvas lane) calls it and downloads `<worksheet title> — annotated.pdf`.

**Acceptance**
- [ ] **R2.4-AC1** — Unit: page count and sizes unchanged; each inked page's content stream grew; a stroke's outline lands at
  the expected PDF coordinates.
- [ ] **R2.4-AC2** — By hand: open the download in an independent viewer, inspect several pages (human-queue R4).

**Gate R2.** By hand on the demo device: write, erase, undo on two pages, zoom, reload, download, open the PDF.

---

## R3 — The page helper

### R3.1 Questions in the request

**Build.** **Contract:** `HintRequest.question?: string` (≤ 200 chars, plain text) and `HintTurn.question?`; the PDF crop
travels as the snapshot background (R2.2-AC2), not a new field. `prompt.ts`: a question is student data, never instructions;
answer it at the requested rung under the same ladder and scope rules; a follow-up uses history. Mock fixtures for a question
(`fixtures/llm/*-question.json`); two eval cases from the `missing-dx.json` recording (its `missing-dx-r1` snapshot request) with questions ("what did I do wrong?" at rung 1, and a
follow-up).

**Acceptance**
- [ ] **R3.1-AC1** — Contract + unit: schema, fixtures, prompt contains the question as data; an over-long question is 400.
- [ ] **R3.1-AC2** — Live: `pnpm eval:hints` on the 6 cases meets the P3.4 bars as decided (no-answer and scope 100%).

### R3.2 Ask Albert

**Build.** A short text field on the active problem ("Ask Albert…", Enter sends) next to **I'm stuck**; a new request cancels
the one in flight (existing runner); the helper's reply is drawn like a hint. Writing new ink after a reply sets
`studentWroteAfter` as today.

**Acceptance**
- [ ] **R3.2-AC1** — e2e (mock): ask, see the reply drawn; ask again mid-stream, the first is cancelled and never drawn; a
  failing mock leaves ink and saved work usable.

### R3.3 Notes in the page's white space

**deferred (user, Nov 15): notes use the below-page band**. The following free-space design is retained for a later release, not required or claimed by R2.2.

**Build.** Pure `findFreeSpace(grid, size, anchor)` (`src/lib/ink/free-space.ts`): an 8-px occupancy grid from the page PNG's
non-white pixels (sampled once per page), student ink boxes and earlier notes, padded 12 px; nearest fully free rectangle
right of the stuck line, then below, left, above, inside the problem region, then the page; else the below-page band (P4.6).
The conductor takes a placement strategy: `column` (ruled/free) or `freeSpace` (PDF). The arrow runs from the note to the mark.

**Acceptance**
- [ ] **R3.3-AC1** — `tests/unit/free-space.test.ts`: crowded page, empty page, nothing fits → band.
- [ ] **R3.3-AC2** — e2e: the drawn note's box overlaps no non-white page pixel and no student ink box.

### R3.4 The pointer

**Build.** Before the first mark, a small red pen tip moves from its last position to the target cluster's centre (300 ms),
then the circle draws; reduced motion skips it. Conductor step only; no Pixie code is imported.

**Acceptance**
- [ ] **R3.4-AC1** — e2e (mock): the pointer element reaches within 12 px of the target centre before the circle group exists.

**Gate R3.** Live, by hand: on the Worksheet 3 PDF, write the missing-dx work, tap **I'm stuck**, see the right cluster
circled with a Lecture 9 citation and no answer; ask a follow-up. Needs a new real recording in PDF mode
(`missing-dx-pdf.json`) for the automated replay.

---

## R4 — Proof and hardening (old G5)

1. `tests/e2e/release.spec.ts`: Learn (mock) → open Worksheet 3 PDF → replay `missing-dx-pdf.json` → hint → follow-up → save
   PDF → reload; plus the failure paths (model error, cancel, no free space).
2. Phase 2 exit and the human queue's remaining handwriting checks; P8.4 device and pre-flight list; latency tuning
   (P3.5 Haiku comparison, P3.6 streaming) only after correctness.
3. The live demo three times (human), recorded in status.md; then P8.5, P8.6, P8.8 (G6).

---

## Order, lanes and files

| Wave | Work | Who | Owns |
|---|---|---|---|
| A | R1.1, R1.2 | course lane | `src/lib/agent/**`, `/api/agent/**`, `src/components/source/**` |
| A | R1.3 (P5.6), then R2.1 | page lane | `src/app/work/**`, `/api/worksheet/**`, `/api/files/**`, `src/lib/lms/regions.ts` |
| B | R2.2, R2.3, then R2.4 | ink lane | `WorksheetCanvas`, `WorkSurface`, `ProblemBlock`, `src/lib/canvas/**`, `src/lib/ink/pdf-export.ts` |
| C | R3.1 | lead | contracts, `src/lib/tutor/prompt.ts`, fixtures, eval cases |
| C | R3.2, R3.3, R3.4 | ink lane | `src/lib/ink/**`, work components |
| D | R4 | lead + people | tests, status, human queue |

Only one lane edits `WorksheetCanvas.tsx` at a time (the ink lane from wave B on). Wave B starts when R1.3 merges; wave C's
UI starts when R2.2 merges. Each subphase is its own PR under policy A.

## Budget

~270 calls left of 800: R1.1-AC2 repeat ingest through the route ≈ 80; R3.1 eval with questions (6 cases × 3 runs) ≈ 60;
live checks while building ≈ 30; reserve ≈ 100 for fixes and the human gates' live runs. Stop and ask before 800.

## Risks

- **PDF coordinates and export** (y flip, page scale, rotation): unit-test the transform on a real page before the UI.
- **Crowded pages**: free-space search may find nothing near the work → band below the page is the tested fallback.
- **Handwriting over print**: the snapshot's grey page crop may confuse reading; R3.1's eval compares with and without it
  (fallback: ink-only snapshot plus `statementLatex`).
- **Latency**: about 5 s per hint, about 10 s with a repair; streaming (P3.6) is a follow-up, not a claim.
- **Recordings**: R3's automated replay needs `missing-dx-pdf.json` from a person.
