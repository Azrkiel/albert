# Phase 6 — Course agent

**Purpose.** The deep agent that learns a course and plans a student's study. It reads every unit's notes, writes a teaching card per unit, maps worksheet problems to skills, checks its own work, and builds and rebuilds a study plan from evidence. This is the producing half of *scope-aware*, all of *adaptive*, and the LangChain track.

**Done looks like.** Press **Learn this course** and watch a panel show the agent planning, handing units to sub-agents and saving cards. Afterwards a hint on Worksheet 3 cites "Lecture 9" from a card the agent wrote, and the course page shows a study plan. End a session and the plan changes.

| | |
|---|---|
| Depends on | Phase 1, Phase 5 (a course to read). P6.8 needs Phase 7's evidence |
| Unblocks | Real scope for hints, Phase 7's course page |
| Time box | 8 hours (ingest by **G3** at T+22h; plan and re-plan by **G4** at T+28h) |
| Lane | C — Course |

Read first: [`00-main-plan.md`](./00-main-plan.md) §2.5, [`contracts.md`](./contracts.md) §6, §8, [`decisions.md`](./decisions.md) D8, D11, D15, D16.

**Read the current docs before writing agent code.** The API names below are from the Deep Agents JavaScript documentation and reference on Nov 13, 2026. This library moves quickly. Open these pages, and trust the installed package's types over this file:
- https://docs.langchain.com/oss/javascript/deepagents/overview
- https://docs.langchain.com/oss/javascript/deepagents/customization
- https://reference.langchain.com/javascript/deepagents/types/CreateDeepAgentParams

```
src/lib/agent/
  functions/
    read-file.ts        # readCourseFile
    extract-card.ts     # extractTeachingCard, validateCard
    extract-worksheet.ts# extractWorksheet, validateWorksheet
    plan.ts             # validatePlan
  tools.ts              # thin tool wrappers over functions/
  subagents.ts          # unit-reader, worksheet-mapper, card-checker, planner
  agent.ts              # createCourseAgent
  runs.ts               # runIngest, runReplan → AgentEvent stream
  events.ts             # agent stream → AgentEvent
skills/
  teaching-card/SKILL.md
  study-plan/SKILL.md
  socratic-tutor/SKILL.md   # vendored, MIT, with LICENSE.md
scripts/agent-ingest.ts  scripts/agent-replan.ts  scripts/ingest-flat.ts  scripts/check-ingest.ts
```

**The design rule for this phase.** *The agent decides and delegates; plain functions do the work; save tools refuse bad output.* Every tool is a thin wrapper around a tested function. Every `save_*` tool validates what it is given and, when the input is wrong, returns the list of problems as its result so the agent can fix them and try again. That gives the agent a real self-correction loop, and it means nothing invalid can reach the database no matter what the model does.

---

### P6.1 — The functions, without any agent

**Goal.** Cards and worksheets can be produced by a plain script. The agent will orchestrate these same functions; if the agent is ever the problem, the script is the way out.

**Build.**
1. `readCourseFile(fileId): Promise<{ text: string; pages: number }>`
   - Get the bytes from the `Repo` only. Missing bytes require an explicit source reimport; ingestion and tutoring must not fetch GitHub.
   - Send the PDF to `getChatModel("reader")` as a document content block with the instruction: *transcribe this document faithfully to Markdown, with LaTeX for all math; keep headings, example labels and step labels exactly as written; mark page breaks as `--- page N ---`; do not summarise.*
   - Cache the result in the `Repo` and set `textCacheId`. A second call returns the cache without a model call.
   - If the provider rejects PDF blocks, rasterise the pages to PNG and send them as images. Check the provider's document size and page limits first; the seed PDFs are kept small for this reason.
2. `extractTeachingCard(args: { unit, fileTexts, syllabusText, taught: boolean }): Promise<TeachingCard>`
   - One structured-output call (`withStructuredOutput` with the card schema minus ids).
   - Code, not the model, assigns ids: `${unitId}.m1`, `${unitId}.s1`, … and attaches `fileId`s.
   - A unit with lecture files is `taught: true`. A unit with none (`taught: false`) is built from the syllabus only: its card holds a title, method **names** with empty `steps`, and subskills. Nothing else.
3. `validateCard(card, sources): string[]` returns a list of problems, empty when the card is good:
   - Taught units: at least one method with two or more steps; a non-empty notation table; at least one worked example; three to eight subskills; every pitfall's `subskillId` exists.
   - Every worked example's label (for example "Lecture 9, Example 2") is supported by the source: the lecture label and the example label both occur in that file's transcribed text, and `page` is within the file's page count. This is the check that stops an invented example from being cited to a student.
   - Every `teacherWrites` notation string occurs in the unit's text (compared ignoring whitespace TeX ignores, keeping the space after a control word, and treating `\dfrac`/`\tfrac` as `\frac`; the syllabus is not a notation source).
   - Units that are not taught: every method has zero steps, and there are no worked examples.
4. `extractWorksheet(args: { file, text, unit, coveredCards, dueAt }): Promise<Worksheet>` and `validateWorksheet(ws, cards): string[]`: at least one problem; unique labels; non-empty statements; every problem has at least one subskill, all from the worksheet's own unit or an earlier one.
5. `scripts/ingest-flat.ts` (`pnpm ingest:flat`): fetch the outline, loop over units and worksheets, call the functions, retry once on validation problems with the problems appended to the prompt, save through the `Repo`. Cards it saves are marked `builtBy: "flat_script"`.

**Acceptance**
- [x] **P6.1-AC1** — The validators catch what they should. *Verify:* `tests/unit/validate-card.test.ts` and `validate-worksheet.test.ts` start from the hand-written fixture cards (which pass) and break one thing at a time: an example labelled "Lecture 12, Example 9" that is not in the text; one-step methods; nine subskills; a pitfall with an unknown subskill; an upcoming card with steps; a problem mapped to an upcoming subskill.
- [x] **P6.1-AC2** — A lecture transcribes with its labels intact. *Verify:* `pnpm tsx scripts/read-file.ts fixtures/github/files/synthetic/pdf/unit-3/lecture-09.pdf` prints text containing "five-step recipe", "Step 2", "Example 2" and `\theta`.
- [x] **P6.1-AC3** — The second read is free. *Verify:* unit test with a counting fake model: two calls to `readCourseFile`, one model call.
- [x] **P6.1-AC4** — The flat script builds valid cards for the seed course. *Verify:* `pnpm ingest:flat -- --course <id>` then `pnpm tsx scripts/check-ingest.ts --course <id>` (golden checks 1–11 from P6.5) passes. Checks 12–13 print `skipped (agent run, P6.5)` until the P6.2+ agent run exists.


**P6.1 implementation / reproducible CLI.** These are plain functions and a flat loop only; P6.2+ is unchanged. The controlled five-unit synthetic course is the AC2/AC4 source; the separate real four-unit course is optional and does not carry the golden markers.

- AC2's old `seed/calc2/pdf/lecture-09.pdf` path was wrong. The recorded PDF is `fixtures/github/files/synthetic/pdf/unit-3/lecture-09.pdf`.
- P6.1 implements golden checks 1–11; 12–13 require an agent run and plan, so they explicitly print `skipped (agent run, P6.5)`. P6.5 extends the checker.
- `readCourseFile` reads Repo bytes only. The CLI imports an explicitly supplied local path first; a recorded synthetic path imports the recorded course offline. Missing Repo bytes request reimport.
- The installed `@langchain/aws` converter accepts `{ type: "document", document: { name, format: "pdf", source: { bytes }, citations: { enabled: true } } }`; a neutral name avoids interpreting a filename as instructions. Citations enable Bedrock's visual PDF processing. Anthropic's direct fallback receives its native base64 document block. No sampling parameters are set.
- [Bedrock Converse limits](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html): five documents, 4.5 MB each; twenty images, 3.75 MB / 8000 px each. This reader sends one PDF and applies a conservative local ceiling of 100 pages (actual count from `pdf-lib`), requesting a split/reimport above that ceiling. Provider/model limits may be lower. An explicit PDF/document rejection triggers local PNG rendering with `pdfjs-dist` and `@napi-rs/canvas`, then one page per reader call, at most 3000 px on its longest side. Auth/rate-limit/network failures do not trigger image calls. These dependencies make the fallback portable to Windows; `pdf-lib` is now a runtime dependency for page counts.
- `Repo.putText`/`getText` (contracts §9) store transcription strings separately from files, in memory or Mongo `texts`; `textCacheId` points to a versioned content-hash key. Page counts come from cached PDF bytes. A second read needs no model configuration or call. Empty/truncated output is never cached.
- Extraction uses one structured-output call per candidate and code-owned stable ids. The loop retries a validation/schema/index error once with problems in the prompt; after a second failure it reports the problems and saves no teaching artifacts from that run. All candidates validate before upserts. Cards have `builtBy: "flat_script"`; `ingestedAt` is set only after successful writes. Worksheet scope is its own unit plus earlier units: Worksheet 4 may map its own names-only Unit 4 subskills, while Worksheet 3 cannot use them.

For a persistent Repo already populated through the source API:

```sh
pnpm ingest:flat -- --course <snapshot-qualified-id>
pnpm tsx scripts/check-ingest.ts --course <snapshot-qualified-id>
```

For `STORE=memory`, reuse the P5.3 importer with a pinned **local recorded transport** (`--source synthetic`); GitHub is never contacted. `--course synthetic` is a CLI alias for that recorded snapshot id, which is printed. Explicit `--state` stores only this course's outline, original PDF bytes, text caches, cards and worksheets, parsed with the existing contracts. It stores no credentials or connection. The default for synthetic memory runs is `work/p6.1-synthetic.json`; this process-local store needs that state file across CLI invocations. Keep generated state out of commits. `--twice` verifies stable artifact ids/counts after the second ingestion. `--check` prints the golden checks after each run. The checker itself never calls a model.

```sh
STORE=memory pnpm ingest:flat -- --source synthetic --course synthetic --state work/p6.1-synthetic.json --check --twice
STORE=memory pnpm tsx scripts/check-ingest.ts --source synthetic --course synthetic --state work/p6.1-synthetic.json
```

**NEEDS HUMAN: P6.1-AC2 and AC4 when cloud credentials are absent.** After checking out this branch and installing dependencies, run the following in PowerShell from the repo root, with the existing reader/provider configuration in the sibling env file. Existing process environment takes precedence over `--env-file`, so the memory store is retained. No secrets need to be copied into this checkout. These are live model commands even though the course source import is offline:

```powershell
$env:STORE = "memory"
node --env-file=../albert-p1.4/.env.local --import tsx scripts/read-file.ts fixtures/github/files/synthetic/pdf/unit-3/lecture-09.pdf --state work/p6.1-synthetic.json
node --env-file=../albert-p1.4/.env.local --import tsx scripts/ingest-flat.ts --source synthetic --course synthetic --state work/p6.1-synthetic.json --check --twice
node --env-file=../albert-p1.4/.env.local --import tsx scripts/check-ingest.ts --source synthetic --course synthetic --state work/p6.1-synthetic.json
```

Record AC2's lines containing `five-step recipe`, `Step 2`, `Example 2`, and `\theta`; AC4 needs eleven passes, the two explicit skips, and the second-run no-duplicates line. A fresh native-PDF run plus a second ingest needs 29 logical calls including the shared AC2 read/cache, before repairs or provider retries; stop if live attempts would exceed the 30-call budget. The cloud implementation run used **zero** live calls. Do not tick P6.1 until live AC2/AC4 are observed.

**Live result (Windows, Nov 14).** AC2 and AC4 passed live; P6.1 is ticked. Evidence and the 42-attempt count are in `status.md`. The first live runs showed that exact-substring notation checks reject TeX spacing and `\dfrac` variants, so the comparison above was added. They also showed that the card prompt must say: avoid lists name standard alternative forms (for example `f'(x)` where the teacher writes Leibniz form); add a notation row for a variable letter that the unit's own files fix; pitfall `errorType` names the symbol; never take notation from the syllabus. Golden check 9 matches the singular "partial fraction" as well, per its "named like" wording.

---

### P6.2 — The agent skeleton

**Goal.** A deep agent that runs, remembers and streams, before it does anything useful.

**Build.**
1. Install `deepagents`, `langchain`, `@langchain/langgraph`, and `@langchain/langgraph-checkpoint-mongodb` at its **latest** version (versions up to 1.3.0 had an injection flaw).
2. `agent.ts`:
   ```ts
   function createCourseAgent(ctx: { studentId: string; courseId: string; emit: (e: AgentEvent) => void }) {
     return createDeepAgent({
       model: getChatModel("agent"),
       systemPrompt: COURSE_AGENT_PROMPT,
       tools: mainTools(ctx),
       subagents: subagents(ctx),
       middleware: [todoListMiddleware()],   // from "langchain"; deepagents has no write_todos tool without it
       skills: ["/skills/"],
       memory: ["/memories/AGENTS.md"],
       backend: new CompositeBackend(new StateBackend(), {
         "/memories/": new StoreBackend({ store, namespace: () => ["albert", ctx.studentId, ctx.courseId, "memories"] }),
         "/course/":   new StoreBackend({ store, namespace: () => ["albert", "course", ctx.courseId] }),
         "/skills/":   new FilesystemBackend({ rootDir: resolve(process.cwd(), "skills"), virtualMode: true }),
       }),
       store,          // MongoDB-backed when STORE=mongo, in-memory otherwise
       checkpointer,   // MongoDBSaver when STORE=mongo, MemorySaver otherwise
     });
   }
   ```
   The three routes mean: scratch files live only for the run; `/memories/` and `/course/` persist in MongoDB across runs; skills are read from the repo's `skills/` folder.
3. Thread ids: `ingest:<courseId>` and `plan:<studentId>:<courseId>`, passed as `configurable.thread_id`.
4. `COURSE_AGENT_PROMPT`: who the agent is (Albert's course agent), its two jobs, that it should plan with the todo list, delegate each unit and each worksheet to the named sub-agents instead of reading documents itself, save only through the save tools, and finish with a one-line result.
5. `events.ts`: turn the agent's stream into `AgentEvent`s. Log the raw stream once to see its real shape before writing the mapping. The mapping to produce:
   - a call to the todo tool → `todo`, with the list in `detail`
   - a call to the sub-agent tool → `subagent_start`; its result → `subagent_end`
   - a file write or edit → `file`, with the path
   - a call to one of our tools → `tool`. Our tools also call `ctx.emit` themselves, so these events appear even if the stream mapping misses them
   - the final message → `note` with label `summary` (the agent's one line); `runs.ts` then ends the run with the contract's `note` `done` whose `detail` is the run result
6. `runs.ts`: `runIngest(courseId)` and `runReplan(courseId, trigger)` create an `AgentRun`, invoke the agent with one user message, forward events to a callback, and save the run when it ends.

**Installed API (Nov 14; deepagents 1.16.5, langchain 1.6.6, @langchain/langgraph 1.7.4, @langchain/langgraph-checkpoint-mongodb 1.5.1).** Where this differs from the snippet above, the installed types win: (a) `createDeepAgent` adds no todo tool by itself; pass `middleware: [todoListMiddleware()]` from `langchain` to get `write_todos`. The built-in tools are `ls`, `read_file`, `write_file`, `edit_file`, `delete`, `glob`, `grep`, `execute` (no sandbox here) and `task` (arguments `description`, `subagent_type`). (b) `StoreBackend` takes `{ store, namespace }`; pass the store explicitly so seeding through `backend.write` works outside a run. (c) The checkpoint package also exports `MongoDBStore` (use it as the long-term store when `STORE=mongo`; collections `store`, `checkpoints`, `checkpoint_writes`). It bundles its own mongodb 6 driver, so `runtime.ts` casts the app's mongodb 7 client; verified live. (d) Stream with `streamMode: "updates"`; main-graph updates carry the AI tool calls (`write_todos`, `task`, `write_file`/`edit_file`) and their tool results, which is all `events.ts` needs. Sub-agent internals are not in that stream. The mapper does not map our own tools (they emit `tool` events themselves, P6.3). (e) `@langchain/core/testing` `fakeModel()` drives offline tests. (f) `pnpm tsx scripts/agent-hello.ts` takes `--then-ask` to run a second thread in the same process, which `STORE=memory` needs for AC2.

**Acceptance**
- [ ] **P6.2-AC1** — The agent runs a trivial task and streams events. *Verify:* `pnpm tsx scripts/agent-hello.ts` asks the agent to "write a todo list with two items and save a note to /course/hello.md", and prints at least one `todo` and one `file` event and a final `note`.
- [ ] **P6.2-AC2** — Persistent files survive a new run. *Verify:* run the script twice with different thread ids; the second run is asked to read `/course/hello.md` and prints its content.
- [ ] **P6.2-AC3** — Memory is loaded at start. *Verify:* seed `/memories/AGENTS.md` with "The student's name is Ada." and ask "what is the student's name?".
- [ ] **P6.2-AC4** — Checkpoints land in MongoDB. *Verify:* with `STORE=mongo`, after a run the checkpoint collection has documents for that thread id.
- [ ] **P6.2-AC5** — It also runs with no database. *Verify:* `STORE=memory pnpm tsx scripts/agent-hello.ts` passes AC1.

**Fallback.** If a backend class or option differs from the snippet above, follow the installed types. If persistent storage through the store cannot be made to work within an hour, use the state backend for everything and keep "memory" as a `student_notes` document that a `get_student_notes` / `save_student_notes` tool pair reads and writes. The teaching cards and plans are saved through our own tools either way, so nothing downstream changes.

---

### P6.3 — Tools

**Goal.** The agent's hands. Each is a few lines around a function from P6.1 or the `Repo`.

**Build.** Define each with `tool(fn, { name, description, schema })` and a zod schema. Descriptions say when to use the tool and what it returns.

| Tool | Given to | Does | Returns |
|---|---|---|---|
| `get_course_outline` | main | Fetches the outline through the adapter and caches every file | Units with file ids, kinds and titles; assignments with due dates; the syllabus file id |
| `read_course_file` | unit-reader, worksheet-mapper, card-checker | `readCourseFile` | The transcribed text |
| `save_teaching_card` | unit-reader | `validateCard`, then `repo.upsertCard` | `{ ok: true, subskills: [{id, name}], methods: [{id, name}] }` or `{ ok: false, problems: string[] }` |
| `list_cards` | worksheet-mapper, card-checker, planner | Reads the course's cards | Compact cards: titles, method names, subskills with ids, example labels |
| `save_worksheet` | worksheet-mapper | `validateWorksheet`, then `repo.upsertWorksheet` | ok, or problems |
| `get_due_dates` | planner | Worksheets with due dates and problem ids | List |
| `get_progress` | planner | Skill levels, recent evidence and recent error types (empty until Phase 7) | `{ skills, evidence, recentErrors }` |
| `get_previous_plan` | planner | The latest plan | Plan or null |
| `save_study_plan` | planner | `validatePlan`, then `repo.savePlan` | ok with the plan id, or problems |

Every tool calls `ctx.emit({ type: "tool", label })` with a short human label such as "Saved card: Unit 3 — Trigonometric Substitution".

**Acceptance**
- [ ] **P6.3-AC1** — Save tools reject bad input with usable messages. *Verify:* `tests/unit/agent-tools.test.ts` calls `save_teaching_card` with a card whose example is not in the source: the result is `ok: false` with a problem naming that example, and the `Repo` is unchanged.
- [ ] **P6.3-AC2** — Save tools accept good input and assign ids. *Verify:* the same test file with a fixture card.
- [ ] **P6.3-AC3** — `get_progress` works on an empty history. *Verify:* unit test returns empty lists, not an error.
- [ ] **P6.3-AC4** — Each tool emits one event. *Verify:* unit test with a spy `emit`.

---

### P6.4 — Skills and sub-agents

**Goal.** Give each kind of work to a sub-agent with the right tools and the right written know-how.

**Build.**

1. **Skills.** Each is a folder with a `SKILL.md` whose front matter has a `name` and a `description` that says when to use it.
   - `skills/teaching-card/SKILL.md` — how to build a card: a *method* is a named procedure with ordered steps in the teacher's order; *notation* records what the teacher writes and what they avoid; *conventions* are habits stated as sentences; copy example and step labels exactly and never invent one; subskills are three to eight statements beginning "can …", small enough to be exercised by one problem; pitfalls name a mistake, the subskill it belongs to, and a snake_case `errorType`; for an upcoming unit record names only.
   - `skills/study-plan/SKILL.md` — how to plan: first what is due soonest, then the lowest skill levels; at most 45 minutes a day unless a deadline forces more; revisit a subskill two days after an error; never assign an upcoming unit; every item's reason is one sentence to the student that cites what they did ("You dropped dx twice on Worksheet 3") or a due date; the summary is two plain sentences with no praise and no scolding.
   - `skills/socratic-tutor/` — copy `SKILL.md` from https://github.com/janestreet/agent_skills unchanged, with its MIT licence text as `LICENSE.md` beside it. The planner uses it for tone (levels are earned, do not flatter, do not credit what was not shown). Drill mode (stretch) uses its full loop.

2. **Sub-agents** in `subagents.ts`. Each has a `name`, a `description` the main agent reads when deciding whom to delegate to, a `systemPrompt`, and only the tools it needs.

   | Name | Job | Tools | Ends by |
   |---|---|---|---|
   | `unit-reader` | Read one unit's files and save its teaching card. For an upcoming unit, read the syllabus section and save a names-only card | `read_course_file`, `save_teaching_card` | Replying with one line: the unit and the count of methods, examples and subskills |
   | `worksheet-mapper` | Read one worksheet, extract its problems, tag each with subskills and methods from the covered cards, and save it | `read_course_file`, `list_cards`, `save_worksheet` | One line: worksheet and problem count |
   | `card-checker` | Re-read a unit's source beside its saved card and report anything unfaithful: steps out of the teacher's order, notation the teacher does not use, an example whose steps do not match | `read_course_file`, `list_cards` | "ok" or a short list of corrections |
   | `planner` | Build or rebuild the study plan | `list_cards`, `get_due_dates`, `get_progress`, `get_previous_plan`, `save_study_plan` | One line plus the plan's summary |

   Each prompt tells the sub-agent to load the relevant skill first, to keep calling its save tool until it returns `ok: true`, and to give up and report after three failed saves.

3. **The main agent's flow for ingestion**, written into its prompt as the expected shape, not as a script:
   1. Get the outline. Write the todo list: one item per unit, one per worksheet, then "check cards", then "first study plan".
   2. Delegate every unit to `unit-reader`. Covered units in parallel where the runtime allows it.
   3. Delegate every worksheet to `worksheet-mapper`, after the cards exist.
   4. Delegate each covered unit to `card-checker`. For each correction, send the unit back to `unit-reader` once with the corrections.
   5. Write `/course/scope.md`: a readable summary of methods by unit, the notation table, and what is upcoming.
   6. Delegate to `planner` for the first plan.
   7. Tick off todos as they finish.

**Acceptance**
- [ ] **P6.4-AC1** — Three skills exist with valid front matter. *Verify:* `tests/unit/skills.test.ts` parses each `SKILL.md` and checks `name` and `description`; `skills/socratic-tutor/LICENSE.md` exists and contains "MIT".
- [ ] **P6.4-AC2** — Four sub-agents are defined, each with only its listed tools. *Verify:* unit test over the exported array.
- [ ] **P6.4-AC3** — One sub-agent works alone. *Verify:* `pnpm tsx scripts/agent-unit.ts --course <id> --unit 3` invokes the agent with "build the card for unit 3 only" and a card for unit 3 is saved, with at least one `subagent_start` event.

---

### P6.5 — Ingest the seed course

**Goal.** The whole ingestion works on the real course and its output is checked against the marker facts.

**Build.**
1. `scripts/agent-ingest.ts` (`pnpm agent:ingest -- --course <id>`): run `runIngest`, print each event as a line, print the final result and the elapsed time. `--check` runs the golden checks afterwards.
2. `scripts/check-ingest.ts` — the **golden checks** for the seed course. Each prints pass or fail:

   | # | Check | Marker |
   |---|---|---|
   | 1 | Five cards exist. Units 1 to 3 are `taught: true` and pass `validateCard`; units 4 and 5 are `taught: false` and pass it | — |
   | 2 | Unit 1's notation has an entry whose `teacherWrites` contains `dy` and `dx` and whose `avoid` contains `f'(x)` | M1 |
   | 3 | Unit 1 has a method that mentions "LIATE" | M2 |
   | 4 | Unit 3 has a method with exactly five steps; step 2 mentions `dx`; step 5 mentions "triangle" | M3 |
   | 5 | Unit 3's methods or notation include `a\sin\theta`, `a\tan\theta` and `a\sec\theta` | M4 |
   | 6 | Unit 3's conventions mention the reference triangle; every unit 3 notation entry for the angle is `\theta` | M5 |
   | 7 | Unit 3 has a worked example labelled "Lecture 9, Example 2" | M6 |
   | 8 | Unit 3 has a pitfall whose `errorType` contains `dx` | — |
   | 9 | Unit 4 has a method named like "partial fractions" with no steps | M8 |
   | 10 | Four worksheets exist; Worksheet 3 has five problems; every problem has a subskill from its own unit or an earlier one | — |
   | 11 | Worksheet 3 and Worksheet 4 have due dates equal to the pinned outline (synthetic offsets use persisted demo day) | — |
   | 12 | The run produced a todo list, at least three `subagent_start` events and a `/course/scope.md` file | — |
   | 13 | A plan was saved and passes `validatePlan` | — |

3. Run ingestion twice. The second run must update, not duplicate.
4. Re-run the hint eval against the agent's cards: `pnpm eval:hints --cards ingested` loads cards and Worksheet 3 from the store instead of `fixtures/cards/` and `fixtures/worksheets/`.

**Acceptance**
- [ ] **P6.5-AC1** — All thirteen golden checks pass on a fresh run. *Verify:* `pnpm agent:ingest -- --course <id> --check`.
- [ ] **P6.5-AC2** — Ingestion finishes in under six minutes. *Verify:* the elapsed time printed by the script.
- [ ] **P6.5-AC3** — Running it again does not duplicate anything. *Verify:* card and worksheet counts are unchanged after a second run.
- [ ] **P6.5-AC4** — Hints are still good with agent-built cards. *Verify:* `pnpm eval:hints --cards ingested` meets the P3.4 quality bars, and the missing-`dx` rung 1 hint carries a citation containing "Lecture 9".
- [ ] **P6.5-AC5** — **Gate G3.** By hand: import the pinned GitHub source, ingest the course (from the terminal now; from the **Learn this course** button once P6.6 exists), open Worksheet 3, make the missing-`dx` mistake, and get a hint that cites Lecture 9.

**Fallback.** If golden checks 2 to 9 fail repeatedly, the cause is almost always the transcription (check `readCourseFile` output for the missing words) or a skill that is too vague (tighten `teaching-card/SKILL.md`). If the agent itself is failing (loops, tool errors) and an hour has gone, run `pnpm ingest:flat` to get cards, pass G3 with those, and come back to the agent for P6.7. Say so in `status.md`.

---

### P6.6 — Routes and the run panel

**Goal.** Ingestion is started from the page and people can watch the agent work.

**Build.**
1. `POST /api/agent/ingest` and `POST /api/agent/replan`: start the run and reply with `text/event-stream`, one `AgentEvent` per message. Set the route's maximum duration high enough for a full ingestion. A second request for a course that is already running attaches to the existing run instead of starting another.
2. `GET /api/agent/runs/[runId]`: the stored run.
3. `RunPanel` component, shown on `/courses` during ingestion and collapsible on the course page:
   - **Plan** — the todo list, items ticking as they finish
   - **Team** — a row per sub-agent invocation: name, what it was asked, a spinner, then its one-line result
   - **Files** — paths the agent wrote
   - **Log** — the tool labels in order ("Read Lecture 9", "Saved card: Unit 3 …")
   - a header line: elapsed time, and "5 cards · 4 worksheets · plan ready" at the end
4. **Replay.** The panel can play a stored run at 8× speed from its event timestamps, labelled "Recorded run, sped up". The demo uses this, because a live ingestion is longer than the demo.
5. When ingestion ends, `/courses` shows **Open** and the course page is ready.

**Acceptance**
- [ ] **P6.6-AC1** — Events reach the browser as they happen. *Verify:* `curl -N -X POST localhost:3000/api/agent/ingest -d '{"courseId":"…"}'` prints events over time, not all at the end.
- [ ] **P6.6-AC2** — The panel renders a run. *Verify:* `tests/e2e/run-panel.spec.ts` plays `fixtures/agent/ingest-run.json` (a stored run, saved from a real ingestion) through the replay mode and asserts the todo list, at least three sub-agent rows, and the final summary line.
- [ ] **P6.6-AC3** — A second click does not start a second run. *Verify:* unit test of the run registry.
- [ ] **P6.6-AC4** — A real stored run is checked in as `fixtures/agent/ingest-run.json` and parses as `AgentRun`.

---

### P6.7 — The study plan

**Goal.** A week of specific, justified practice, built by the planner and guaranteed valid.

**Build.**
1. `validatePlan(plan, course)` in `functions/plan.ts`: the five rules in `contracts.md` §8. Returns problems as strings.
2. The planner's prompt: load the `study-plan` skill; read the cards, due dates, progress and previous plan; produce a plan for the next seven days; save it; if the save returns problems, fix and save again.
3. With no evidence yet (straight after ingestion), the plan is driven by due dates: spread Worksheet 3's problems over the days before it is due, starting with the problem closest to a worked example.
4. `GET /api/plan/[courseId]` and `PATCH /api/plan/[planId]/item/[itemId]`.
5. A minimal plan list on the course page (Phase 7 styles it): grouped by day, each item showing the worksheet and problems, the minutes, the reason, the lecture reference, and a link `…/work/<worksheetId>?problem=<label>`.

**Acceptance**
- [ ] **P6.7-AC1** — The validator enforces all five rules. *Verify:* `tests/unit/validate-plan.test.ts` starts from a valid fixture plan and breaks each rule in turn: an unknown problem id; a date after the due date; a 90-minute day; an item with no evidence and no due date; a problem from unit 4.
- [ ] **P6.7-AC2** — The first plan is valid and covers the nearest deadline. *Verify:* golden check 13, plus: at least one item for Worksheet 3 dated before its due date.
- [ ] **P6.7-AC3** — An invalid plan cannot be saved. *Verify:* unit test of `save_study_plan` with a bad plan: `ok: false` and no write.
- [ ] **P6.7-AC4** — Plan links open the right problem. *Verify:* e2e test clicks an item and lands on the work page with that problem in view.

---

### P6.8 — Re-plan and memory

**Goal.** The plan changes because of what the student did, and the agent remembers the student between runs.

**Build.**
1. `runReplan(courseId, "session_end")` sends the agent one message: the session's worksheet, the problems attempted, the new evidence events and the error types seen. The main agent delegates to `planner`, then updates `/memories/AGENTS.md` with anything worth remembering, in dated one-line notes under a "What I've noticed" heading (for example "Nov 14: drops dx when substituting; twice on Worksheet 3").
2. The planner must use the new evidence: a subskill with an `error_made` gets a practice item within two days whose reason names the error; a problem solved unaided is not assigned again; an item that was done is not repeated.
3. The plan's `summary` is the "how you're doing" text: two sentences, specific, in plain language.
4. The trigger is wired in Phase 7 (P7.5). Until then use `pnpm agent:replan` with `pnpm seed:demo`'s sample evidence.
5. Keep it quick: the re-plan message tells the agent not to re-read course files. Target under 90 seconds.

**Acceptance**
- [ ] **P6.8-AC1** — New errors change the plan. *Verify:* `scripts/check-replan.ts`: seed evidence with two `missing_dx` errors on Worksheet 3 problem 1, run a re-plan, and assert the new plan has an item within two days whose `subskillIds` include that subskill, whose `evidenceIds` include one of the two events, and whose reason mentions `dx`.
- [ ] **P6.8-AC2** — Mastered work is not re-assigned. *Verify:* same script: seed two cold `unaided_correct` events for a subskill; no new item targets only that subskill.
- [ ] **P6.8-AC3** — Memory persists and is used. *Verify:* after the run in AC1, `/memories/AGENTS.md` contains a line mentioning `dx`. Run a second re-plan on a new thread with no new evidence and ask for the summary; it reflects the earlier note.
- [ ] **P6.8-AC4** — The summary obeys the tone rules. *Verify by reading three summaries:* two sentences each, specific, no praise words ("great", "awesome", "good job").
- [ ] **P6.8-AC5** — A re-plan takes under 90 seconds. *Verify:* the script's elapsed time.

---

## Phase exit

```bash
pnpm verify                                   # validators, tools, skills, sub-agent definitions
pnpm e2e                                      # run panel replay, plan links
pnpm agent:ingest -- --course <id> --check    # 13 golden checks
pnpm eval:hints --cards ingested              # hints still meet the bar
pnpm tsx scripts/check-replan.ts              # plan reacts to evidence
```

- [ ] **G3** — P6.5-AC5 done by hand.
- [ ] **G4** (with Phase 7) — end a real session and see the plan change.
- [ ] `docs/tracks/langchain.md` has a screenshot of the run panel during a real ingestion.
- [ ] `status.md` records whether cards were built by the agent or the flat script, and the ingestion time.

Source reconciliation: run synthetic marker-fact golden checks only on the verified P5.1 artifacts. The live course has its own owner-confirmed mapping and no fabricated marker facts or dates.
