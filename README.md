# Albert

**Turns you into Einstein.** Part of *Albert and Einstein Academy*. HackPrinceton Fall 2026.

<!-- hero screenshot -->

Albert is a worksheet tutor that works on the page. You open your course worksheet as a PDF and write on it with a pen. When you get stuck, you tap **I'm stuck** or ask a short question. Albert reads your handwriting, circles the symbols it is talking about, and writes a short hint in red ink next to your work. The hint uses only the methods your class has covered, cites the lecture where your teacher taught them, and does not give the answer. Your work saves and reloads, and **Save PDF** downloads the worksheet with your ink and Albert's.

Code: [`Azrkiel/albert`](https://github.com/Azrkiel/albert). Course files: [`Azrkiel/albert-files`](https://github.com/Azrkiel/albert-files) (a synthetic Calculus II course, hosted on GitHub).

## What it does

- **Stroke-aware.** Albert reads pen strokes with their timing. Pauses, erasing and crossed-out steps show where you are stuck, and it points at the exact symbol by number, not by guessing coordinates.
- **Scope-aware.** A deep agent reads the course once ("Learn this course") and builds a teaching card per unit: the methods, the notation, and worked examples with lecture labels. A hint for Worksheet 3 may use Units 1 to 3 and may not use a method from Unit 4.
- **Socratic.** Rung 1 is a question. Rung 2 names the step. Rung 3 writes one worked step. The ladder is in the prompt and is checked again on the server before anything is drawn.
- **On the page.** The reply is drawn as ink on the PDF: a circle, an arrow, a short handwritten note and a citation. If the model fails, your work stays as it was.

## Who it's for

A student doing homework without a tutor at hand. A tutor or teaching assistant can look at the annotated PDF the student saves and see where the student got stuck and what Albert said.

## How it works

```
Browser                                              Next.js server
 PDF pages + pen canvas                               HOT PATH  /api/hint
 capture -> rows -> clusters -> stuck detector  --->    scope bundle (unit card, covered and
 snapshot (page crop + numbered clusters)               upcoming methods) + Socratic ladder
                                                        one model call, zod-validated reply
 ink conductor: circle, arrow, note, citation  <---     reading, diagnosis, marks, hint
 Save PDF (pdf-lib)                                   SLOW PATH /api/agent/ingest
                                                        deep agent: todos, sub-agents, files,
                                                        skills, memory -> cards + worksheets
                                                      db/   Repo -> MongoDB Atlas (or in-memory)
                                                      llm/  Claude on Amazon Bedrock
 GitHub course files -> cached PDFs -> course agent
```

| | Hot path (a hint) | Slow path (learn the course) |
|---|---|---|
| Trigger | Tap **I'm stuck** or ask a question | Tap **Learn this course** |
| Code | `src/lib/tutor`, `/api/hint` | `src/lib/agent`, `/api/agent/ingest` |
| Model call | One call that reads the handwriting and writes the hint | A deep agent with sub-agents (`unit-reader`, `worksheet-mapper`, `card-checker`) |
| Output | Validated hint, drawn as ink | Validated teaching cards and mapped worksheets, with source references |

The model decides which symbol to point at, by cluster number. The browser decides where that symbol is on the page, from stroke data it already has. The two paths never import each other. The full system map is in [`docs/plan/00-main-plan.md`](docs/plan/00-main-plan.md) section 2.2.

## Run it

Prerequisites: Node 24 and pnpm. pnpm comes through corepack (`corepack enable`); the repo pins `pnpm@10.34.9`.

**No keys, no network.** Hints are recorded model replies, not live reading of your handwriting.

```bash
corepack enable
pnpm install
STORE=memory MOCK_LLM=1 pnpm dev
```

On Windows PowerShell, set the variables first: `$env:STORE="memory"; $env:MOCK_LLM="1"; pnpm dev`.

The demo course is seeded when the server starts. Then open:

- `http://localhost:3000/courses` for the course and the **Learn this course** panel. In this mode a recorded run is replayed.
- `http://localhost:3000/work/calc2-ws3` for Worksheet 3. Worksheets that have a PDF open on the PDF surface by default. `?surface=ruled` or `?surface=free` opens the older ruled and free canvases instead.

**With live services**

1. `cp .env.example .env.local` and fill in:
   - `LLM_PROVIDER=bedrock`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` if you use one. Model ids go in `HINT_MODEL_ID`, `AGENT_MODEL_ID` and `READER_MODEL_ID`.
   - `STORE=mongo`, `MONGODB_URI`, `MONGODB_DB`.
   - Optional: `COURSE_GITHUB_TOKEN` for a private course repository.
2. `pnpm install`, then `pnpm seed:demo` to load the hand-checked demo cards and worksheets into the database.
3. `pnpm dev`.
4. `pnpm smoke` checks that the database and the model are reachable.

Other commands: `pnpm verify` (types, lint, unit and contract tests), `pnpm e2e` (browser tests with recorded strokes and replies), `pnpm eval:hints` (live hint evaluation), `pnpm agent:ingest -- --course <id> --check` (ingest with golden checks).

## How we built it

Next.js and TypeScript. Our own stroke canvas on Pointer Events with `perfect-freehand`. The server renders PDF pages with `pdfjs-dist`, and `pdf-lib` writes the annotated download. Claude on Amazon Bedrock reads handwriting and writes hints. LangChain Deep Agents runs course ingestion. MongoDB Atlas holds the app data and the agent's checkpoints and memory. Course files come from a pinned GitHub manifest and are cached. Albert's marks use `roughjs`; its writing uses MathJax paths and the Kalam font.

We worked from a written plan in `docs/plan/`, one subphase at a time, each with acceptance criteria and a recorded result in [`docs/plan/status.md`](docs/plan/status.md).

TODO(owner): add a paragraph on Cursor and Grok Bot only if they were used. `docs/tracks/spacexsi.md` has no evidence yet, so this README does not claim either.

## Status

Checked by automated tests (numbers in `status.md`): PDF pages and problem regions, writing, erasing and undo per page, save and reload, annotated PDF export geometry, and hint requests that carry a short question. Still open in `status.md`: the by-hand checks (pen on the demo device, the annotated PDF in an independent viewer), live Mongo ordering, and a clean live run of the context-only course agent. [`docs/SUBMISSION.md`](docs/SUBMISSION.md) has the numbers and says what is not claimed.

## What's next

Placing notes in free space on the page (they use a band below the page for now), a pointer that moves to the target before the circle, streaming for faster first ink, canvas support through an institution-approved integration, and more subjects. Study plans, re-planning and a progress dashboard exist in the repository as unfinished work and are not part of this release.

## Brand and design system

The [Albert brand kit](docs/brand/README.md) has the design system, logos, mascot poses, website assets and QA evidence. Start with the [production asset index](docs/brand/PRODUCTION_ASSETS.md).

## Plan and docs

[`current-scope.md`](docs/plan/current-scope.md) (this release) · [`release-pdf-tutor.md`](docs/plan/release-pdf-tutor.md) (how it is built) · [`status.md`](docs/plan/status.md) · [`contracts.md`](docs/plan/contracts.md) · [`tracks.md`](docs/plan/tracks.md) · [`decisions.md`](docs/plan/decisions.md) · [`AGENTS.md`](AGENTS.md)

## Credits and licences

Albert is MIT licensed. See [`LICENSE`](LICENSE).

- The Socratic tutoring rules are adapted from Jane Street's [`agent_skills`](https://github.com/janestreet/agent_skills) (MIT).
- Handwriting font: Kalam Regular, Indian Type Foundry, SIL Open Font License 1.1. See [`public/fonts/OFL.txt`](public/fonts/OFL.txt).
- [MathJax](https://www.mathjax.org/) (Apache 2.0), [roughjs](https://roughjs.com/) (MIT), [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT), [pdf-lib](https://pdf-lib.js.org/) (MIT), [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0).
