# Albert — Decisions

Each decision has a reason and a trigger that would change it. During the build, follow the decision unless its trigger fires. If it does, change the decision here in the same commit as the code.

---

## D1 — One Next.js app in TypeScript

**Decision.** A single Next.js app (App Router, TypeScript, pnpm) at the repo root holds the pages, the API routes, the hint path and the course agent.

**Why.** One language and one process means one thing to run, one thing to deploy and no cross-service contracts to keep in step during a 36-hour build. Deep Agents ships a JavaScript library with the same harness as the Python one, so the agent does not force a Python service.

**Trigger to change.** The JavaScript `deepagents` package is missing something Phase 6 needs and the gap cannot be closed in an hour. Then run the agent as a small Python service behind the same two routes; nothing else changes because the routes and the `AgentEvent` stream are the contract.

## D2 — Our own canvas, not tldraw

**Decision.** Capture strokes with Pointer Events and draw them as SVG paths using `perfect-freehand`.

**Why.** Albert's core data is the raw stroke with per-point timing and pressure, grouped by ruled rows. A whiteboard library owns its own shape model, tools and undo stack, and getting timed raw points in and custom animated marks out means working against it. A purpose-built surface is a few hundred lines and gives exact control over rows, clusters, snapshots and replay.

**Trigger to change.** None expected. This is the product's core and should stay in our hands.

## D3 — MathJax SVG for math

**Decision.** Render LaTeX with MathJax's SVG output and insert the resulting paths into the page's SVG.

**Why.** Albert's writing is animated SVG. KaTeX renders HTML and has no SVG output, so it cannot be animated as paths or placed inside the SVG layer. MathJax's SVG output produces each glyph as a path.

**Trigger to change.** MathJax load time hurts the first hint. Then pre-load it when the work page opens, which P4.2 already does.

## D4 — Albert writes in a margin column

**Decision.** The work surface has a student column on the left and a reserved column for Albert on the right. A hint is anchored at the height of the row it refers to.

**Why.** It guarantees free space, so placement is arithmetic and never a search. It also matches how a teacher marks a page, and it keeps Albert's ink from covering the student's.

**Trigger to change.** On a narrow screen (under 900 CSS px) the margin moves below the row. That is a layout variant, not a different decision.

**Page-mode variant (user, Nov 14, P5.8).** When the student writes on the worksheet PDF itself, there is no reserved column: Albert writes in the page's own white space, found by a pure free-space search over the page print, the student's ink and earlier notes. Placement is then a search, so it has a fallback: a band below the page. The ruled, free and whiteboard surfaces keep the margin column.

**Release override (user, Nov 15, R2.2).** The whole PDF page, including the right edge, accepts pen and eraser input. All tutor notes use the below-page band for this release; R3.3 white-space search is deferred.

## D5 — The model points by cluster number

**Decision.** The browser groups strokes into numbered clusters and draws the numbers on the snapshot. The model names wrong symbols by number. The browser turns numbers into positions from its own stroke data.

**Why.** Vision models read handwriting well and localise pixels poorly. Asking for a number that is printed in the image is a reading task, which they are good at. Positions then come from coordinates that are exact by construction.

**Trigger to change.** The eval in P3.5 shows the numbers hurt reading accuracy. Then send a clean image alongside the marked one (`SEND_CLEAN_IMAGE=1`).

## D6 — MongoDB Atlas

**Decision.** MongoDB Atlas (free tier) is the database, reached through a `Repo` interface that also has an in-memory implementation.

**Why.**
- The data is nested documents: a stroke holds its points, a teaching card holds its methods and examples, a plan holds its items. Nothing needs a join.
- LangGraph publishes a MongoDB checkpointer and store, so the course agent's checkpoints and long-term memory live in the same database as the app's data.
- The free tier is enough for the event and needs no card.
- It makes the project eligible for MLH's "Best Use of MongoDB Atlas".

**Notes.** Use `@langchain/langgraph-checkpoint-mongodb` at its latest version; releases up to 1.3.0 had a query-injection flaw. Atlas Vector Search is available on the free tier but is a stretch goal here: one course has a handful of units, so the scope bundle is found by id, not by search.

**Trigger to change.** Atlas cannot be reached from the venue network. Then run with `STORE=memory` and seeded data; the demo does not depend on persistence across restarts.

## D7 — Claude on Bedrock by default, behind an adapter

**Decision.** `src/lib/llm` chooses the provider from `LLM_PROVIDER`. The default is `bedrock` with Claude models. `anthropic` (the direct API) is the fallback. `xai` (Grok) is supported for the course agent only.

**Why.**
- The Amazon prize does not require Bedrock in writing, but running on it is the natural way to show the project belongs in that category.
- A new AWS account can have model access or quota problems that cannot be fixed overnight, so a second provider must be one environment variable away.
- The SpaceXSI category, as MLH publishes it, is about using Cursor and Grok Bot to *build* the project. It does not ask for Grok inside the product. So the product's reasoning stays on one provider and the hint prompt is tuned once.
- The adapter keeps the door open: if the on-site SpaceXSI rules reward Grok API use, the course agent can run on Grok by setting `LLM_PROVIDER=xai` for the agent, with no code change.

**Notes.** Claude 5 models on Bedrock reject `temperature`, `top_p` and `top_k`; do not set them. Model ids are chosen in P1.4 and P3.5 and written into `.env.local`, never hard-coded.

**Trigger to change.** The Bedrock ping fails for 30 minutes in P1.4: switch to `anthropic`.

## D8 — Deep Agents for the course agent only

**Decision.** The course agent is built with `deepagents`. The hint path is one direct model call.

**Why.** Deep Agents is a harness for long, multi-step work: it plans with a todo list, delegates to sub-agents, keeps files and remembers across runs. Reading a whole course and planning a week of study is that kind of work. A hint is one judgement that must arrive in seconds, and a planning loop would only add delay.

**Trigger to change.** None for the hint path. For the agent, see D1.

## D9 — Pinned GitHub course source, upload fallback

**Decision.** The configured public `Azrkiel/albert-files` repository supplies a reviewed `CourseManifest`. Resolve its configured ref once per explicit import and cache manifest, normalized outline and original PDFs at that exact SHA. Snapshot-qualified ids include persisted demo day. `GitHubAdapter` implements `CourseSourceAdapter`; upload is the fallback. Moodle/Canvas and automatic source refresh are post-hackathon.

**Why.** Existing course PDFs are available without institutional LMS credentials. An owner-confirmed mapping supplies teaching order and labels; filenames alone do not. Immutable snapshots keep cards and citations reproducible. The hot path and original views read the Repo cache only. Synthetic marker facts remain confined to the separately verified P5.1 course.

**Trigger to change.** After the hackathon, implement another source behind the same interface. Never silently update an existing snapshot.

## D10 — Scope is relative to the worksheet

**Decision.** For a worksheet in unit *n*, units 1 to *n* are covered and later units are upcoming.

**Why.** It needs no calendar logic and no guess about "today's lecture", and it is right by construction: a worksheet for a unit only assumes that unit and what came before it. It also makes scope testable.

**Trigger to change.** A course whose worksheets are not attached to units. Then let the student pick the current unit when opening the worksheet.

## D11 — Skill levels are computed, not generated

**Decision.** `computeLevel` is plain code over evidence events, with unit tests.

**Why.** A level the model made up cannot be explained or trusted. A level computed from listed events can be shown with its evidence ("two unaided solves on different problems"), is the same every time, and can be tested. The model's job is to diagnose a single piece of work; the arithmetic of progress belongs in code.

**Trigger to change.** None.

## D12 — A mark first, writing after a tap

**Decision.** A stuck signal shows a small "Need a hint?" mark in the margin. Albert writes only when the student taps it or taps "I'm stuck". `AUTO_HINT=1` makes a pause trigger a rung 1 hint directly, for the stage demo.

**Why.** A pause is often thinking. A tutor who starts writing every time you stop to think is a tutor you turn off. The mark tells the student help is there without taking the pen from them. It also answers the judges' question about over-helping.

**Trigger to change.** None for the product. The demo may use `AUTO_HINT=1` so the audience sees Albert react to the pause.

## D13 — Annotations with roughjs

**Decision.** Circles, underlines, cross-outs and arrows are generated with `roughjs` and animated by revealing their stroke.

**Why.** These shapes are real stroke paths, so revealing them along their length looks exactly like a pen drawing them. They are the most visible motion in the demo and the cheapest to make convincing.

**Trigger to change.** None.

## D14 — One demo student, no sign-up

**Decision.** `DEMO_STUDENT_ID` identifies the only student. There is no account system. The optional GitHub read token comes from server environment only; it is never persisted in a connection or sent to the browser.

**Why.** Authentication is a day of work that no judge will score. The one piece of security that matters in a demo, not leaking the student's LMS credentials, is kept.

**Trigger to change.** After the hackathon.

## D15 — Validate everything a model returns

**Decision.** Hints, cards, worksheets and plans are parsed with zod and checked against rules before they are stored or shown. Failures get one retry with the error, then a visible, honest failure.

**Why.** A malformed hint that crashes the page during the demo is worse than "Albert couldn't read that". Validation is also what makes "never gives the answer on the first tap" a property of the system and not a hope about the prompt.

**Trigger to change.** None.

## D16 — The Socratic skill is adapted, not adopted whole

**Decision.** Jane Street's `socratic-tutor` skill (MIT) is vendored into `skills/socratic-tutor/` with its licence. Its rules shape the hint ladder and the level rule. Its full course loop (diagnostic quiz, one question at a time until mastery) is used only in the stretch-goal drill mode.

**Why.** The skill is written for a chat session whose whole purpose is to be taught. A student in the middle of homework who gets stuck on line three does not want a placement quiz. What transfers directly: ask one question and stop; when the student is wrong, ask a narrower question; explain only after repeated failure; do not flatter; do not credit understanding the student has not shown; levels are earned on independent checks.

**Trigger to change.** None.

## D17 — Name and tagline

**Decision.** The product is **Albert**, part of **Albert and Einstein Academy**. The tagline is **"Turns you into Einstein."**

**Why.** The tagline was given as "Turns you to Einstein"; "into" is the idiomatic form. Change the one string in `src/lib/brand.ts` to restore the original wording.

**Note.** An unrelated education product called Albert (albert.io) exists. If a judge raises it, the answer is that this is a hackathon project name inside Albert and Einstein Academy.

## D19 — PDF helper with course context; no study plan in this release

**Decision (user, Nov 14).** Build PDF annotation (pen, erase, undo, save), Learn this course, and an on-page assistant that uses course context and pen-stroke structure. Adapt Pixie's pointing/drawing interaction within Albert's page. Study planning/re-planning, mastery dashboards and tutor reports are deferred. [current-scope.md](./current-scope.md) defines the revised order and acceptance; it supersedes the old G4, the wait-until-G3 PDF dependency and any prohibition on a short typed question to the helper. Existing code/evidence are preserved; implementation must remove planner-required ingestion behavior rather than merely hide its UI.

**Why.** Focus the release on helping the student with the work in front of them. Keep validated course knowledge and direct tutoring calls; invest remaining work in PDF annotation, contextual explanations and reliable stroke targeting.

## D18 — Lines are inferred from ink, not ruled

**Decision.** Once P2.5a-AC4 passes, the work surface has no ruled rows by default. A "row" is a line of work inferred from the ink (contracts §2, Line assignment). Ruled 128 px rows remain as `NEXT_PUBLIC_CANVAS_LAYOUT=ruled`.

**Why.** At P2.5-AC3 real handwriting did not fit fixed bands: a stacked fraction was 1.5 rows tall and was split between two rows, so Albert could not point at its denominator. Students should write the way they write on paper. Inferring lines keeps the `Row` shape, so clusters, stuck detection, snapshots and hint anchoring are unchanged.

**Trigger to change.** If AC4 shows lines merging or splitting in normal writing and tuning `LINE.GAP` does not fix it, ship `ruled` and keep `free` behind the flag.
