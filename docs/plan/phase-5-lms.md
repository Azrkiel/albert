# Phase 5 — Course sources

**Purpose.** Import a configured GitHub course manifest at one immutable commit, cache the original PDFs and normalized outline, and support a later manual upload fallback and worksheet page.

**Done looks like.** Import the configured public course repository, see its actual title and units, and open originals from the Repo cache without GitHub access. Source import does not build teaching cards or mark ingestion complete.

| | |
|---|---|
| Depends on | Phase 1 |
| Unblocks | Phase 6 (something to read), Phase 7 (due dates for the plan) |
| Time box | 5 hours, in parallel with Phases 2 to 4 (ready by T+16h) |
| Lane | C — Course |

Read first: [`contracts.md`](./contracts.md) §6, §10, §11, [`decisions.md`](./decisions.md) D9, D10, D14.

```
seed/calc2/                 # the course content, as markdown with LaTeX
src/lib/lms/
  adapter.ts                # CourseSourceAdapter, CourseSourceError
  github.ts                 # GitHubAdapter, explicit snapshot import
  upload.ts                 # UploadAdapter
  classify.ts               # file name → kind guess          (pure)
  index.ts                  # getAdapter(connection)
fixtures/github/            # synthetic transport fixtures + separate live manifest/PDF recording
```

---

### P5.1 — The seed course

**Goal.** Course material that is ours, is realistic, and has a recognisable teaching style, so that "the way your teacher taught it" can be seen and tested.

The teacher in this course has habits a generic tutor would not know. Those habits are the **marker facts**: later phases assert that Albert picked them up.

**The course: Calculus II (`CALC2`)**

| Unit | Title | Lectures | Worksheet | State in the demo |
|---|---|---|---|---|
| 1 | Integration by Parts | 5, 6 | Worksheet 1 | Covered |
| 2 | Trigonometric Integrals | 7, 8 | Worksheet 2 | Covered |
| 3 | Trigonometric Substitution | 9, 10 | Worksheet 3, due four days after the demo | **Current** |
| 4 | Partial Fractions | 11, 12 | Worksheet 4, due eleven days after | Upcoming: listed in the syllabus, notes not posted |
| 5 | Improper Integrals | 13 | — | Upcoming: syllabus only |

**Marker facts** (write the notes so each of these is plainly there)

| Id | Fact | Where |
|---|---|---|
| M1 | Derivatives are written in Leibniz form, `dy/dx`. The notes never use `f'(x)` | All units |
| M2 | For integration by parts the teacher chooses `u` with the word **LIATE** and writes the rule as `∫u dv = uv − ∫v du`. The tabular method is not taught | Unit 1 |
| M3 | Trig substitution is taught as **"the five-step recipe"**: 1 choose the substitution from the table · 2 find `dx` · 3 substitute and simplify with a Pythagorean identity · 4 integrate in `θ` · 5 draw the reference triangle and convert back to `x` | Lecture 9 |
| M4 | The substitution table: `√(a² − x²)` → `x = a sin θ`; `√(a² + x²)` → `x = a tan θ`; `√(x² − a²)` → `x = a sec θ` | Lecture 9 |
| M5 | The angle is always `θ`. The teacher always draws the reference triangle to convert back and does not use inverse-trig identities for that step | Lectures 9, 10 |
| M6 | **Lecture 9, Example 2** is `∫ dx / (x²√(9 − x²))`, worked through all five steps, with "Step 2: find dx" on its own line | Lecture 9 |
| M7 | Lecture 10 covers the `tan` and `sec` cases. **Lecture 10, Example 2** uses `x = 3 sec θ` | Lecture 10 |
| M8 | Partial fractions is named in the syllabus under Unit 4 and appears nowhere in Units 1 to 3 | Syllabus |

**Worksheet 3** (five problems). The first and fourth drive the demo.

| # | Problem | Why it is there |
|---|---|---|
| 1 | `∫ dx / (x²√(16 − x²))` | The main demo. Same shape as Lecture 9, Example 2. Answer: `−√(16 − x²) / (16x) + C` |
| 2 | `∫ √(25 − x²) dx` | Needs a Unit 2 identity inside a Unit 3 problem |
| 3 | `∫ dx / (x² + 9)^{3/2}` | The `tan` case |
| 4 | `∫ dx / (x² − 9)`, for `x > 3` | The scope demo. In scope with `x = 3 sec θ`; quicker with partial fractions, which is Unit 4. Answer: `(1/6) ln\|(x − 3)/(x + 3)\| + C` |
| 5 | `∫ x³ / √(x² + 4) dx` | A longer one for the study plan to assign |

**Build.**
1. Write the content as markdown with LaTeX under `seed/calc2/`: `syllabus.md`, `unit-1/lecture-05.md` … `unit-3/lecture-10.md`, and `unit-1/worksheet-1.md` … `unit-4/worksheet-4.md`. Write it in your own words; do not copy a textbook. Two to three pages per lecture is plenty. Lectures 9 and 10 need the most care.
2. Write `seed/calc2/answers.md` with a final answer for every worksheet problem. This file is never included in a course-source manifest; it is used to check the eval cases.
3. `scripts/seed-pdf.ts` (`pnpm seed:pdf`): render each markdown file to HTML with MathJax, and print it to PDF with Playwright into `seed/calc2/pdf/`. Keep every PDF under 4 MB and under 10 pages.
4. `seed/calc2/manifest.json`: for each PDF its unit order, kind, title, and for worksheets the due date as an offset in days from "demo day", so the dates can be regenerated.

**Acceptance**
- [ ] **P5.1-AC1** — All PDFs build. *Verify:* `pnpm seed:pdf` exits 0 and `seed/calc2/pdf/` contains the syllabus, six lectures and four worksheets.
- [ ] **P5.1-AC2** — Every marker fact is present. *Verify:* `tests/unit/seed.test.ts` greps the markdown sources: "LIATE" in unit 1; "five-step recipe" and "Step 2" in lecture 9; `\theta` and "reference triangle" in lectures 9 and 10; "Partial Fractions" in the syllabus and **not** in units 1 to 3; no `f'(x)` anywhere.
- [ ] **P5.1-AC3** — The answers are right. *Verify:* someone differentiates the answers to Worksheet 3 problems 1 and 4 by hand, or checks every answer in `answers.md` with a computer algebra system, and initials `status.md`.
- [ ] **P5.1-AC4** — The PDFs read well. *Verify by hand:* open Lecture 9. The math is typeset, and Example 2 shows five labelled steps.

---

### P5.2 — The GitHub course manifest

**Goal.** An explicitly mapped, reviewable manifest in `Azrkiel/albert-files`, plus offline recordings. The real course and P5.1 synthetic course are separate sources; marker facts belong only to the synthetic course.

**Build.**
1. Inspect the real repository and PDFs; propose root `manifest.json` using `CourseManifestSchema` and existing PDF paths. Preserve PDFs. Obtain course-owner confirmation of subset, teaching order, lecture labels and worksheet links before treating it as authoritative. Omit unknown dates and syllabus. Do not derive teaching order from filenames alone or invent marker facts.
2. Prepare a review branch/diff in the content repository. Do not merge either main. Publication and live-import evidence remain pending until that manifest is published and pinned.
3. Record synthetic and live manifests separately. Synthetic transport-only PDFs are explicitly labelled placeholders until the P5.1 owner provides verified manifest/PDF artifacts; never create a competing seed course. Record all selected PDFs at one SHA, including paths with spaces. Never include evaluation answers.
4. Persist demo day (`YYYY-MM-DD`) for reproducible due offsets; dates are 23:59:59 UTC.

**Acceptance**
- [x] **P5.2-AC1** — Synthetic and live manifests validate separately. Synthetic counts: five units, six lectures, four worksheet assignments, one syllabus. P5.1 verified artifact integration remains required.
- [x] **P5.2-AC2** — Every selected live PDF downloads at the pinned SHA, including paths with spaces.
- [x] **P5.2-AC3** — Identical SHA/demo-day imports produce identical outlines and dates.
- [x] **P5.2-AC4** — Recorded imports run without networking or credentials and exclude answer files.

**Fallback.** Continue adapter/tests on clearly identified synthetic transport fixtures while mapping, publication or P5.1 artifacts are pending. Keep those dependencies unticked.

---

### P5.3 — The GitHub source adapter

**Goal.** Implement the shared `CourseSourceAdapter` and reproducible cache-only reads.

**Build.**
1. `adapter.ts`: `CourseSourceError` codes `not_found`, `forbidden`, `rate_limited`, `unavailable`, `bad_reply`. Sanitize errors; never expose tokens, upstream bodies or URLs containing credentials.
2. `github.ts`: resolve configured ref once through GitHub's commits endpoint. Read manifest and listed PDFs through contents endpoints at that exact SHA. Validate schema, paths and references; encode each path segment. Require PDF MIME and `%PDF-` bytes; reject answer files and non-PDFs. Never follow temporary download URLs.
3. Save snapshot, original manifest, normalized outline and original PDF bytes through the existing Repo. Snapshot-qualified stable course/file/assignment/unit ids and idempotent upserts; preserve ingestion state on reimport. Import is not P6 ingestion. Convert due offsets at 23:59:59 UTC from persisted demo day. Preserve empty units, course-wide files and lecture labels.
4. `getAdapter(courseId)` reads stored source; `getOutline` and `downloadFile` use Repo only. Tutoring never fetches GitHub. `classify.ts`: `guessKind(title, mime)` checks lecture/notes, worksheet/problem set/homework/HW/assignment, syllabus, then slides/presentation MIME, otherwise other.
5. `POST /api/source/connect` explicitly imports configured source; `GET /api/source/courses` reads saved connection/course and ingestion status; `GET /api/files/[fileId]` serves only cached bytes. Tokens stay server-side. Do not build P5.4/P5.5 UI or P6 ingestion.
6. `scripts/smoke.ts` preserves database, model, vision and snapshot checks and adds source smoke when configured; `--no-source` skips it. Report actual title and unit count, SHA and persisted demo day.

**Acceptance**
- [x] **P5.3-AC1** — Recorded data maps to correct units, labels, assignments and exact dates.
- [x] **P5.3-AC2** — Moving branches cannot mix revisions; repeated imports create no duplicates.
- [x] **P5.3-AC3** — Cached outline/PDF reads and a mocked hint work with transport disabled and zero GitHub calls.
- [x] **P5.3-AC4** — Invalid paths/references, non-PDF content, 404, quota and network failures yield specified errors; no ingestion-complete flag or token leakage.
- [ ] **P5.3-AC5** — After confirmed manifest publication, live smoke prints `source ok` with actual title/unit count; snapshot records SHA/demo day.

**Verify.** `pnpm verify`, offline `pnpm e2e`, recorded import tests and confirmed published-manifest live smoke. Fake transport tests alone do not complete this subphase.

---

### P5.4 — The upload path

**Goal.** A student with no LMS access can still give Albert their course by dropping files.

**Build.**
1. `/` gets a second option under the configured-source import button: "No LMS access? Upload your notes and worksheets."
2. After files are dropped, show a table: one row per file with an editable unit number, a kind (guessed with `guessKind`), and for worksheets an optional due date. Unit numbers are pre-filled from file names where they contain a number after "unit", "week" or "lecture". One text field per unit for its title.
3. `POST /api/source/upload`: store each file through the `Repo`, create a `Course` with source `upload`, and save a `CourseOutline` so that `UploadAdapter.getOutline` can return it later.
4. `upload.ts`: `UploadAdapter` serves that stored outline and reads files from the `Repo`.
5. `getAdapter(connection)` in `index.ts` returns the adapter for a course's source. Nothing downstream knows which one it got.

**Acceptance**
- [ ] **P5.4-AC1** — Uploading the seed PDFs yields the same outline as GitHub. *Verify:* `tests/unit/upload.test.ts` builds an outline from the manifest and compares unit titles, file kinds and due dates with the outline from the GitHub recordings.
- [ ] **P5.4-AC2** — File name guesses are right for the seed set. *Verify:* unit test over the manifest's file names.
- [ ] **P5.4-AC3** — The flow works in the browser. *Verify:* `tests/e2e/upload.spec.ts` uploads three seed PDFs and lands on `/courses` with one course listed.

---

### P5.5 — Import and choose (separate owner)

**Goal.** A configured-source import button and course picker, without credentials in the browser.

**Build.** `/` imports via `POST /api/source/connect`; `/courses` lists saved courses via `GET /api/source/courses`. Not-ingested courses offer **Learn this course** (P6); ingested courses offer **Open**. Display plain source errors and remember the saved connection. No GitHub token input or LMS login.

**Acceptance**
- [ ] **P5.5-AC1** — Source failure stays on the import screen with a useful message (mocked route e2e).
- [ ] **P5.5-AC2** — Successful import lists the actual course (recorded e2e and live by hand).
- [ ] **P5.5-AC3** — No token appears in responses or page source (e2e).

---

### P5.6 — The worksheet page

**Goal.** `/work/[worksheetId]` shows a real worksheet's problems on the canvas from Phase 2.

**Build.**
1. Load the `Worksheet` from `GET /api/worksheet/[worksheetId]`. Until Phase 6 has produced worksheets, `pnpm seed:demo` supplies the hand-written one from P3.2.
2. Render one `ProblemBlock` per problem. Typeset `statementLatex` with the MathJax helper from P4.2, in black. Show the worksheet title, the unit and the due date at the top.
3. An **Original** button opens a side drawer with the worksheet PDF in an `<iframe>` pointing at `/api/files/[fileId]`, so the student can check the source.
4. `?problem=<label>` scrolls to and highlights a problem. The study plan links use this.
5. The scope bundle for the open problem is fetched once and its unit title shown as a small tag: "Unit 3 · Trigonometric Substitution".

**Acceptance**
- [ ] **P5.6-AC1** — All five problems of Worksheet 3 render with typeset statements and rows. *Verify:* `tests/e2e/worksheet.spec.ts` with seeded data counts five problem blocks and finds an SVG math node in each.
- [ ] **P5.6-AC2** — The deep link works. *Verify:* the same test opens `?problem=4` and asserts problem 4 is in the viewport.
- [ ] **P5.6-AC3** — The original PDF opens in the drawer. *Verify by hand.*
- [ ] **P5.6-AC4** — Strokes written under problem 4 carry problem 4's id. *Verify:* e2e test draws a synthetic stroke and reads state.

---

### P5.7 — LMS sync (post-hackathon)

Moodle/Canvas integration and automatic refresh are deferred. No LMS credential routes or stubs are needed for this lane.

---

## Phase exit

- [ ] `pnpm verify` and offline `pnpm e2e` pass.
- [ ] Published, confirmed manifest passes live source smoke.
- [ ] By hand: import the real configured source and open an original PDF from cache.
- [ ] By hand: upload fallback works (P5.4 owner).
- [ ] Status records source SHA/demo day and distinguishes synthetic golden evidence from real-course evidence.

Review-branch evidence (Nov 14): owner confirmed mapping; manifest commit `ce2196c8417b4fe751923b7969744b3d4ec41968` on `Azrkiel/albert-files:codex/p5-course-manifest`; real `pnpm smoke --no-llm` printed `source ok Calculus II — Integration Techniques 4 units` plus SHA and demo day `2026-11-14`. AC5 remains conservatively open for publication/smoke of the default configured `main` ref; neither repository main was merged. P5.2-AC1 now uses the owner's manifest and all 11 PDFs from 7ce9cd74d940e24b49b1814e0cbedc2cd6470098, with build hashes verified and offline imports tested. The initial transport placeholders were replaced. P5.1's own human readability check remains with that owner.
