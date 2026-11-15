# Albert — Main Plan

> **Current release (user scope change, Nov 14):** [`current-scope.md`](./current-scope.md) overrides this file's product scope, phase dependencies and gates where they disagree. Study plans, re-planning, the skill map, the tutor report and gate G4 are out of this release; the PDF tutor (P5.8) is core.

> **Albert** · *Turns you into Einstein.*
> The tutor inside **Albert and Einstein Academy**, built for HackPrinceton Fall 2026 (Nov 13–15, 36 hours).

**Current scope (user, Nov 14):** PDF annotation editor + Learn this course + course-context, stroke-aware helper, with Pixie-inspired pointing and on-page explanation. Study plans, re-planning and progress/report dashboards are out of this release. Read [current-scope.md](./current-scope.md) first: it overrides the older journey, phase order, gates and out-of-scope statements below. PDF mode is core work now; a short typed question to the page helper is allowed. Existing contracts remain binding until changed with code and fixtures.

This is the document every person and every coding agent reads first. It explains what Albert is, why each piece exists, how the pieces fit, and which decisions are already made. It does not tell you what to type. The phase files do that:

| File | What it is |
|---|---|
| **`00-main-plan.md`** (this file) | The idea, the architecture, the decisions, the order of work |
| [`contracts.md`](./contracts.md) | The shared data shapes, routes, constants and env vars. Code must match it |
| [`tracks.md`](./tracks.md) | Every prize track, what its rules need, and where in the build that gets satisfied |
| [`decisions.md`](./decisions.md) | Each design decision with its reason and what would change it |
| [`status.md`](./status.md) | The live checklist. Update it as work is verified |
| [`phase-1-foundation.md`](./phase-1-foundation.md) … [`phase-8-ship.md`](./phase-8-ship.md) | The actual work: subphases, steps, acceptance criteria, how to verify each one |

If two documents disagree, `contracts.md` wins for data shapes and this file wins for everything else. Fix the losing document in the same commit.

---

## 1. What Albert is

Albert is a math tutor that works where students actually do math: on the page, by hand.

A student connects their course from their LMS. Albert reads the lecture notes and worksheets and learns how *this* teacher teaches *this* course: which methods, which notation, which worked examples. The student then opens a worksheet inside Albert and solves it by hand on a canvas. Albert watches the pen strokes. When the student gets stuck, Albert writes on the page next to their work, in red ink, the way a tutor leaning over their shoulder would: it circles the symbol that went wrong, draws an arrow, and writes a question.

Albert never opens with the answer. It asks a question first. If that isn't enough it names the next step, and only then does it write out one worked step. Everything it says uses only what the class has covered so far, in the teacher's own notation, and it points back to the lecture where the idea was taught.

Behind the page, an agent keeps track of how the student is doing on each skill in the course and builds a day-by-day study plan from what the pen strokes showed, then rewrites the plan after every session.

**One line for judges:** *AI tutors make you type your problem into a chat box and then teach you a method your class never covered. Albert works on the page, in your handwriting, the way your professor taught it.*

### 1.1 The four ideas

Every feature belongs to one of these four ideas. If a proposed feature belongs to none, it is out of scope.

| Idea | What it means | Where it is built |
|---|---|---|
| **Stroke-aware** | Albert reads pen strokes with their timing, not a finished picture. Pauses, erasing and crossed-out steps tell it you are stuck before you ask. Because it knows which strokes form which symbol, it can point at the exact symbol | Phase 2 (capture, stuck detection), Phase 4 (writing back) |
| **Scope-aware** | Albert only uses methods and notation the class has covered up to the worksheet you are on. If a later method would be easier it says so, says when you will learn it, and teaches the in-scope way | Phase 5 (LMS), Phase 6 (teaching cards), Phase 3 (hints obey the card) |
| **Socratic** | A question first, then the next step, then one worked step. Never the final answer on the first tap. Adapted from Jane Street's `socratic-tutor` skill | Phase 3 (hint ladder), Phase 7 (skill map) |
| **Adaptive** | A course agent tracks each skill, tells you how you are doing, and plans what to practice next from the evidence in your work | Phase 6 (course agent, study plan), Phase 7 (progress) |

### 1.2 The user journey

This is the path the demo walks. Each step names the phase that builds it.

1. **Connect.** The student imports the configured GitHub manifest. Albert lists the cached course. *(Phase 5)*
2. **Learn the course.** The student picks Calculus II. The course agent reads each unit's notes and worksheets and writes a *teaching card* per unit: methods, notation, worked examples, common mistakes, subskills. A panel shows the agent planning, delegating to sub-agents and saving cards. *(Phase 6)*
3. **Open a worksheet.** The student opens Worksheet 3 (trigonometric substitution). Each problem is shown with ruled rows to work in. *(Phase 5, Phase 2)*
4. **Work by hand.** The student writes one step per row with a stylus, finger or mouse. *(Phase 2)*
5. **Get stuck.** The student drops `dx` when substituting, then stalls. The browser notices the pause. A small "Need a hint?" mark appears in the margin. *(Phase 2)*
6. **Albert writes.** The student taps it. Within about three seconds Albert circles the integrand, draws an arrow from the margin and writes *"You replaced x. What does dx become?"* in red, with *"Lecture 9, Step 2"* beneath it. *(Phase 3, Phase 4)*
7. **Climb the ladder.** A second tap names the next step. A third writes one worked step. *(Phase 3)*
8. **Stay in scope.** On a problem where partial fractions would be quicker, Albert says that method arrives in Unit 4 and guides the student with trig substitution instead. *(Phase 3, Phase 6)*
9. **Check.** The student taps "Check" on a finished problem. Albert says whether it is right without revealing the answer. *(Phase 3)*
10. **See how you are doing.** The course page shows a skill map and a study plan: *"You dropped dx twice on Worksheet 3. Redo problems 2 and 5 before Thursday."* *(Phase 6, Phase 7)*
11. **Tutor report.** A tutor or teacher can open a one-page report of where the student got stuck. *(Phase 7)*

---

## 2. Architecture

### 2.1 Two paths with different rules

Albert has a **hot path** and a **slow path**. Keeping them separate is the most important structural decision in the project.

| | Hot path | Slow path |
|---|---|---|
| What | A hint or a check while the student is working | Reading a course, building cards, planning study |
| Budget | First ink on the page in about 3 seconds | Minutes are fine |
| Shape | **One** streaming model call, no agent loop | A **deep agent** with planning, sub-agents, files and memory |
| Built with | A single chat-model call with one structured reply (`src/lib/tutor`) | `deepagents` on the LangGraph runtime (`src/lib/agent`) |
| Reads | The teaching card from the database | The LMS, PDFs, session history |
| Writes | Hint events, evidence events | Teaching cards, worksheets, study plans, memory notes |

The hot path never waits on the agent. The agent does its work ahead of time and stores the results; the hot path only reads them. An agent framework in the hot path would cost seconds per hint and would add nothing, because a hint is a single judgement.

### 2.2 System map

```
┌───────────────────────────── Browser ─────────────────────────────┐
│  Work page                                                        │
│  ┌──────────────────────────────┬─────────────────────────────┐   │
│  │ Student column               │ Albert's margin             │   │
│  │ problem statement            │                             │   │
│  │ ─ row 1 ─ strokes ────────   │                             │   │
│  │ ─ row 2 ─ strokes ──(○)◄─────┼── red ink: question + cite  │   │
│  │ ─ row 3 ─                    │  [Need a hint?]             │   │
│  └──────────────────────────────┴─────────────────────────────┘   │
│  canvas/  capture → rows → clusters → stuck detector → snapshot   │
│  ink/     layout → MathJax SVG + font paths → animated marks      │
└───────────────┬───────────────────────────────────▲───────────────┘
                │ HintRequest (images + clusters)    │ HintEvent stream (NDJSON)
                ▼                                    │
┌──────────────────────── Next.js server ───────────┴───────────────┐
│  HOT PATH   /api/hint, /api/check                                 │
│    tutor/  scope bundle + Socratic ladder → one streaming call    │
│  SLOW PATH  /api/agent/ingest, /api/agent/replan                  │
│    agent/  deep agent: todos · sub-agents · files · memory        │
│  lms/      GitHubAdapter · UploadAdapter (fallback)   │
│  progress/ evidence → skill levels (plain code, no model)         │
│  db/       Repo interface → Mongo (default) or in-memory (tests)  │
│  llm/      provider adapter: bedrock (default) · anthropic · xai  │
└───────┬───────────────────────┬───────────────────────┬───────────┘
        ▼                       ▼                       ▼
  Amazon Bedrock         MongoDB Atlas              GitHub repository
  (Claude models)   (data + agent checkpoints)  (web services REST)
```

### 2.3 Modules

All paths are under `src/`. Each module has one job and talks to the others only through the types in `contracts.md`.

| Module | Job | Runs in | Phase |
|---|---|---|---|
| `lib/contracts` | zod schemas and inferred types. The single source of truth for data shapes | both | 1 |
| `lib/llm` | Chooses the model provider. One function returns a chat model for a role: `hint`, `agent` or `reader` | server | 1 |
| `lib/db` | `Repo` interface with a Mongo implementation and an in-memory one | server | 1 |
| `lib/canvas` | Stroke capture, row assignment, clustering, stuck detection, snapshot rendering, record and replay | browser | 2 |
| `lib/tutor` | Builds the hint prompt, calls the model, validates and streams the hint | server | 3 |
| `lib/ink` | Places and draws Albert's handwriting and marks | browser | 4 |
| `lib/lms` | `CourseSourceAdapter` interface and its implementations | server | 5 |
| `lib/agent` | The course agent: tools, sub-agents, skills, memory | server | 6 |
| `lib/progress` | Turns evidence events into skill levels | server | 7 |
| `app/` | Pages and API routes | both | all |

Supporting folders at the repo root: `skills/` (agent skills, including the adapted Socratic tutor), `seed/` (the demo course content), `fixtures/` (recorded stroke sessions, eval cases, mock model replies), `scripts/` (verify, smoke, eval, agent CLI), `tests/`.

### 2.4 How a hint works

This is the hot path in full. Phases 2, 3 and 4 each build one third of it.

1. **Capture.** Every pointer movement becomes a point `{x, y, t, p}`. Points form strokes. Each stroke is assigned to a ruled row by where most of its ink falls.
2. **Cluster.** Within a row, strokes that sit close together horizontally are grouped into *clusters*, roughly one symbol or term each. Each cluster gets a number.
3. **Detect.** A pure function watches the event stream for four signals: a long pause, repeated erasing in one row, a crossed-out step, or a tap on "I'm stuck".
4. **Snapshot.** The browser renders the problem's rows up to the stuck row into an image, and draws the small cluster numbers above the ink.
5. **Ask.** The browser sends the image, the cluster list, the rung and the hint history. The server adds the *scope bundle* for this problem: the unit's teaching card, the methods covered so far and the names of methods not yet covered.
6. **Judge.** One model call reads the handwriting, finds the first wrong step, and replies with one structured answer in four parts, written in order: the reading, the diagnosis, the marks, the hint. It names the wrong symbol by **cluster number**, never by pixel coordinates.
7. **Stream.** The server forwards each part as soon as it is complete. The circle can start drawing before the hint text exists.
8. **Draw.** The browser looks up the cluster's bounding box from its own stroke data, draws a rough circle and an arrow, and writes the hint in the margin at the stuck row's height.

The model decides *which symbol*. The browser decides *where on the page*. That split is what makes the pointing accurate: positions come from stroke coordinates the browser already has, and the model is never asked to guess a bounding box.

### 2.5 How the course agent works

This is the slow path. Phase 6 builds it.

The course agent is a deep agent. It has two jobs, each started by one request.

**Ingest a course.** The agent writes a todo list, fetches the course outline from the LMS, and hands each unit to a `unit-reader` sub-agent. Each sub-agent reads that unit's notes and returns a teaching card. A `worksheet-mapper` sub-agent extracts each worksheet's problems and tags them with the subskills they exercise. The tools that save a card or a worksheet refuse anything that breaks the rules (every worked example must be found in the source text, every problem must map to a subskill) and hand the problems back, so a sub-agent repairs its own output. A `card-checker` sub-agent then re-reads each unit beside its saved card and reports anything unfaithful to the teacher's notes, for one repair round. The agent saves a scope summary to its file system and hands the first study plan to a `planner` sub-agent.

**Re-plan.** After a study session ends, the agent reads the new evidence, the current skill levels, the previous plan and its own notes about the student. It rewrites the plan, writes a two-sentence "how you're doing" summary, and adds anything it learned about the student to its memory.

The agent's tools are thin wrappers over ordinary functions. If the agent framework misbehaves at 3 a.m., `scripts/ingest-flat.ts` calls the same functions in a plain loop and produces the same cards. The demo cannot be blocked by the framework.

### 2.6 Data

MongoDB Atlas holds everything: the LMS connection, courses, teaching cards, worksheets, cached files, sessions, stroke batches, hints, evidence, skill levels, study plans, agent runs, and the agent's own checkpoints and memory. The data is nested JSON with no joins that matter, which is the shape a document database is built for. See [`decisions.md`](./decisions.md) D6 and the collection list in [`contracts.md`](./contracts.md) §9.

A second, in-memory implementation of the same `Repo` interface exists for unit tests and for running the demo with no network.

---

## 3. Decisions already made

The reasons are in [`decisions.md`](./decisions.md). Do not reopen these during the build unless a fallback trigger in that file fires.

| # | Decision |
|---|---|
| D1 | One Next.js app in TypeScript at the repo root. No monorepo, no separate Python service |
| D2 | Our own canvas using Pointer Events and `perfect-freehand`. Not tldraw |
| D3 | Math is rendered with MathJax's SVG output. KaTeX cannot output SVG |
| D4 | Albert writes in a reserved margin column to the right of the student's rows |
| D5 | The model points at symbols by cluster number. The browser owns all coordinates |
| D6 | MongoDB Atlas is the database |
| D7 | Claude on Amazon Bedrock is the default model provider, behind an adapter. The direct Anthropic API is the fallback. Grok is an optional third provider for the agent only |
| D8 | `deepagents` runs the course agent. It is never in the hint path |
| D9 | Pinned GitHub manifests are the initial source; manual upload is the fallback; LMS sync is deferred |
| D10 | Scope is relative to the worksheet: its unit and every earlier unit are covered, later units are not |
| D11 | Skill levels are computed by plain code from evidence events. The model never sets a level |
| D12 | A stuck signal shows a "Need a hint?" mark. Albert writes only after a tap, except in demo mode |
| D13 | Annotations are drawn with `roughjs`, so circles and arrows are true pen strokes that animate |
| D14 | One demo student, no sign-up flow. The optional GitHub token stays in server environment |
| D15 | Everything the model returns is validated with zod before it is used |
| D16 | The Jane Street Socratic skill is adapted: its rules shape the hint ladder and the level rule; its full course loop is used only in stretch-goal drill mode |
| D17 | The name is Albert and the tagline is "Turns you into Einstein." |

---

## 4. Tracks

The full rules, evidence lists and pitch lines are in [`tracks.md`](./tracks.md). The summary:

| Track | In or out | What satisfies it | Phase |
|---|---|---|---|
| **Education** (required main track) | In | The product itself | all |
| **Best Overall** | Automatic | The demo | 8 |
| **Best Rookie** | In, if this is your first hackathon | Opt in on the submission form | 8 |
| **Amazon — Best Practical AI Innovation** | In | Agentic course agent, adaptive plan, real use case, polished experience. Claude runs on Bedrock | 1, 3, 6, 8 |
| **LangChain — Best use of deepagents** | In | The course agent uses planning, sub-agents, files, skills and memory, and its run is visible in the app | 6 |
| **Peri — Forward Deployed** | In | A real tutoring business or student organization consulted during the event, with name, role and evidence, plus the tutor report they asked for | 7, 8 |
| **MLH — Best Use of MongoDB Atlas** | In | Atlas stores all data and the agent's checkpoints | 1, 6 |
| **MLH — SpaceXSI raffle** | In | Built with Cursor as the coding agent, with a Grok Bot automation in the workflow, both described in the write-up | 1, 8 |
| MLH — ElevenLabs | Stretch only | Voice narration of hints | 8 |
| CoStar, Arlequin, Physical AI, Hardware | Out | Not a fit. Do not spend time here | — |

Two track facts change how the product is built, so they are stated here as well:

- **The SpaceXSI category is about the build process, not the product's model.** As MLH publishes it, it asks for Cursor as the coding agent and a Grok Bot automation in the workflow. Albert's reasoning stays on Claude. Confirm the wording on the HackPrinceton submission page; if it differs, see `tracks.md` §8.
- **Peri needs a real organization consulted during the hackathon.** Without a named person and evidence the entry is ineligible. Phase 8 schedules this for Saturday daytime.

---

## 5. Order of work

### 5.1 Phases

| Phase | Name | Produces | Depends on |
|---|---|---|---|
| 1 | [Foundation](./phase-1-foundation.md) | A running app, contracts in code, model and database reachable, the verify loop, the dev workflow for the tracks | — |
| 2 | [Canvas](./phase-2-canvas.md) | Stroke capture with timing, rows, clusters, stuck detection, snapshots, record and replay | 1 |
| 3 | [Tutor brain](./phase-3-tutor-brain.md) | `/api/hint` and `/api/check`: read, diagnose, Socratic ladder, scope rules, streaming, an eval set | 1 (2 for live input) |
| 4 | [Ink](./phase-4-ink.md) | Albert's handwriting and marks drawn on the canvas | 2 (3 for live hints) |
| 5 | [LMS](./phase-5-lms.md) | Pinned GitHub manifests and cached PDFs, the adapter, upload fallback, the worksheet page | 1 |
| 6 | [Course agent](./phase-6-course-agent.md) | Teaching cards, worksheet maps, scope bundles, the study plan, re-planning, the agent run panel | 1, 5 |
| 7 | [Progress](./phase-7-progress.md) | Evidence events, skill levels, the course page, the tutor report | 3, 6 |
| 8 | [Ship](./phase-8-ship.md) | End-to-end tests, track evidence, the Peri visit, the demo, the submission, stretch goals | all |

### 5.2 Gates

Time is counted from the start of hacking (`T`). Fill in the real clock times in [`status.md`](./status.md) once the schedule is announced. A gate is passed only when its check has been run and seen to pass.

| Gate | By | You can show | Check |
|---|---|---|---|
| **G0** | T+2h | The app runs, `pnpm verify` passes, the model and database answer | Phase 1 exit |
| **G1** | T+8h | Write on the canvas, get stuck, see a hint arrive from a recorded reply | Phase 2 exit and P3.1 |
| **G2** | T+16h | A **live** hint, drawn in red ink with a circle and arrow, on a hand-written teaching card | Phases 3 and 4 exit |
| **G3** | T+22h | Connect GitHub, watch the agent build cards, get a hint that cites a real lecture | Phases 5 and 6 (ingest) exit |
| **G4** | T+28h | Skill map, study plan, re-plan after a session, tutor report | Phases 6 (plan) and 7 exit |
| **G5** | T+31h | **Feature freeze.** Only fixes, track evidence and rehearsal after this | P8.1 to P8.4 |
| **G6** | T+34h | Submitted, with a recorded backup run | Phase 8 exit |

From G2 onward, `main` must always be able to run the demo. Work on branches and merge only what passes `pnpm verify`.

### 5.3 If you are behind

Cut in this order. Each cut names what replaces it, so the demo still works.

| If this gate is late | Cut | Replace with |
|---|---|---|
| G1 | Cross-out and erase-loop detection | Pause detection and the "I'm stuck" button only |
| G2 | Handwriting level 1 (per-glyph paths) | Level 0: a handwriting web font revealed with a wipe. Circles and arrows still animate |
| G2 | Streaming | One JSON reply, drawn when it arrives |
| G3 | Live GitHub in the demo | The upload fallback with the seed PDFs. Show the GitHub connect screen only if it works |
| G3 | The agent framework, only if it is blocking | `scripts/ingest-flat.ts` for cards, then return to the agent for the study plan |
| G4 | Re-planning | The first study plan only |
| G4 | The tutor report | A screenshot of the skill map in the Peri evidence |
| always | Voice, drill mode, Canvas, vector search, desktop overlay | Nothing. These are stretch goals |

Never cut: the hint written on the page (G2), scoped hints from a teaching card, and the Peri conversation. The first two are the product. The third costs an hour and cannot be done after the event.

### 5.4 Lanes for a team

With one person, follow the phases in order. With more, split like this after Phase 1. The contracts file is what lets lanes work in parallel: Lane B builds against recorded snapshots and Lane A builds against recorded hint replies until both are real.

| Lane | Owns | First deliverable |
|---|---|---|
| A — Page | Phases 2 and 4 | Recorded stroke sessions in `fixtures/sessions/` |
| B — Brain | Phase 3 | `/api/hint` passing the eval set on recorded snapshots |
| C — Course | Phases 5 and 6 | The verified synthetic seed, a pinned real course source and one teaching card |
| D — Proof | Phase 7, Phase 8, the Peri visit, track evidence | The outreach message sent on Friday night |

### 5.5 Building alone

The phase time boxes add up to about 44 working hours. The gates assume two or more lanes running in parallel, by people or by coding agents working from the phase files. One person working alone cannot do every subphase in 36 hours, so decide the cuts **before starting**, not at 3 a.m. This is the solo path, about 30 working hours, and it still shows all four ideas:

| Phase | Do | Skip | Hours |
|---|---|---|---|
| 1 | All of it | — | 2 |
| 2 | P2.1, P2.2, P2.3, P2.5, P2.7. From P2.6: pause and the "I'm stuck" button only | P2.4 undo and redo (keep "Clear row"), erase-loop and cross-out detection, P2.8 beyond one flush on session end | 4 |
| 3 | P3.1, P3.2, P3.3, P3.4 with eight cases, P3.7 | P3.5 (use one model), P3.6 streaming, most of P3.8 | 5 |
| 4 | P4.1 to P4.4 at ink level 0 | P4.5, P4.6 except the "Albert read" tooltip | 4 |
| 5 | P5.1, P5.2, P5.3, P5.5, P5.6 | P5.4 unless GitHub is blocked (then do it *instead of* P5.2 and P5.3), P5.7 | 4 |
| 6 | P6.1, P6.2, P6.3, P6.4 without `card-checker`, P6.5, P6.7. P6.6 as a plain log list | P6.8 memory notes (keep the re-plan itself), run-panel replay | 5 |
| 7 | P7.1, P7.2, P7.3 | P7.4 unless entering Peri (then build the report and skip the "what changed" markers), most of P7.5's polish | 3 |
| 8 | P8.1 by hand only, P8.2, P8.3, P8.5, P8.6, P8.8 | P8.4 beyond the device choice and the pre-flight list, all of P8.7 | 4 |

Sleep at least four hours. Mark every skipped subphase `cut (solo path)` in `status.md` on Friday night so that nobody, human or agent, picks it up by accident.

---

## 6. How work gets verified

"It works" means a check was run and its result was seen. Nothing is marked done on the strength of having been written.

### 6.1 Five layers

| Layer | What it proves | Command | Uses the network |
|---|---|---|---|
| 1. Unit tests | Pure logic is right: row assignment, clustering, stuck detection, layout, skill levels, plan validation, LMS parsing | `pnpm verify` | No |
| 2. Contract tests | Every fixture and every API reply parses against its zod schema | `pnpm verify` | No |
| 3. Replay end-to-end | A recorded stroke session played into the real page produces the right marks, with recorded model replies | `pnpm e2e` | No |
| 4. Live checks | The real model, database and LMS behave: hint quality and latency, ingestion against the seed course | `pnpm smoke`, `pnpm eval:hints`, `pnpm agent:ingest` | Yes |
| 5. Demo run | The three-minute demo script works three times in a row on the demo machine | by hand, Phase 8 | Yes |

Layers 1 to 3 run without a network and without spending tokens, so they can be run constantly by people, by agents and by the scheduled Grok Bot. Layer 4 is run at each phase exit. Layer 5 is run after feature freeze.

### 6.2 Acceptance criteria

Every subphase lists acceptance criteria with ids such as `P2.3-AC1`. Each one states how to verify it: a command and the output to expect, a named test, or a manual step and what you should see. The rules:

1. A subphase is done when **every** one of its criteria has been verified and `pnpm verify` passes.
2. Record the result in [`status.md`](./status.md): tick the subphase, add the commit and a short note of what was run.
3. If a criterion cannot be met, do not weaken it silently. Use the fallback written in the subphase, or change the criterion in the plan in the same commit and say why in `status.md`.
4. If you are blocked for more than 30 minutes, take the fallback.

### 6.3 Recorded fixtures

Two kinds of recording make offline verification possible, and both are created early on purpose.

- **Stroke sessions** (`fixtures/sessions/*.json`). The canvas can export what was written and replay it later with the original timing. Phase 2 builds this first. Every later phase tests against these recordings.
- **Model replies** (`fixtures/llm/*.json`). With `MOCK_LLM=1` the hint route returns a recorded reply. The end-to-end tests and the offline demo use this.

---

## 7. Risks

| Risk | Sign | Response |
|---|---|---|
| The model misreads messy handwriting | Wrong row or symbol in `pnpm eval:hints` | Ruled rows, one step per row. Show what Albert read. Demo with neat writing. Compare models and image modes in P3.5 |
| A hint takes too long | First ink later than 3 seconds at the median | Send only the stuck problem's rows. Stream the reply part by part. Cache the system prompt and card. Fall back to a faster model |
| Albert gives the answer away | An eval case fails the "no answer on rung 1" check | The ladder, a server-side guard on rung 1 and 2, and the eval check. Judges in Education will ask |
| Handwriting animation eats the schedule | P4.3 not done by its time box | Level 0 rendering is acceptable for the demo. Circles and arrows carry the effect |
| Bedrock access or quota is not ready | The model ping in P1.4 fails | Switch `LLM_PROVIDER=anthropic`. Decide within 30 minutes |
| The deep agent API differs from this plan | Type errors against the installed package | Read the current docs first (links in §9). Tools are plain functions, so the flat script still works |
| GitHub is unavailable or quota-limited | Source import fails | Use an already cached snapshot or the upload fallback |
| Venue Wi-Fi fails during the demo | — | `STORE=memory`, `MOCK_LLM=1`, seeded cards, and a recorded backup video |
| Stuck detection interrupts thinking | Testers find the mark annoying | It is only a mark, never unprompted writing. Tune the pause threshold in P2.5 |
| Scope is lost in 36 hours | A gate is missed | The cut list in §5.3. Feature freeze at G5 is not negotiable |

---

## 8. Out of scope

Stated so that nobody builds them by accident.

- A chat box. The student answers Albert by writing the next line.
- Drawing over other desktop apps. Albert writes on its own canvas only.
- Grading, submitting work back to the LMS, or writing anything to the LMS.
- Accounts, classes, teacher dashboards beyond the one-page tutor report.
- Subjects other than the seed Calculus II course for the demo. The design is general; the demo is not.
- Canvas, Blackboard, Google Classroom as working integrations. The adapter interface makes them possible later.

---

## 9. References

Read the current page before coding against any of these. Libraries in this area change quickly and this plan was written on Nov 13, 2026.

| Topic | Where |
|---|---|
| Deep Agents for JavaScript | https://docs.langchain.com/oss/javascript/deepagents/overview and https://docs.langchain.com/oss/javascript/deepagents/customization |
| Deep Agents API reference | https://reference.langchain.com/javascript/deepagents/types/CreateDeepAgentParams |
| LangGraph MongoDB checkpointer | https://www.mongodb.com/docs/atlas/ai-integrations/langgraph-js/ and https://npmjs.com/package/@langchain/langgraph-checkpoint-mongodb |
| Claude on Bedrock, model ids | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html |
| GitHub contents and commits | https://docs.github.com/en/rest/repos/contents and https://docs.github.com/en/rest/commits/commits |
| MathJax SVG output | https://docs.mathjax.org/en/latest/output/svg.html |
| Socratic tutor skill (MIT) | https://github.com/janestreet/agent_skills |
| MLH prize categories | https://www.mlh.com/events/prizes |
| Grok Bot | https://docs.x.ai/grok-bot/overview |
| Cursor rules and `AGENTS.md` | https://cursor.com/docs/rules |
