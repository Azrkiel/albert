# Phase 5 — LMS

**Purpose.** Get a real course into Albert: a Moodle site with a believable Calculus II course on it, an adapter that pulls its outline, files and due dates with a student's own login, a manual upload path for when Moodle is not available, and the worksheet page the student works on.

**Done looks like.** Enter the Moodle address and the demo student's login, see "Calculus II" in the list, and have Albert hold every lecture PDF, worksheet and due date for it. Or drop the same PDFs into the upload form and get the same result.

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
  adapter.ts                # LmsAdapter, LmsError
  moodle.ts                 # MoodleAdapter
  upload.ts                 # UploadAdapter
  canvas.ts                 # CanvasAdapter (stub)
  classify.ts               # file name → kind guess          (pure)
  index.ts                  # getAdapter(connection)
fixtures/moodle/            # recorded web-service replies
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
2. Write `seed/calc2/answers.md` with a final answer for every worksheet problem. This file is never uploaded to Moodle; it is used to check the eval cases.
3. `scripts/seed-pdf.ts` (`pnpm seed:pdf`): render each markdown file to HTML with MathJax, and print it to PDF with Playwright into `seed/calc2/pdf/`. Keep every PDF under 4 MB and under 10 pages.
4. `seed/calc2/manifest.json`: for each PDF its unit order, kind, title, and for worksheets the due date as an offset in days from "demo day", so the dates can be regenerated.

**Acceptance**
- [ ] **P5.1-AC1** — All PDFs build. *Verify:* `pnpm seed:pdf` exits 0 and `seed/calc2/pdf/` contains the syllabus, six lectures and four worksheets.
- [ ] **P5.1-AC2** — Every marker fact is present. *Verify:* `tests/unit/seed.test.ts` greps the markdown sources: "LIATE" in unit 1; "five-step recipe" and "Step 2" in lecture 9; `\theta` and "reference triangle" in lectures 9 and 10; "Partial Fractions" in the syllabus and **not** in units 1 to 3; no `f'(x)` anywhere.
- [ ] **P5.1-AC3** — The answers are right. *Verify:* someone differentiates the answers to Worksheet 3 problems 1 and 4 by hand, or checks every answer in `answers.md` with a computer algebra system, and initials `status.md`.
- [ ] **P5.1-AC4** — The PDFs read well. *Verify by hand:* open Lecture 9. The math is typeset, and Example 2 shows five labelled steps.

---

### P5.2 — The Moodle site

**Goal.** The course exists on *Albert and Einstein Academy* and a student account can reach it through web services.

**Build.** This is done in the Moodle admin screens. Tick each line in `status.md` as it is done.
1. Sign in as administrator. Turn on web services for mobile devices (Site administration → Mobile app → Mobile settings, or Advanced features, depending on the Moodle version). This enables the built-in mobile service, which is what lets an ordinary user get a token with their own login.
2. Create the course **Calculus II**, short name `CALC2`, topics format, five sections named exactly as in the table above ("Unit 1 — Integration by Parts", …).
3. In the general section at the top, add `syllabus.pdf` as a File resource named "Syllabus".
4. In each of Units 1 to 3, add that unit's lecture PDFs as File resources named "Lecture 9 — Trigonometric Substitution I" and so on.
5. In each of Units 1 to 4, add an **Assignment** named "Worksheet N", attach the worksheet PDF under *Additional files*, and set the due date from the manifest. Leave Units 4 and 5 without lecture notes.
6. Create a user for the demo student (for example `ada`), with a password, and enrol them in the course as a Student.
7. Check access from a terminal, replacing the capitals:
   ```bash
   # a token for the student
   curl -s -X POST "https://SITE/login/token.php" \
     -d "username=ada" -d "password=PASSWORD" -d "service=moodle_mobile_app"
   # → {"token":"…","privatetoken":…}

   # who am I
   curl -s -X POST "https://SITE/webservice/rest/server.php" \
     -d "wstoken=TOKEN" -d "moodlewsrestformat=json" -d "wsfunction=core_webservice_get_site_info"
   # my courses
   curl -s -X POST "https://SITE/webservice/rest/server.php" \
     -d "wstoken=TOKEN" -d "moodlewsrestformat=json" \
     -d "wsfunction=core_enrol_get_users_courses" -d "userid=USERID"
   # the course outline
   curl -s -X POST "https://SITE/webservice/rest/server.php" \
     -d "wstoken=TOKEN" -d "moodlewsrestformat=json" \
     -d "wsfunction=core_course_get_contents" -d "courseid=COURSEID"
   # assignments and due dates
   curl -s -X POST "https://SITE/webservice/rest/server.php" \
     -d "wstoken=TOKEN" -d "moodlewsrestformat=json" \
     -d "wsfunction=mod_assign_get_assignments" -d "courseids[0]=COURSEID"
   ```
8. Save each JSON reply under `fixtures/moodle/` (`token.json` with the token replaced by `"REDACTED"`, `site_info.json`, `courses.json`, `contents.json`, `assignments.json`). These recordings are the adapter's test data.
9. Download one file to confirm file access: take a `fileurl` from `contents.json`, append `?token=TOKEN` (or `&token=TOKEN` if it already has a query), and check that a PDF comes back.
10. Put `MOODLE_BASE_URL` in `.env.local`. Keep the student password out of the repo.

**Acceptance**
- [ ] **P5.2-AC1** — The student can get a token. *Verify:* the first `curl` returns a `token`.
- [ ] **P5.2-AC2** — The outline shows five sections, six lecture files and four assignments. *Verify:* `contents.json` and `assignments.json` contain them.
- [ ] **P5.2-AC3** — A lecture PDF downloads with the token. *Verify:* step 9 saves a file that opens.
- [ ] **P5.2-AC4** — Five recordings are in `fixtures/moodle/` with no real token in them. *Verify:* `grep -R "wstoken\|\"token\":\"[a-f0-9]\{20,\}" fixtures/moodle` finds nothing.

**Fallback.** If web services cannot be enabled on the site's plan, or the token request is refused and cannot be fixed in 30 minutes: skip to P5.4. The upload path feeds Phase 6 the same PDFs. Come back to Moodle if time allows.

---

### P5.3 — The Moodle adapter

**Goal.** `MoodleAdapter` turns Moodle's replies into the `CourseOutline` the rest of Albert uses.

**Build.**
1. `adapter.ts`: the `LmsAdapter` interface from `contracts.md` §10 and `class LmsError extends Error { code: "auth" | "not_found" | "forbidden" | "unavailable" | "bad_reply" }`.
2. `moodle.ts`:
   - `static async connect(baseUrl, username, password)`: normalise the URL (add `https://`, strip trailing slash and any path after the host unless the site lives in a sub-folder), POST to `/login/token.php` with `service=moodle_mobile_app`, and return the token. The password is used once and never stored or logged.
   - `call(fn, params)`: POST form-encoded to `/webservice/rest/server.php` with `wstoken`, `wsfunction`, `moodlewsrestformat=json`. Arrays are sent as `name[0]=…`. **Moodle reports errors with HTTP 200** and a body like `{ exception, errorcode, message }`; detect that shape and throw an `LmsError`.
   - `listCourses()`: `core_webservice_get_site_info` for the user id, then `core_enrol_get_users_courses`.
   - `getOutline(courseId)`: `core_course_get_contents` and `mod_assign_get_assignments`. Sections after the general one become units, in order. `resource` and `folder` modules contribute their file contents. Assignments contribute their attached files and due dates, matched to a unit by the section their module sits in. Files in the general section have no unit.
   - `downloadFile(ref)`: fetch the URL with the token added as a query parameter. Reject a reply whose content type is JSON (that is an error body, not a file).
3. `classify.ts`: `guessKind(title, mime)` → `lecture_notes` for /lecture|notes/i, `worksheet` for /worksheet|problem set|homework|\bhw\b|assignment/i, `syllabus` for /syllabus/i, `slides` for /slides/i or a presentation mime type, else `other`.
4. Routes:
   - `POST /api/lms/connect`: connect, read the site info, save an `LmsConnection` for `DEMO_STUDENT_ID`, reply with the site and user names. The token is not in the reply.
   - `GET /api/lms/courses`: list courses through the saved connection, marking which are already ingested.
   - `GET /api/files/[fileId]`: stream a cached course file to the browser (used by the worksheet page). It serves only files already stored in the `Repo`.
5. `scripts/smoke.ts` gains an `lms` line when `MOODLE_BASE_URL` and `MOODLE_TOKEN` are set.

**Acceptance**
- [ ] **P5.3-AC1** — The recordings parse into the right outline. *Verify:* `tests/unit/moodle.test.ts` feeds `fixtures/moodle/*.json` through the adapter with a fake transport and asserts: five units in order with the right titles; lecture files attached to units 1 to 3; four assignments with due dates; the syllabus has no unit.
- [ ] **P5.3-AC2** — Moodle's error-in-200 replies become `LmsError`s. *Verify:* unit test with `{ "exception": "…", "errorcode": "invalidtoken", "message": "…" }` → code `auth`.
- [ ] **P5.3-AC3** — The password is never stored or logged. *Verify:* unit test spies on the `Repo` and the logger during `connect`; neither receives the password string.
- [ ] **P5.3-AC4** — URL normalisation handles what people type. *Verify:* unit test: `site.moodlecloud.com`, `https://site.moodlecloud.com/`, `https://site.moodlecloud.com/my/` all resolve to the same base.
- [ ] **P5.3-AC5** — It works against the live site. *Verify:* `pnpm smoke` prints `lms ok  Calculus II  5 units`.

---

### P5.4 — The upload path

**Goal.** A student with no LMS access can still give Albert their course by dropping files.

**Build.**
1. `/` gets a second option under the Moodle form: "No LMS access? Upload your notes and worksheets."
2. After files are dropped, show a table: one row per file with an editable unit number, a kind (guessed with `guessKind`), and for worksheets an optional due date. Unit numbers are pre-filled from file names where they contain a number after "unit", "week" or "lecture". One text field per unit for its title.
3. `POST /api/lms/upload`: store each file through the `Repo`, create a `Course` with source `upload`, and save a `CourseOutline` so that `UploadAdapter.getOutline` can return it later.
4. `upload.ts`: `UploadAdapter` serves that stored outline and reads files from the `Repo`.
5. `getAdapter(connection)` in `index.ts` returns the adapter for a course's source. Nothing downstream knows which one it got.

**Acceptance**
- [ ] **P5.4-AC1** — Uploading the seed PDFs yields the same outline as Moodle. *Verify:* `tests/unit/upload.test.ts` builds an outline from the manifest and compares unit titles, file kinds and due dates with the outline from the Moodle recordings.
- [ ] **P5.4-AC2** — File name guesses are right for the seed set. *Verify:* unit test over the manifest's file names.
- [ ] **P5.4-AC3** — The flow works in the browser. *Verify:* `tests/e2e/upload.spec.ts` uploads three seed PDFs and lands on `/courses` with one course listed.

---

### P5.5 — Connect and choose

**Goal.** The first two screens of the demo.

**Build.**
1. `/`: the name and tagline, one sentence on what Albert does, and the connect form: site address, username, password, and a line under it: "Albert swaps this for an access key and does not keep your password." On success go to `/courses`.
2. `/courses`: the student's courses as cards. A course that has not been ingested shows **Learn this course**, which starts ingestion (Phase 6) and shows the run panel. An ingested course shows **Open**, which goes to `/course/[courseId]`.
3. Errors are stated plainly next to the form: wrong login, site not reachable, web services not enabled on this site (with the suggestion to use upload).
4. A connected state is remembered, so reloading `/` goes straight to `/courses`.

**Acceptance**
- [ ] **P5.5-AC1** — A wrong password shows the wrong-login message and stays on the form. *Verify:* e2e test with a mocked connect route.
- [ ] **P5.5-AC2** — A good login lists Calculus II. *Verify by hand* against the live site; and an e2e test with the adapter replaced by the recordings.
- [ ] **P5.5-AC3** — The token is not in any response or in page source. *Verify:* e2e test inspects network responses for the token string from the mock.

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

### P5.7 — The Canvas stub

**Goal.** Show that a second LMS is a matter of writing one more adapter, without writing it.

**Build.**
1. `canvas.ts`: `CanvasAdapter implements LmsAdapter`. Each method throws `LmsError("unavailable")` with the message "Canvas support is planned". A doc comment on each method names the Canvas REST endpoint it would call: list courses (`GET /api/v1/courses`), modules and items (`GET /api/v1/courses/:id/modules`), files (`GET /api/v1/courses/:id/files`), assignments (`GET /api/v1/courses/:id/assignments`), authenticated with a bearer token.
2. On `/`, a disabled "Canvas — coming soon" option beside Moodle.

**Acceptance**
- [ ] **P5.7-AC1** — The stub satisfies the interface. *Verify:* it type-checks, and a unit test asserts each method rejects with code `unavailable`.

**Time box.** 15 minutes. This exists for the pitch, not for use.

---

## Phase exit

```bash
pnpm verify      # moodle parsing, classify, upload, seed marker facts
pnpm e2e         # upload flow, worksheet page, connect errors
pnpm smoke       # lms ok
```

- [ ] By hand: on a clean browser profile, connect to the live Moodle site as the demo student, see Calculus II, open Worksheet 3 (seeded), and write under problem 1.
- [ ] By hand: do the same through upload with the seed PDFs.
- [ ] `status.md` records the Moodle site address (not the password), the demo username, and which path the demo will use.
