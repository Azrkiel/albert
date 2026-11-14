# Phase 8 — Ship

**Purpose.** Prove the whole thing works end to end, collect what each track needs, talk to a real tutoring organization, harden the demo, write the submission, and submit with time to spare.

**Done looks like.** The three-minute demo has run cleanly three times in a row on the demo machine, a backup video exists, every track's checklist is ticked, and the project is submitted two hours before the deadline.

| | |
|---|---|
| Depends on | Everything. But P8.2 starts on Friday night and P8.3 collects evidence all weekend |
| Time box | Feature freeze **G5** at T+31h. Submitted **G6** at T+34h |
| Lane | D — Proof, then everyone after freeze |

Read first: [`tracks.md`](./tracks.md) in full, [`00-main-plan.md`](./00-main-plan.md) §5.3 and §7.

---

### P8.1 — The whole path, tested

**Goal.** One automated test and one manual run that walk the full user journey from the main plan §1.2.

**Build.**
1. `tests/e2e/journey.spec.ts`, offline (`MOCK_LLM=1`, `STORE=memory`, seeded data, the course-source adapter served from recordings):
   1. Import the recorded GitHub manifest → courses list shows Calculus II.
   2. Open the course → the course page renders.
   3. Open Worksheet 3, problem 1 → replay `missing-dx.json`.
   4. The hint mark appears → tap → circle, arrow, question, citation.
   5. **More help** → rung 2 stacks under rung 1.
   6. Replay the corrected continuation → **Check** → "Correct."
   7. Problem 4 → replay `partial-fractions-urge.json` → **I'm stuck** → the deferral note names Unit 4 and the hint does not contain partial-fraction steps.
   8. **End session** → course page shows a moved skill and (with a fake re-plan) a new plan item.
   9. Open the tutor report → one stuck point with "What was wrong".
   10. Canvas integration (P2.5a/P2.5b with P2.7 and P4). Replay a free-layout recording with side work beside a divider and ask for a hint on a side line. Check two things:
       - the snapshot tags every line at its own left edge (`row.bbox.x`), so side lines are tagged beside the side work;
       - Albert's margin notes for two lines at the same height stack without overlapping.
2. `scripts/journey-live.md`: the same ten steps as a manual checklist against the real model, database, agent and pinned GitHub source, with a box to tick and a place to note the time of each hint.

**Acceptance**
- [ ] **P8.1-AC1** — The offline journey passes. *Verify:* `pnpm e2e -- journey`.
- [ ] **P8.1-AC2** — The live journey passes on the demo machine. *Verify:* `scripts/journey-live.md` ticked, with hint times, committed.
- [ ] **P8.1-AC3** — Nothing in the browser console is red during the live journey. *Verify by hand.*

---

### P8.2 — The Peri conversation

**Goal.** A real organization that tutors math, consulted during the hackathon, with a named person, evidence, and a change in the product because of what they said. Start on Friday night.

**Friday night: outreach.** Send to at least three organizations (see `tracks.md` §6 for who). Adapt this:

> Hi — we're students at HackPrinceton this weekend building a math tutoring tool, and we'd like 15 minutes with someone who actually tutors or teaches calculus so that we build something useful rather than something we imagined. Could we talk, in person or by call, any time Saturday? We'd show you a short prototype and ask five questions. — *[names]*

Log who was contacted, when and how in `docs/tracks/peri.md`.

**Saturday, by 3 p.m.: the conversation.** Two people go if possible: one talks, one takes notes.

1. *Before anything else,* ask permission to use their name, role and a quote or photo in a hackathon submission. If they prefer not to be photographed, a written quote or a screenshot of a message is enough.
2. Ask, and write down their words:
   1. How do your students get help between sessions today?
   2. Where do they most often get stuck, and how do you find out about it?
   3. What goes wrong when they use AI chat tools on homework?
   4. If a tool told you exactly where each student got stuck this week, what would you do with it?
   5. What would stop you from using something like this next week?
3. Show the canvas and one hint, even if rough. Ask what they would change first.
4. Collect the evidence there and then: a photo together, or a screenshot of the message thread, or a quote they approve.

**Saturday afternoon: one change.** Pick the single most useful thing they asked for that fits in an hour, and build it. Likely candidates, already half-built: an addition to the tutor report (for example grouping by error type, or a "bring this to your next session" list); a stricter hint rule (for example never showing rung 3 on graded work); a setting a tutor would want. Commit it with a message that names the conversation.

**Sunday morning, if possible:** send them the working demo or show it in person, and record their reaction in one line.

**Write `docs/tracks/peri.md`:**

```markdown
Organization:
Person:
Role:
Consent to be named: yes / first name only
Date and time:
Evidence: img/peri-1.jpg   (or a quoted message)

## What they told us
- "…"
- "…"

## What we changed because of it
- <change> — commit <sha>

## Could they adopt it now?
<two sentences: what they would need, what already works>

## Their reaction to the demo
"…"
```

**Acceptance**
- [ ] **P8.2-AC1** — Outreach sent to three or more organizations on Friday. *Verify:* the log in `docs/tracks/peri.md`.
- [ ] **P8.2-AC2** — A conversation happened with a named person who gave consent. *Verify:* the first six lines of the file are filled in and the evidence file exists.
- [ ] **P8.2-AC3** — One change was built because of it. *Verify:* the commit exists and is named in the file.
- [ ] **P8.2-AC4** — The Peri pitch line in `tracks.md` §6 is filled in with the real name and finding.

**Fallback.** If nobody replies by Saturday noon, walk to the nearest tutoring business or campus learning center and ask in person; and ask at the organizers' table whether a teaching assistant or tutoring-group member is among the mentors. A student organization that tutors counts. If there is truly nobody by 6 p.m. Saturday, do not enter this track; an entry without the three required items is ineligible, and the time is better spent on the demo.

---

### P8.3 — Track evidence

**Goal.** Every track's checklist in `tracks.md` is satisfied and provably so.

**Build.**
1. `scripts/check-tracks.ts` (`pnpm check:tracks`) prints one line per check, grouped by track:

   | Track | Check |
   |---|---|
   | Education | `README.md` has a "Who it's for" section |
   | Amazon | `README.md` has "What it does", "Who it's for", "Run it" and "How it works" sections; `docs/tracks/amazon.md` names the model ids |
   | LangChain | `deepagents` is in `package.json`; `createDeepAgent` appears in `src/lib/agent/`; at least three sub-agents are exported; `skills/` has at least two `SKILL.md` files; `docs/tracks/langchain.md` references an existing image |
   | MongoDB | `mongodb` is in `package.json`; `.env.example` has `MONGODB_URI`; `docs/tracks/mongodb.md` references an existing image |
   | SpaceXSI | `AGENTS.md` exists; `docs/tracks/spacexsi.md` references two existing images and has a "How we used them" paragraph of at least 40 words |
   | Peri | `docs/tracks/peri.md` has non-empty Organization, Person, Role and Evidence lines, and the evidence file exists |

   Missing items print as `MISSING`. With `--strict` the script exits 1 if any are missing.
2. Fill in each `docs/tracks/*.md` from the screenshots collected along the way (the phase exits name them).
3. Take the final screenshots now if any are missing: Cursor on a subphase, the Grok Bot automation and a report, the Atlas collections, the Bedrock model in use, the run panel, a live hint, the course page, the tutor report.

**Acceptance**
- [ ] **P8.3-AC1** — `pnpm check:tracks` prints no `MISSING` for the tracks being entered.
- [ ] **P8.3-AC2** — `tracks.md` §0 has an answer beside every question, and any answer that changes the plan has been acted on.
- [ ] **P8.3-AC3** — The submission checklist in `tracks.md` §10 lists exactly the tracks being entered.

---

### P8.4 — Demo hardening

**Goal.** The demo cannot be derailed by anything foreseeable.

**Build.**
1. **Demo mode** (`?demo=1`): turns on `AUTO_HINT`, hides the dev toolbar, thickens ink slightly for a projector, and adds a **Reset demo** control that clears the demo problems' strokes and restores the seeded history so each run starts the same.
2. **Input device.** Try every device available: a touchscreen laptop, a drawing tablet, a tablet with a stylus, a mouse. Write the missing-`dx` work with each and run it as a hint. Choose the device whose handwriting the model reads most reliably. Then write the demo work with that device five times and record how many hints landed on the right clusters.
3. **Warm-up.** A `scripts/warm.ts` that sends one hint request for the demo problem so that the prompt cache and connections are warm. Run it two minutes before presenting.
4. **Offline kit.** Confirm `STORE=memory MOCK_LLM=1 pnpm start` runs the journey with no network, using recorded replies for the two demo problems. This is for a dead network only. If it is ever used in front of judges, say so: "the venue network is down, so these two replies are recordings of the real model from an hour ago".
5. **Pre-flight list** in `scripts/preflight.md`: charger; device paired and charged; browser zoom; do-not-disturb on; `pnpm smoke` green; warm-up run; confirmed source snapshot cached and demo day recorded; the course already ingested; the recorded agent run loaded; the backup video open in a tab; a phone hotspot ready.
6. **Known-bad handwriting.** Find out what breaks it and simply do not do that on stage. Candidates: tiny writing, cursive, side work without a divider (it shares lines with the main work), and strokes written out of order (going back to an earlier line). Writing across rows and tall fractions are handled by the free layout (P2.5a).

**Acceptance**
- [ ] **P8.4-AC1** — **Reset demo** returns to an identical start. *Verify:* e2e test: draw, reset, state equals the seeded state.
- [ ] **P8.4-AC2** — With the chosen device, at least four of five live hints on the demo problem land on the right clusters. *Verify:* the tally in `status.md`.
- [ ] **P8.4-AC3** — The offline kit runs the journey with Wi-Fi off. *Verify by hand.*
- [ ] **P8.4-AC4** — `scripts/preflight.md` exists and has been walked through once.

---

### P8.5 — README and project description

**Goal.** The written submission: what a judge reads when the team is not in front of them.

**Build.**
1. **`README.md`** sections, in this order:
   - *Albert — Turns you into Einstein.* One paragraph and the hero screenshot (`docs/tracks/img/hint-live.png`).
   - **What it does** — the four ideas in four short paragraphs.
   - **Who it's for** — a student doing homework without a tutor at hand; and the tutor or teaching assistant who sees them once a week.
   - **How it works** — the system map from the main plan §2.2 and the two-path table.
   - **Run it** — prerequisites, `.env.local` from `.env.example`, `pnpm install`, `pnpm seed:demo`, `pnpm dev`; and the no-keys way: `STORE=memory MOCK_LLM=1 pnpm dev`.
   - **How we built it** — stack; then the paragraph on Cursor and Grok Bot.
   - **What's next**, **Credits and licences** (the Socratic tutor skill, MIT; the handwriting font, OFL; MathJax; roughjs; perfect-freehand).
2. **Project description** for the submission site, written from this skeleton. Keep each part to a short paragraph.
   - **Inspiration.** AI tutors live in chat boxes and teach methods the class has not reached. Math homework happens by hand.
   - **What it does.** The journey in five sentences.
   - **How we built it.** Next.js and TypeScript; our own stroke canvas; Claude on Amazon Bedrock for reading handwriting and writing hints; a deep agent built with LangChain's Deep Agents for course ingestion and study planning; MongoDB Atlas for all data and the agent's memory; a pinned GitHub manifest and cached PDFs for the course. *We built with Cursor as our coding agent, working from a written plan in the repo, and a Grok Bot automation that re-ran our checks on `main` every hour and told us when it broke.*
   - **Forward Deployed (Peri).** Business name; person and role; what they told us; what we changed; the evidence.
   - **Challenges.** Pointing at the right symbol (solved by numbered clusters); keeping hints from giving answers (the ladder plus server-side checks); making the ink look written.
   - **Accomplishments.** The eval numbers from `fixtures/eval/last-run.json`: row accuracy, the 100% no-answer result, median time to first ink.
   - **What we learned.** One or two honest sentences.
   - **What's next.** Canvas support through an institution-approved integration; drill mode; more subjects.
3. Use real numbers. Copy them from `status.md` and `last-run.json`; do not round up.

**Acceptance**
- [ ] **P8.5-AC1** — `README.md` has every section and the run instructions work on a clean clone. *Verify:* a teammate who did not write it follows "Run it" with the no-keys way and reaches the work page.
- [ ] **P8.5-AC2** — The description names each entered track's requirement explicitly: the model on Bedrock, the deep agent's parts, Atlas, Cursor and Grok Bot, and the three Peri items.
- [ ] **P8.5-AC3** — Every number in the description appears in `status.md` or `last-run.json`.

---

### P8.6 — The demo

**Goal.** Three minutes that show all four ideas, rehearsed, with a recording as backup.

**The script.** Adjust the times once the real demo length is known (`tracks.md` C6).

| Time | On screen | Say |
|---|---|---|
| 0:00 | The work page, empty | "AI tutors make you type your problem into a chat box, then teach you a method your class never covered. Albert works on the page, in your handwriting, the way your professor taught it." |
| 0:15 | Import GitHub course → Calculus II → the run panel replaying | "You connect your course. A deep agent reads every unit: one sub-agent per unit, each writing a teaching card of the methods, notation and examples your teacher uses. This is a recording of that run, sped up." |
| 0:35 | Worksheet 3, problem 1. Write three rows, dropping `dx`. Stop | "Now I just do my homework. …And I'm stuck." |
| 0:55 | The mark, then the circle, arrow and question | "Albert noticed the pause. It circled the exact symbol, and it asked me a question. It didn't give me the answer. And it's pointing me to Lecture 9, where my professor taught this step." |
| 1:20 | **More help**, then fix the row, **Check** | "If I need more, the next tap names the step. Only the third writes it. …Correct." |
| 1:40 | Problem 4. **I'm stuck** | "This one is faster with partial fractions. But my class doesn't reach that until Unit 4, and Albert knows. So it helps me with what I've been taught." |
| 2:05 | **End session** → the course page | "When I finish, Albert updates what it knows about me. Levels are computed from evidence, not vibes: this one moved because I needed a hint. And my plan now says: you dropped dx; redo these before Thursday." |
| 2:30 | The tutor report | "We asked *[name, role, organization]* what would make this useful to them. They said *[finding]*. So their tutors get this: exactly where each student got stuck." |
| 2:45 | The architecture slide or the README diagram | "Claude on Amazon Bedrock reads the handwriting. LangChain's Deep Agents runs the course agent. Everything, including the agent's memory, lives in MongoDB Atlas. Albert: turns you into Einstein." |

**Build.**
1. Rehearse with a timer until it fits. One person writes, one talks, if the team has two.
2. Prepare answers to the questions judges will ask:
   - *Isn't this a cheating tool?* The ladder; rung 1 is always a question; server-side checks; the eval's 100% no-answer result; checks never reveal the answer.
   - *How do you know it read my handwriting right?* It shows what it read; ruled rows; the eval's reading accuracy.
   - *What if the notes are handwritten scans?* The reader is a vision model; every example label is checked against the transcribed source before it can be cited.
   - *Why not just ChatGPT with a photo?* No timing, no pointing, no course scope, no memory of the student.
   - *Does it work with Canvas?* The adapter interface is there; real Canvas access needs an institution-approved key; upload works anywhere today.
   - *What about privacy?* Only the student's own course materials are read; optional source tokens stay server-side; nothing is written back to the LMS.
3. Record the backup: a clean run of the full script, screen and voice, at the demo's resolution. Upload it unlisted and put the link in the README and the submission.

**Acceptance**
- [ ] **P8.6-AC1** — Three clean runs in a row on the demo machine, within the time limit. *Verify:* the three times noted in `status.md`.
- [ ] **P8.6-AC2** — The backup video exists, plays, and is linked. *Verify:* open the link in a private window.
- [ ] **P8.6-AC3** — Everyone on the team can answer the six questions. *Verify:* ask each other.

---

### P8.7 — Stretch goals

Only after G4 is passed and P8.1 is green. Take them in this order and stop at feature freeze. Each must leave `main` demoable.

| # | Goal | Why this order | Rough cost | Done when |
|---|---|---|---|---|
| 1 | **Voice.** Add an optional `speech` string to the reply's `hint` part (the hint in spoken words). Read it with the browser's built-in speech as the note is written. If the ElevenLabs category is offered, swap the voice | Cheap, audible in a noisy room, and a second prize category | 45 min | A hint is spoken in time with its writing, with a mute control |
| 2 | **A live link.** Deploy the app and point it at the same Atlas cluster. Run ingestion locally; the deployed app serves hints and pages | Judges may want to try it | 45 min | The journey works at the public address |
| 3 | **Drill mode.** The full Socratic loop on the canvas: Albert writes one question for the weakest subskill, the student answers by hand, Albert follows the skill's rules (narrower question when wrong, explain after repeated failure, re-test). A passed drill with an edge case can award level 5 | The deepest use of the Socratic skill, and the answer to "dictate how I'm doing" | 2–3 h | One subskill can be drilled from level 2 to level 4 by hand |
| 4 | **Atlas Vector Search.** Embed each worked example; on a hint, retrieve the closest example to the student's problem and pass its label and first step into the prompt | Strengthens the MongoDB entry and citation quality | 1.5 h | The rung 1 citation for Worksheet 3 problem 3 points to the `tan` example, found by search |
| 5 | **Single-stroke handwriting.** Replace the glyph wipe with real pen paths from a single-line font | Looks best, costs most | 2 h | Text draws stroke by stroke like the circle does |
| 6 | **Canvas adapter.** Only with a Canvas instance where a token can be created | Breadth | 2 h | The seed course loads from Canvas |

Not to be attempted this weekend: drawing over other desktop apps, accounts, grading, writing back to the LMS.

---

### P8.8 — Submit

**Goal.** Submitted early, with nothing missing.

**Build.**
1. Freeze at G5. From here, only bug fixes that a rehearsal exposed.
2. Tag the commit: `git tag hackprinceton-submission`.
3. Run the full gate:
   ```bash
   pnpm verify && pnpm e2e && pnpm smoke && pnpm eval:hints && pnpm check:tracks --strict
   ```
4. Fill in the submission form from `tracks.md` §10 and P8.5. Paste the Peri items. Opt in to each track being entered.
5. Have a second person read the submission page once it is saved: links work, video plays, tracks are right.
6. Walk through `scripts/preflight.md` before judging.

**Acceptance**
- [ ] **P8.8-AC1** — The full gate passes on the tagged commit. *Verify:* the output saved in `status.md`.
- [ ] **P8.8-AC2** — The submission is saved at least two hours before the deadline. *Verify:* the timestamp noted in `status.md`.
- [ ] **P8.8-AC3** — A second person has checked the live submission page.

---

## Phase exit — gate G6

- [ ] Submitted.
- [ ] Backup video linked.
- [ ] `status.md` is complete: every subphase ticked or marked cut, with the reason.
- [ ] Sleep before judging if there is any time left. A tired presenter costs more than a missing stretch goal.

Source evidence: distinguish verified synthetic golden checks from the real course import. Record the published manifest SHA/demo day; keep owner confirmation, publication and live smoke pending until actually verified.
