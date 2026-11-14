# Phase 7 — Progress

**Purpose.** Turn what happened on the page into an honest picture of how the student is doing: evidence events from hints and checks, skill levels computed from that evidence, a course page that shows the levels and the plan, and a one-page report a tutor can use. This closes the *adaptive* loop and carries the Peri track's business-facing feature.

**Done looks like.** Finish a session and the course page shows which skills moved and why, a plan that reacts to it, and a "how you're doing" line. A tutor opens the report and sees exactly where the student got stuck, with a picture of the work.

| | |
|---|---|
| Depends on | Phase 3 (hints and checks), Phase 6 (cards, plan, re-plan) |
| Unblocks | The end of the demo, the Peri evidence |
| Time box | 5 hours (gate **G4** at T+28h) |
| Lane | D — Proof |

Read first: [`contracts.md`](./contracts.md) §7 and §8, [`decisions.md`](./decisions.md) D11, D16, [`tracks.md`](./tracks.md) §6.

```
src/lib/tutor/evidence.ts     # hints and checks → EvidenceEvent      (pure)
src/lib/progress/
  levels.ts                   # computeLevel, computeSkills            (pure)
  report.ts                   # buildTutorReport                       (pure over Repo reads)
src/app/course/[courseId]/page.tsx
src/app/report/[courseId]/page.tsx
src/components/progress/SkillMap.tsx  PlanList.tsx  HowYoureDoing.tsx
```

---

### P7.1 — Evidence

**Goal.** Every hint and every check leaves a small, precise record of what it showed about a skill.

**Build.** In `evidence.ts`, three pure functions:

1. `evidenceFromHint(hint: StoredHint, session): EvidenceEvent[]`
   - If `diagnose.status` is `error` and `diagnose.subskillId` is set: one `error_made` event with the `errorType`.
   - One error is one event however many rungs it took. Deduplicate on `(sessionId, problemId, subskillId, errorType)`: rungs 2 and 3 for the same mistake add nothing.
   - `on_track`, `stalled` and `unreadable` produce no evidence. Stopping to think is not a mistake.
2. `evidenceFromCheck(check: CheckResponse, problem, hintsOnProblem: StoredHint[], session): EvidenceEvent[]`
   - On `correct`: one event per subskill of the problem. The outcome is `unaided_correct` if no hint was requested on this problem in this session, otherwise `correct_after_r<n>` where *n* is the highest rung shown.
   - On `not_yet` or `unreadable`: nothing. (A following hint will record the error.)
3. `evidenceFromSessionEnd(session, hints, checks): EvidenceEvent[]`
   - For each problem that had at least one `error` hint and no `correct` check: one `abandoned` event for each diagnosed subskill.

Wire them in: `/api/hint` adds hint evidence after saving the `StoredHint`; `/api/check` adds check evidence; `/api/session/[id]/end` adds end-of-session evidence (P7.5). All through `repo.addEvidence`.

**Acceptance**
- [ ] **P7.1-AC1** — Each function produces the right events. *Verify:* `tests/unit/evidence.test.ts`: an error hint → one `error_made`; the same error at rungs 1, 2, 3 → still one; a `stalled` hint → none; a correct check with no hints → `unaided_correct` for every subskill; with hints up to rung 2 → `correct_after_r2`; a session ending with an unfinished, hinted problem → `abandoned`.
- [ ] **P7.1-AC2** — Evidence is written from the live routes. *Verify:* `tests/e2e/evidence.spec.ts` (mock model, memory store): replay `missing-dx.json`, request a hint, then read evidence through a dev route: one `error_made` with `errorType: "missing_dx"`.
- [ ] **P7.1-AC3** — A hint whose `subskillId` is not in the course produces no evidence and logs a warning. *Verify:* unit test.

---

### P7.2 — Skill levels

**Goal.** A level for every subskill, computed the same way every time, with the evidence that justifies it.

**Build.**
1. `levels.ts`:
   ```ts
   function computeLevel(events: EvidenceEvent[], unitTaught: boolean): { level: SkillLevel; evidenceIds: string[] }
   function computeSkills(args: { cards: TeachingCard[]; evidence: EvidenceEvent[];
                                  studentId: string; courseId: string }): SkillState[]
   ```
   Implement the table in `contracts.md` §7 exactly. `evidenceIds` are the events that satisfied the condition for the level reached, so the page can say why.
2. A unit counts as covered on the course page when its card is `taught` (it was built from posted lecture notes). For the seed course that is units 1 to 3; units 4 and 5 are in the syllabus only and show as "Not covered yet".
3. `recomputeSkills(studentId, courseId)` reads cards and all evidence, calls `computeSkills`, and saves. Call it after any evidence is added. It is cheap; do not try to update incrementally.
4. `GET /api/progress/[courseId]` returns the skills and the recent errors.

**Acceptance**
- [ ] **P7.2-AC1** — Every row of the level table is tested. *Verify:* `tests/unit/levels.test.ts`, one test per row:
  - not covered → 0
  - covered, no events → 1
  - one `correct_after_r3` → 2
  - `correct_after_r1` on problem A and `correct_after_r2` on problem B → 3
  - the same two on the *same* problem → 2 (not independent)
  - two `unaided_correct` on different problems in different sessions → 4
  - two `unaided_correct` in one session, each within 20 minutes of a hint on that subskill → 3 (neither is cold)
  - level 4 history followed by two `error_made` → 3
  - a single `error_made` after level 3 → 3 (one slip does not demote)
  - never below 1 for a covered unit
- [ ] **P7.2-AC2** — The function is deterministic and order-independent. *Verify:* unit test shuffles the events and gets the same result.
- [ ] **P7.2-AC3** — `evidenceIds` name real events that justify the level. *Verify:* unit test for levels 3 and 4.
- [ ] **P7.2-AC4** — The model cannot set a level. *Verify:* `grep -R "level" src/lib/tutor src/lib/agent/tools.ts` shows no code path that writes `SkillState`; only `src/lib/progress` calls `repo.saveSkills`.

---

### P7.3 — The course page

**Goal.** One screen that answers "how am I doing and what should I do next?".

**Build.** `/course/[courseId]`, top to bottom:

1. **Header.** Course title; "Unit 3 · Trigonometric Substitution" as the current unit; the next due date.
2. **How you're doing.** The plan's `summary`, in a plain card. Beneath it three small figures: problems solved unaided, hints used, and skills at level 3 or above out of the covered total.
3. **Study plan.** `PlanList`: items grouped by day ("Today", "Tomorrow", then dates). Each item: worksheet and problem labels, minutes, the reason sentence, the lecture reference, a **Start** link to the work page at that problem, and a checkbox that sets its status. When a re-plan is running, a quiet line: "Albert is updating your plan…".
4. **Skill map.** `SkillMap`: units as groups; each subskill a row with its name, a five-segment bar and the level in words ("can do with help"). Upcoming units are greyed with "Not covered yet". Tapping a row opens **Why**: the evidence behind the level in plain words ("Solved Worksheet 3 #2 with no hints · Nov 14", "Dropped dx · Worksheet 3 #1 · Nov 14"), and the most recent error type if any.
5. **Worksheets.** Each with its unit, due date, and how many problems are checked correct.
6. **What Albert learned about this course.** A collapsed section: per unit, the teacher's methods and notation from the card, and the collapsed run panel from P6.6. This is where a judge sees that scope came from the real notes.

All of it reads from `GET /api/course/[courseId]`.

**Acceptance**
- [ ] **P7.3-AC1** — The page renders every section from seeded data. *Verify:* `tests/e2e/course-page.spec.ts` with `pnpm seed:demo` data: finds the summary text, at least three plan items, a skill row for each unit 3 subskill, greyed rows for unit 4, and four worksheets.
- [ ] **P7.3-AC2** — "Why" shows real evidence. *Verify:* the same test opens a level 3 skill and finds two evidence lines.
- [ ] **P7.3-AC3** — Ticking an item persists. *Verify:* e2e test ticks, reloads, still ticked.
- [ ] **P7.3-AC4** — A first-time student sees something sensible. *Verify:* e2e test with cards and a plan but no evidence: every covered skill at level 1, the summary present, no errors.

---

### P7.4 — The tutor report

**Goal.** A page a tutor or teaching assistant can read in one minute before a session. This is what makes Albert adoptable by the organization consulted for the Peri track.

**Build.**
1. `TutorReport` is defined in `contracts.md` §7. Its `tutorNote` field is the hint's `privateNote`: the plain statement of what was wrong. The student never sees it; the tutor does.
2. So that the report can show the work, `/api/hint` stores the request's snapshot image as a file after responding (not before; never slow the hint) and sets `snapshotFileId` on the stored hint.
3. `report.ts`: `buildTutorReport(studentId, courseId, period)` from hints, evidence, skills and sessions. No model call.
4. `/report/[courseId]`: a clean, printable page. Title "Tutor report — Ada · Calculus II · this week". The summary. **Where they got stuck**: one block per stuck point with the snapshot thumbnail, "Albert read: …", "What was wrong: …", "Albert asked: …", and the count. **Skills**: the map, compact. **Suggested focus for your next session.** A print stylesheet so it fits one or two pages.
5. A **Share with my tutor** link on the course page opens it.
6. Leave a clearly marked slot at the top of the report component for the one change that comes out of the Peri conversation (P8.2), so it can be added quickly.

**Acceptance**
- [ ] **P7.4-AC1** — The report is built correctly from data. *Verify:* `tests/unit/report.test.ts` with seeded hints and evidence: stuck points are grouped by subskill and error type, ordered by count, with the right example; totals are right; `suggestedFocus` lists the lowest covered skills.
- [ ] **P7.4-AC2** — The page renders and prints. *Verify:* `tests/e2e/report.spec.ts` finds one stuck-point block with an image and the text "What was wrong"; by hand, the print preview is at most two pages.
- [ ] **P7.4-AC3** — The snapshot is saved without delaying the hint. *Verify:* unit test of the route: the `done` event is written before `putFile` resolves.
- [ ] **P7.4-AC4** — The student's pages never show `privateNote`. *Verify:* e2e test greps the work page and course page HTML for a seeded private note string and finds nothing; the report page does contain it.

---

### P7.5 — Ending a session

**Goal.** One action closes the loop: evidence, levels, re-plan, and a page that shows the change.

**Build.**
1. `POST /api/session/[id]/end`:
   1. Mark the session ended.
   2. Add end-of-session evidence.
   3. `recomputeSkills`.
   4. Start `runReplan(courseId, "session_end")` without waiting for it, and return `{ evidenceAdded, replanRunId }`.
2. The work page's **End session** button calls it and goes to the course page.
3. The course page, when a re-plan is running, shows "Albert is updating your plan…" and re-fetches when the run ends. Skills are already updated because they do not wait for the agent.
4. Highlight what changed since the last visit: skills whose level moved get a small up or down marker for this view; new plan items are marked "new".
5. If the re-plan fails, keep the previous plan and show nothing alarming. Log the failure.

**Acceptance**
- [ ] **P7.5-AC1** — The route does all four steps in order. *Verify:* `tests/unit/session-end.test.ts` with a fake `runReplan`: session ended, evidence added, skills saved, replan called once, response has the run id.
- [ ] **P7.5-AC2** — Skills are visible before the re-plan finishes. *Verify:* e2e test with a slow fake re-plan: the moved skill shows its marker while "updating your plan" is still visible.
- [ ] **P7.5-AC3** — A failed re-plan leaves the old plan in place. *Verify:* e2e test with a failing fake.
- [ ] **P7.5-AC4** — **Gate G4.** By hand, with the real model and agent: do the missing-`dx` problem with one hint, check it correct, end the session. On the course page the related skill shows level 2 with its evidence under **Why**, and within 90 seconds the plan has a new item whose reason mentions `dx`.

---

## Phase exit — gate G4

```bash
pnpm verify      # evidence, levels, report, session end
pnpm e2e         # course page, report page, session-end flow
```

- [ ] P7.5-AC4 done by hand.
- [ ] A screenshot of the course page after a real session saved as `docs/tracks/img/course-page.png`, and one of the tutor report as `docs/tracks/img/tutor-report.png`.
- [ ] `pnpm seed:demo` loads a believable history (two earlier sessions with mixed outcomes) so the course page is never empty in the demo.
