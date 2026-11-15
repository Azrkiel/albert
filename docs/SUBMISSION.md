# Albert: submission description

HackPrinceton Fall 2026. Code: [Azrkiel/albert](https://github.com/Azrkiel/albert). Run it: [README](../README.md).

Every number below is copied from [`docs/plan/status.md`](plan/status.md). Anything without evidence there is a `TODO(owner)` and is not claimed.

## Inspiration

AI tutors live in chat boxes. You type your problem in, and they often teach a method your class has not reached yet. Math homework happens by hand, on a worksheet, usually late at night with no tutor around. We wanted help that shows up on the page, in the margin, the way a person leaning over your shoulder would give it.

## What it does

You open your course worksheet as a PDF and write on it with a pen. When you tap **I'm stuck** (or a pause suggests it), Albert reads your handwriting and draws a hint on the page: it circles the symbols it means, draws an arrow, and writes a short note with a citation to the lecture where your teacher taught the step. The first hint is a question, not the answer. Next to **I'm stuck** there is an **Ask Albert** field: type a short question (up to 200 characters) and press Enter. A new question cancels the one in flight, and follow-ups carry your earlier question and Albert's reply. Before the circle draws, a small red pen tip moves to the symbol Albert is pointing at. Your strokes save and reload, and **Save PDF** downloads the original worksheet with your strokes as native PDF ink annotations and Albert's marks and writing added. Notes that do not fit on the page go on labelled note pages at the end. A "Learn this course" button has a deep agent read the course's notes and worksheets first, so hints stay inside what the class has covered.

## How we built it

Next.js and TypeScript, with our own stroke canvas on Pointer Events. The server renders the PDF pages, and `pdf-lib` writes the annotated download in the browser. Claude on Amazon Bedrock reads the handwriting and writes the hint: `us.anthropic.claude-sonnet-4-6` for the agent and reader roles and, by default, the hint role (a Haiku 4.5 trial for the hint is local only, pending evaluation). The browser clusters strokes into numbered symbols; the model names a symbol by number, and the browser looks up where it is, so the model never guesses coordinates. Every model reply is validated with zod, and a server-side check enforces the hint ladder before anything is drawn.

Course ingestion is a deep agent built with LangChain Deep Agents. It keeps a todo list, delegates each unit to a `unit-reader` sub-agent, maps worksheet problems with a `worksheet-mapper`, and has a `card-checker` re-read each unit against its saved card. It uses a file system, skills (`skills/` holds `socratic-tutor`, `teaching-card` and `study-plan`) and memory. Its tools refuse a card whose worked examples are not in the source text, so a sub-agent repairs its own output. MongoDB Atlas holds the app data (sessions, cards, worksheets, cached files) and the agent's checkpoints and memory. The course itself is a synthetic Calculus II course in a GitHub repository, read through a pinned manifest and cached.

We built from a written plan in the repo, one subphase at a time, with acceptance criteria and recorded results in `status.md`.

TODO(owner): the plan says to describe Cursor and the Grok Bot automation here. `docs/tracks/spacexsi.md` and `status.md` have no evidence that either was used (P1.7-AC1 and AC2 are marked "needs human"). Write the paragraph only if they were; otherwise skip the SpaceXSI track.

## Forward Deployed (Peri)

TODO(owner): no conversation is recorded. `docs/tracks/peri.md` has four outreach emails drafted on Nov 14 (McGraw Center, Princeton Math Department peer tutoring, Kumon of Princeton, Mathnasium of Princeton), none sent, and no reply. Fill in all of:

- Business or organization name:
- Person consulted and role (with permission to be named):
- One piece of evidence (screenshot, photo, short video or direct quote):
- What they told us (two or three findings, in their words):
- What we changed because of it, with the commit:

If no conversation happened, do not enter the Peri track. Note that the tutor report, which the plan had reserved for this track, is not part of this release.

## Challenges

**Pointing at the right symbol.** Asking a model for pixel coordinates on handwriting is unreliable. We cluster strokes into numbered symbols in the browser and let the model name a number. On the 4-case recorded eval, status and row were correct 100% of the time (see Accomplishments).

**Keeping hints from giving answers.** A model told to be Socratic still slips. The hint ladder lives in the prompt and is enforced again on the server. Replies that break a rung's rules are repaired once and then rejected. This also cost us: in the latest 6-case live eval run 2, `missing-dx-r1` failed with `Rung 1 permits at most one math segment; you used 2.` after its repair, so no hint was shown for that case.

**PDF coordinates.** Pages are cropped and rotated, and the export has to put ink back in the right place. We unit-tested the transform on plain, cropped and 90, 180 and 270 degree pages before building the UI.

**Making the ink look written.** Marks use `roughjs` so circles and arrows draw like pen strokes, and notes are set in a handwriting font.

## Accomplishments

All of these come from `status.md`.

**Hint quality on the 4-case set (P3.4, real recordings of the missing-`dx` work at rungs 1 to 3 plus a repeat).** Status correct 100%, row correct 100%, scope 100% (runs 1 to 3 and 7). No answer given on rungs 1 and 2: 100% in three consecutive runs.

**The 6-case set (R3.1, after adding two question cases), Nov 15, commit `a70918c`.** Run 1 passed. Run 2 failed. Three consecutive passes were not achieved, so we do not claim them. Run 1 totals: status 100%, row 100%, clusters 100%, no-answer 100%, scope 100%, ladder 50%. Run 2 totals: status 83%, row 83%, clusters 83%, no-answer 80%, scope 83%, ladder 33%. The failure is tracked in [issue #65](https://github.com/Azrkiel/albert/issues/65). Ladder is reported but not gated. The question case lacked a citation in both runs.

**Time to first ink.** Median and 95th percentile first-ink times from those runs: 6390 ms and 10150 ms (run 1), 8910 ms and 10991 ms (run 2). The old three-second target is not met, and we do not claim it. The aggregate median and p95 row in `status.md` ("Time to first ink", P3.6) is empty, and the live first-ink times in the real UI (P4.4-AC6) are not recorded.

TODO(owner): add the live first-ink times from the real UI (`status.md` "Live first-ink times, three runs") if someone measures them. Otherwise leave this out.

**Course ingestion.** The full agent ingest of the synthetic course on Nov 14 took 315 s and passed 13 of 13 golden checks, producing 5 cards and 4 worksheets (14 problems). An immediate rerun took 425 s, also 13 of 13. That run still built a study plan, which this release no longer does. The context-only version was run live once on Nov 15 and did not finish: it hit the 90-call cap (59 more calls, 314 s) before writing `/course/scope.md`. Golden checks 1 to 11 and 13 passed and check 12 failed. Card and worksheet ids and counts were unchanged and no plan was saved. The mock replay of the older recorded run is what the no-keys demo shows.

**Automated checks.** `pnpm verify` on the local run recorded for PRs #68 to #70: 983 tests passed, 20 live Mongo tests skipped. Focused browser checks: 27 passed; replay 5; stuck 5 passed, 2 existing skips. The annotated-PDF export has 19 unit tests that read stroke coordinates back from the emitted content on plain, cropped and rotated pages.

**A real recording.** `fixtures/sessions/missing-dx-pdf.json`: pen input on the PDF, 32 strokes, 2 rows, 38052.7 ms.

**Live model budget.** 653 of 800 calls used across the release (`status.md` ledger).

TODO(owner): demo hints on target with the demo device (`status.md` "/ 5") and three timed demo runs (P8.6) are blank. Fill them from real runs or leave them out.

## What we learned

A model is better at saying which numbered symbol is wrong than at saying where it is, so the browser owns the geometry. We recorded real model runs as test fixtures so the browser tests replay real replies. Latency is about five to ten seconds per hint with our checks, so streaming is the next real fix.

## What's next

Streaming for faster first ink. Placing notes in free space on the page instead of a band below it. Canvas support through an institution-approved integration. Drill mode and more subjects. The study plan, re-plan and progress code exists in the repository but is out of this release.

## Tracks entered

Derived from `tracks.md` section 10. A tick means the requirement is met and the evidence is linked. Nothing is ticked on the human's behalf.

**Education (required).**
- [x] Interactive, personalized and accessible: the demo is the evidence. The app runs in a browser with mouse, finger or stylus ([README](../README.md)).
- [ ] Education selected on the submission form. TODO(owner)

**Amazon, Best Practical AI Innovation.**
- [x] Model on Bedrock: `LLM_PROVIDER=bedrock`, us-east-1, Claude Sonnet 4.6 for the agent and reader roles and the hint default ([Settings in use](plan/status.md)). `pnpm smoke` passed on Bedrock at gate G0 (status.md log, Nov 14).
- [x] README has the use case, target user, run instructions and an architecture sketch.
- [ ] Working prototype and backup video. TODO(owner): demo video link.
- [ ] A screenshot of the Bedrock console or a `pnpm smoke` log in `docs/tracks/amazon.md`. TODO(owner)
- [ ] The adaptive-intelligence row in `tracks.md` (skill levels and re-plan) is not part of this release and is not claimed.

**LangChain, Best use of deepagents.**
- [x] `deepagents` is a dependency and the agent is in `src/lib/agent/` ([agent.ts](../src/lib/agent/agent.ts)).
- [x] Three sub-agents in the ingest flow ([subagents.ts](../src/lib/agent/subagents.ts)); a `planner` sub-agent exists but is not used in this release.
- [x] `skills/` has three skills with `SKILL.md`: [socratic-tutor](../skills/socratic-tutor), [teaching-card](../skills/teaching-card), [study-plan](../skills/study-plan).
- [ ] Run panel on screen in the demo for 15 seconds, and a screenshot in `docs/tracks/langchain.md`. TODO(owner)
- [ ] `pnpm check:tracks` is still a stub (`"not built yet (Phase 8)"` in `package.json`), so the machine check does not run.

**Peri, Forward Deployed Challenge.**
- [ ] Not met. No conversation, name, role or evidence is recorded. See the Peri section above. TODO(owner)

**MLH, Best Use of MongoDB Atlas (if offered).**
- [x] Atlas is the default store (`STORE=mongo`), and the agent's checkpoints use the MongoDB checkpointer ([Settings in use](plan/status.md)).
- [ ] Screenshot of the collections and one example document each in `docs/tracks/mongodb.md`. TODO(owner)
- [ ] Confirm the category is offered (`tracks.md` C1). TODO(owner)

**MLH, SpaceXSI raffle (if offered).**
- [x] `AGENTS.md` exists at the repo root.
- [ ] Cursor and Grok Bot usage, screenshots, three automation runs, and the opt-in. No evidence in `status.md`. TODO(owner): enter only if true.

**Other.**
- [ ] Best Rookie: only if every team member qualifies. TODO(owner)
- [ ] Repository link (https://github.com/Azrkiel/albert) and live link (https://learn-albert.fly.dev, Fly app `learn-albert`) done; demo video link TODO(owner)

## Still open at the time of writing

From `status.md`, none of these is claimed as done: Gate R2 and R3 by-hand runs (writing on the demo device, annotated PDF in an independent viewer, a live cited hint on the PDF), live Mongo `listEvents` ordering (R2.3-AC2), the Worksheet 3 open check that failed in the mock walkthrough ([defect #62](https://github.com/Azrkiel/albert/issues/62); a fix is in progress in a separate PR), a live cited hint and follow-up through Ask Albert, Save PDF opened in Edge and an independent viewer, and the by-hand real-import check.
