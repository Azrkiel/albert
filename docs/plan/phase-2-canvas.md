# Phase 2 — Canvas

**Purpose.** The page the student writes on, and everything the browser knows about that writing: strokes with timing, which row and symbol each stroke belongs to, when the student is stuck, and a picture of the work to send for a hint. This phase is the *stroke-aware* half of Albert.

**Done looks like.** You can solve a problem by hand, erase and undo, see a "Need a hint?" mark appear when you stall, export the session to a file, and replay that file later with the same result. Six recorded sessions are checked in.

| | |
|---|---|
| Depends on | Phase 1 |
| Unblocks | Phase 3 (live input), Phase 4 (somewhere to draw), every replay test |
| Time box | 6 hours (gate **G1** at T+8h, together with P3.1) |
| Lane | A — Page |

Read first: [`contracts.md`](./contracts.md) §1 to §4.1, [`decisions.md`](./decisions.md) D2, D4, D5, D12.

**Module layout.** Everything here lives in `src/lib/canvas/` and is plain TypeScript with no React, except the components in `src/components/work/`. Pure functions are separate from the code that touches the DOM, so they can be unit tested:

```
src/lib/canvas/
  capture.ts      # pointer events → Stroke            (DOM)
  rows.ts         # assignRow, ensureRows              (pure)
  clusters.ts     # clusterRow                         (pure)
  stuck.ts        # detectStuck                        (pure)
  snapshot.ts     # renderSnapshot                     (DOM: offscreen canvas)
  recording.ts    # exportRecording, Replayer          (pure + timers)
  store.ts        # the session state container
```

---

### P2.1 — Work surface and stroke capture

**Goal.** Ink appears under the pen with no lag, and every stroke is stored with timed points.

**Build.**
1. `WorkSurface` component: an `<svg>` with `viewBox="0 0 1200 H"` scaled to the container width, so all coordinates are in the logical space from `PAGE`. `touch-action: none` on the surface so the browser does not scroll or zoom while writing.
2. `capture.ts`: on `pointerdown`, call `setPointerCapture` and start a stroke. On `pointermove`, read `getCoalescedEvents()` when available so fast strokes keep all their points. Convert client coordinates to logical coordinates with the SVG's screen matrix. On `pointerup` or `pointercancel`, finish the stroke.
3. Each point is `{x, y, t, p}`: `t` from `performance.now()` minus the session start, `p` from `event.pressure`, or 0.5 when the pointer is a mouse or reports zero.
4. Palm rejection: once a `pen` pointer has been seen in the session, ignore `touch` pointers for writing.
5. Draw with `perfect-freehand`: turn the points into an outline polygon and render it as a filled `<path>`. Draw the in-progress stroke on every animation frame. Finished strokes are static paths keyed by id.
6. Strokes outside the student column are allowed while drawing but are clipped to it on finish; a stroke that starts in Albert's column is discarded.

**Acceptance**
- [ ] **P2.1-AC1** — A stroke is stored with points whose `t` increases and whose coordinates are logical. *Verify:* `tests/unit/capture.test.ts` feeds synthetic pointer events through the pure point-conversion function and checks the output.
- [ ] **P2.1-AC2** — Writing feels immediate with mouse, finger and stylus. *Verify by hand:* write "∫ x dx" quickly with each available device. No visible gap between pen and ink, and no straight-line corners on fast curves.
- [ ] **P2.1-AC3** — The page does not scroll or zoom while writing on a touch screen. *Verify by hand* on a touch device or with Chrome's device emulation.
- [ ] **P2.1-AC4** — Resizing the window does not move existing ink relative to the rows. *Verify by hand.*

---

### P2.2 — Problems and rows

**Goal.** Each problem has a statement and ruled rows, and every stroke knows its row.

**Build.**
1. `ProblemBlock` component: the problem label and statement at the top (plain text for now; Phase 5 typesets it), then ruled rows of `PAGE.rowHeight` in the student column, with a faint rule under each and a faint row number at the left edge. Albert's column is visibly separate: a slightly different paper tone and a thin vertical rule.
2. Start each problem with four rows. When ink lands in the last row, append one more.
3. `rows.ts`:
   ```ts
   function assignRow(stroke: Stroke, rows: Row[]): string        // rule in contracts.md §2
   function ensureRows(rows: Row[], strokes: Stroke[]): Row[]     // appends when the last row has ink
   ```
4. On stroke end, set `stroke.rowId` and `stroke.problemId`.

**Acceptance**
- [ ] **P2.2-AC1** — Row assignment follows the rule. *Verify:* `tests/unit/rows.test.ts` covers a stroke fully inside a row, a stroke straddling two rows 70/30, an exact tie (first point decides), and a tall stroke such as an integral sign spanning three rows.
- [ ] **P2.2-AC2** — Rows grow as needed. *Verify:* unit test for `ensureRows`; by hand, write in the fourth row and see a fifth appear.
- [ ] **P2.2-AC3** — Two problems on one page keep their strokes separate. *Verify:* unit test asserting `problemId` on strokes written in each block.

---

### P2.3 — Record and replay

**Goal.** Any session can be saved to a file and played back exactly. This comes before erasing and detection on purpose: it is how everything after it gets tested.

**Build.**
1. `SessionRecording` is defined in `contracts.md` §14.
2. `recording.ts`:
   ```ts
   function exportRecording(state: SessionState, name: string): SessionRecording
   class Replayer {
     constructor(rec: SessionRecording, sink: (e: SessionEvent) => void, opts?: { speed?: number })
     play(): Promise<void>       // emits events at their original times ÷ speed
     seek(ms: number): void      // emits everything up to ms at once
   }
   ```
   Replay feeds the same store that live capture feeds. The page cannot tell the difference.
3. A small dev toolbar on the work page, shown only when `?dev=1`: **Export** (downloads the JSON), **Load** (file picker), speed 1× / 4× / instant.
4. URL parameter `?replay=<name>` loads `fixtures/sessions/<name>.json` through a dev-only route and plays it. `&speed=instant` seeks to the end.
5. Expose `window.__albert = { state, replayDone }` in dev and test builds so Playwright can wait for replay to finish and inspect state.

**Acceptance**
- [ ] **P2.3-AC1** — Export then replay reproduces the same strokes. *Verify:* `tests/unit/recording.test.ts` exports a synthetic state, replays it instantly into a fresh store, and deep-compares the strokes.
- [ ] **P2.3-AC2** — Replay keeps timing. *Verify:* unit test with fake timers: at 4× speed an event recorded at 8000 ms arrives at 2000 ms.
- [ ] **P2.3-AC3** — A fixture replays in the real page. *Verify:* `tests/e2e/replay.spec.ts` opens `/work/demo?replay=sample&speed=instant`, waits for `__albert.replayDone`, and counts the expected number of stroke paths in the DOM.
- [ ] **P2.3-AC4** — `fixtures/sessions/sample.json` exists and passes the contract test.

---

### P2.4 — Erase and undo

**Goal.** The student can fix mistakes, and Albert can see that they did.

**Build.**
1. An eraser tool: dragging across a stroke marks the whole stroke erased (`erasedAt`), and emits one `erase` event listing the stroke ids and the row. A stylus's eraser end (`event.buttons` eraser bit) switches to it automatically.
2. Undo and redo buttons and `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`. Undo of a stroke emits an `undo` event. Strokes are never removed from state; erased ones are simply not drawn. Their timing is evidence.
3. A "Clear row" action on each row's number, which erases that row's strokes as one `erase` event.

**Acceptance**
- [ ] **P2.4-AC1** — Erasing sets `erasedAt` and emits one event with the right ids and row. *Verify:* `tests/unit/erase.test.ts`.
- [ ] **P2.4-AC2** — Undo then redo restores the stroke with the same id. *Verify:* unit test.
- [ ] **P2.4-AC3** — Erased strokes survive export and replay as erased. *Verify:* unit test using the recorder.

---

### P2.5 — Clusters

**Goal.** Group a row's strokes into numbered symbols so that Albert can point at one.

**Build.**
1. `clusters.ts`:
   ```ts
   function clusterRow(strokes: Stroke[], rowId: string): Cluster[]   // rule in contracts.md §2
   ```
   Ignore erased strokes and eraser strokes. Number clusters left to right from 1.
2. Recompute a row's clusters whenever its strokes change. Keep them in the store.
3. Dev overlay (only with `?dev=1`): draw each cluster's box and number on screen. This overlay is how you tune `STUCK.CLUSTER_GAP` against real handwriting.

**Acceptance**
- [ ] **P2.5-AC1** — Known layouts cluster as expected. *Verify:* `tests/unit/clusters.test.ts` with synthetic boxes: three well-separated symbols give three clusters; a fraction (bar with ink above and below) gives one; an equals sign (two parallel short strokes) gives one; an `i` with its dot gives one; two symbols 10 px apart give one and 40 px apart give two.
- [ ] **P2.5-AC2** — Labels are stable left to right and restart per row. *Verify:* unit test.
- [ ] **P2.5-AC3** — On real handwriting the clusters are usable. *Verify by hand:* with the dev overlay on, write `∫ dx / (x²√(16 − x²))` and `x = 4 sin θ` on separate rows. Each term a tutor might want to circle (the integral sign, `dx`, the denominator, `4 sin θ`) is one cluster or a run of adjacent clusters. Adjust `CLUSTER_GAP` if not, and record the final value in `contracts.md`.

**Note.** Clusters do not need to be perfect symbols. Albert can name several adjacent clusters, and a circle around two of them reads fine. What matters is that boundaries fall in sensible gaps.

---

### P2.6 — Stuck detection

**Goal.** Notice when the student is stuck, from the event stream alone, and offer help without interrupting.

**Build.**
1. `stuck.ts`:
   ```ts
   function detectStuck(events: SessionEvent[], now: number, rows: Row[], clusters: Cluster[]): StuckSignal | null
   ```
   Pure, no timers, constants from `STUCK`. Implement the four signals:
   - **pause** — the current problem has ink, the last stroke ended more than `threshold` ago, where `threshold = clamp(PAUSE_FACTOR × median gap between consecutive strokes in this session, PAUSE_MIN_MS, PAUSE_MAX_MS)`. With fewer than five strokes so far, use `PAUSE_MAX_MS`. The row is the last row with ink.
   - **erase_loop** — `ERASE_LOOP_COUNT` or more `erase` or `undo` events on one row within `ERASE_LOOP_WINDOW_MS`.
   - **cross_out** — a pen stroke that covers at least `CROSS_OUT_COVERAGE` of the area of existing clusters in its row and whose path length divided by its bounding-box diagonal is at least `CROSS_OUT_MIN_LENGTH_RATIO`. Tag that stroke so clustering and snapshots treat it as a cross-out, not as a symbol.
   - **manual** — never returned by the detector; the "I'm stuck" button creates it directly.
   - **Re-arm** — after a signal for a row, return nothing more for that row until a new pen stroke lands in the problem.
   - A problem whose latest `check_result` is `correct` never signals.
2. The page calls `detectStuck` after each event and on a one-second interval. On a signal it appends a `stuck` event and shows the **hint mark**: a small round "?" with the words "Need a hint?" in Albert's column at the row's height. It fades in, does not move the layout, and makes no sound.
3. Tapping the mark, or the always-present **I'm stuck** button under the problem, raises `onHintRequested({ rowId, rung: 1, trigger })`. Phase 3 and 4 consume that. For now it logs.
4. `AUTO_HINT=1` (read from a public env flag or `?auto=1`): a `pause` signal raises `onHintRequested` itself after the mark has been visible for 1.5 seconds.
5. Writing new ink removes an untapped mark.

**Acceptance**
- [ ] **P2.6-AC1** — Each signal fires when it should and not when it should not. *Verify:* `tests/unit/stuck.test.ts` builds event lists by hand for: a pause just under and just over the threshold; a fast writer (median gap 400 ms → threshold is the 8 s floor) and a slow one (median 6 s → threshold 15 s); two erases in 30 s (fires) and in 60 s (does not); a scribble over 80% of a row (fires) and a short underline (does not); a solved problem (never fires).
- [ ] **P2.6-AC2** — One signal per row until new ink. *Verify:* unit test: after a pause signal, calling again 30 s later returns null; after one new stroke and another pause it fires again.
- [ ] **P2.6-AC3** — The mark appears in the right place and goes away on new ink. *Verify:* `tests/e2e/stuck.spec.ts` replays `fixtures/sessions/pause-row2.json` and asserts the mark is visible, and that its vertical centre is within 20 logical px of row 2's centre.
- [ ] **P2.6-AC4** — It is not annoying. *Verify by hand:* two people each solve a real problem with thinking pauses. Neither reports the mark as distracting. If they do, raise `PAUSE_MIN_MS` and record the value.

**Fallback.** If cross-out and erase-loop detection are not solid by the time box, ship pause and manual only (cut list, main plan §5.3). The two unit-tested signals that work are worth more than four that misfire.

---

### P2.7 — Snapshots

**Goal.** A picture of the work that a model can read, with the cluster numbers drawn on it.

**Build.**
1. `snapshot.ts`:
   ```ts
   async function renderSnapshot(args: {
     strokes: Stroke[]; rows: Row[]; clusters: Cluster[];
     problemId: string; upToRowId: string; marked: boolean;
   }): Promise<{ png: string; width: number; height: number;
                 rows: Array<{ rowId: string; index: number; clusterLabels: number[] }> }>
   ```
   Follow the rendering rules in `contracts.md` §4.1. Draw on an `OffscreenCanvas` (fall back to a detached `<canvas>`). Use the same `perfect-freehand` outlines as the screen so the model sees what the student sees. Crossed-out strokes are drawn; erased ones are not.
2. In the marked image: `R1`, `R2`, … at the left of each row in grey, and each cluster's number centred above its box in `INK.clusterLabel`. Nudge a number sideways if it would overlap its neighbour's.
3. Do not include Albert's ink in snapshots.
4. Dev toolbar: **Snapshot** opens the marked image in a new tab.
5. `buildHintRequest(state, rowId, rung, trigger)` assembles a full `HintRequest` including `history` from earlier `hint_shown` events on this problem.

**Acceptance**
- [ ] **P2.7-AC1** — The image has the right bounds and size. *Verify:* `tests/e2e/snapshot.spec.ts` replays a fixture, calls `renderSnapshot` through `window.__albert`, and asserts the longer side is ≤ 1400 px, the image is not blank (more than 0.5% non-white pixels), and the returned `rows` list matches the store's clusters.
- [ ] **P2.7-AC2** — Rows after the stuck row are not included. *Verify:* same test with `upToRowId` set to row 2 of a three-row fixture: the image height is smaller than for row 3.
- [ ] **P2.7-AC3** — A person can read the numbers. *Verify by hand:* open a marked snapshot of real handwriting. Every number is legible and clearly belongs to one cluster.
- [ ] **P2.7-AC4** — A model can read the numbers. *Verify:* `pnpm smoke --snapshot fixtures/eval/marked-sample.png` asks the model "Which cluster number is above the term dx in row R2?" and gets the known answer. (Uses `pingVision` from P1.4 with a different image and question.)
- [ ] **P2.7-AC5** — `buildHintRequest` output parses as `HintRequest`. *Verify:* unit test.

---

### P2.8 — Session sync

**Goal.** What the student writes is saved, so hints can be tied to sessions and progress can be computed later.

**Build.**
1. On opening a worksheet, `POST /api/session` and keep the `sessionId`.
2. Buffer `SessionEvent`s and `POST /api/session/[id]/events` every 3 seconds and on `visibilitychange`, using `navigator.sendBeacon` for the final flush. Never block drawing on the network; if a post fails, keep the batch and retry with the next one.
3. Routes store events through `repo.appendEvents`. `POST /api/session/[id]/end` marks the session ended. (Phase 7 adds evidence and re-planning to this route.)
4. An **End session** button on the work page.

**Acceptance**
- [ ] **P2.8-AC1** — Events reach the store in order. *Verify:* `tests/e2e/session.spec.ts` (with `STORE=memory`) replays a fixture, waits for a flush, and reads the events back through a dev-only route; the count and order match.
- [ ] **P2.8-AC2** — A failed post loses nothing. *Verify:* unit test of the buffer with a mock transport that fails once.
- [ ] **P2.8-AC3** — Drawing is unaffected by a slow network. *Verify by hand:* throttle the network to "Slow 3G" in dev tools and write. Ink stays immediate.

---

## Recordings to check in

Record these on the real canvas with the dev toolbar and save them in `fixtures/sessions/`. They are the test data for Phases 3, 4, 7 and 8. Use the demo problem from Phase 5: `∫ dx / (x²√(16 − x²))`. Write neatly, one step per row.

| File | What is written | Used for |
|---|---|---|
| `sample.json` | Any three rows | Replay smoke test |
| `pause-row2.json` | Row 1: the integral. Row 2: `x = 4 sin θ`. Then 15 s of nothing | Pause detection, hint placement |
| `missing-dx.json` | Rows 1–2 as above. Row 3: the integral rewritten in θ **without** replacing `dx`. Then a pause | The main demo and eval case |
| `erase-loop.json` | Row 3 written, erased, rewritten, erased | Erase-loop detection |
| `cross-out.json` | Row 3 written then scribbled out | Cross-out detection |
| `correct-full.json` | The whole problem solved correctly | Check route, `on_track`, unaided evidence |
| `partial-fractions-urge.json` | `∫ dx / (x² − 9)`, row 1 only, then a pause | The out-of-scope case |

---

## Phase exit

```bash
pnpm verify      # rows, clusters, stuck, recording, erase unit tests
pnpm e2e         # replay, stuck mark, snapshot, session sync
```

- [ ] All seven recordings exist and pass the contract test.
- [ ] By hand: solve the demo problem start to finish with the demo device. Stall once and see the mark. Export, reload the page, load the export, and see the same page.
- [ ] `status.md` records the final `CLUSTER_GAP` and `PAUSE_MIN_MS` values.
