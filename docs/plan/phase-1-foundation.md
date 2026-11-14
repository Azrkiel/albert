# Phase 1 — Foundation

**Purpose.** A running app with the contracts in code, a model that answers, a database that stores, and a verify loop that people, agents and the scheduled bot can all run. Every later phase assumes these exist.

**Done looks like.** `pnpm dev` serves the app, `pnpm verify` and `pnpm e2e` pass, and `pnpm smoke` prints three green lines: database, model, model-with-image.

| | |
|---|---|
| Depends on | Nothing |
| Unblocks | Everything |
| Time box | 2 hours (gate **G0** at T+2h) |
| Lane | Everyone together, then split |

Read first: [`00-main-plan.md`](./00-main-plan.md) §2 and §6, [`contracts.md`](./contracts.md), [`decisions.md`](./decisions.md) D1, D6, D7.

---

### P1.1 — Scaffold and tooling

**Goal.** An empty but correctly shaped project.

**Build.**
1. Create a Next.js app at the repo root with the current `create-next-app`: TypeScript, App Router, `src/` directory, ESLint, pnpm. Keep the existing `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `README.md` and `docs/`.
2. Turn on `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.json`.
3. Add dev dependencies: `vitest`, `@playwright/test`, `tsx`. Add `zod` and `nanoid` as dependencies.
4. Create the folders from the main plan §2.3 with an `index.ts` in each `src/lib/*` module: `contracts`, `llm`, `db`, `canvas`, `tutor`, `ink`, `lms`, `agent`, `progress`. Create `skills/`, `seed/`, `scripts/`, `tests/unit/`, `tests/e2e/`, and the fixture folders listed in `contracts.md` §14.
5. Add every command from `contracts.md` §13 to `package.json`. Commands whose scripts do not exist yet print `not built yet (Phase N)` and exit with code 0, so that `pnpm verify` and the bot never fail on a missing script.
6. Add `.env.example` with every variable from `contracts.md` §12 and empty values. Confirm `.env.local` is git-ignored.

**Acceptance**
- [ ] **P1.1-AC1** — The app starts. *Verify:* `pnpm dev`, open `http://localhost:3000`, a page renders with no console errors.
- [ ] **P1.1-AC2** — Type-check and lint are clean. *Verify:* `pnpm verify` exits 0.
- [ ] **P1.1-AC3** — Every command in `contracts.md` §13 exists. *Verify:* `pnpm run` lists all of them.
- [ ] **P1.1-AC4** — No secret can be committed by accident. *Verify:* `git check-ignore .env.local` prints the path.

---

### P1.2 — Contracts in code

**Goal.** Every shape in `contracts.md` exists as a zod schema, and fixtures are checked against them.

**Build.**
1. Create one file per section of `contracts.md` under `src/lib/contracts/`: `geometry.ts`, `strokes.ts`, `events.ts`, `hints.ts`, `check.ts`, `course.ts`, `progress.ts`, `plan.ts`, `agent.ts`, `storage.ts`, `lms.ts`, `fixtures.ts`. Export the schema and the inferred type for each shape, plus the constants `PAGE`, `INK` and `STUCK`.
2. Re-export everything from `src/lib/contracts/index.ts`. Other modules import only from there.
3. Write `tests/unit/contracts.test.ts`. It loads every JSON file under `fixtures/` and parses it with the schema for its folder, using the table in `contracts.md` §14 (`fixtures/sessions/*` → `SessionRecording`, `fixtures/llm/*` → `MockHint`, `fixtures/cards/*` → `TeachingCard`, and so on). Folders marked "none" in that table are skipped. It passes with zero fixtures and fails on the first invalid one.
4. Add one hand-written valid example and one deliberately invalid example per schema in `tests/unit/contracts.examples.ts`, and assert that the first parses and the second does not.

**Acceptance**
- [ ] **P1.2-AC1** — Every type named in `contracts.md` has a schema. *Verify:* `tests/unit/contracts.test.ts` includes a test that imports each name listed in a `REQUIRED_SCHEMAS` array and asserts it is a zod schema. The array matches the type names in `contracts.md`.
- [ ] **P1.2-AC2** — Valid examples parse and invalid ones are rejected. *Verify:* `pnpm verify`.
- [ ] **P1.2-AC3** — No module defines its own copy of a contract type. *Verify:* `grep -R "type HintRequest\|type Stroke =" src --include=*.ts` finds matches only in `src/lib/contracts/`.

---

### P1.3 — App shell and brand

**Goal.** The pages exist as stubs so that every phase has somewhere to put its work.

**Build.**
1. `src/lib/brand.ts`: `NAME = "Albert"`, `ACADEMY = "Albert and Einstein Academy"`, `TAGLINE = "Turns you into Einstein."`.
2. Routes, each rendering its title and a one-line description of what will be there:
   - `/` — connect your course
   - `/courses` — pick a course
   - `/course/[courseId]` — plan, skills, worksheets
   - `/work/[worksheetId]` — the page you write on
   - `/report/[courseId]` — tutor report
3. A shared layout with the name, the tagline and a small status dot that reads `/api/health`.
4. `/api/health` returns the shape in `contracts.md` §11. For now `db`, `llm` and `lms` are `false`.
5. Pick the look once and keep it: paper-white work surface, near-black student ink, red for Albert. Colours come from `INK`.

**Acceptance**
- [ ] **P1.3-AC1** — All five pages load. *Verify:* `tests/e2e/shell.spec.ts` visits each route and finds its heading. `pnpm e2e` passes.
- [ ] **P1.3-AC2** — The health route answers. *Verify:* `curl -s localhost:3000/api/health` returns JSON with the five keys.

---

### P1.4 — Model access

**Goal.** One function gives any module a working chat model, and the provider can be swapped with an environment variable.

**Read first.** The current LangChain JavaScript docs for `@langchain/aws` (`ChatBedrockConverse`), `@langchain/anthropic` (`ChatAnthropic`) and `@langchain/xai` (`ChatXAI`): constructor options, image content blocks, `bindTools`, streaming.

**Build.**
1. Install `@langchain/core`, `@langchain/aws`, `@langchain/anthropic`, `@langchain/xai`.
2. `src/lib/llm/index.ts` exports:
   ```ts
   type ModelRole = "hint" | "agent" | "reader";
   function getChatModel(role: ModelRole): BaseChatModel;
   function providerFor(role: ModelRole): "bedrock" | "anthropic" | "xai";
   async function pingModel(): Promise<{ ok: boolean; ms: number; modelId: string }>;
   async function pingVision(): Promise<{ ok: boolean; ms: number; answer: string }>;
   ```
   - The provider is `LLM_PROVIDER`. For the `agent` role, `AGENT_PROVIDER` overrides it when set. This is the switch described in `tracks.md` §8. The `hint` and `reader` roles read images and PDFs and always use `LLM_PROVIDER`; `xai` is only ever selected for `agent`.
   - The model id is `HINT_MODEL_ID`, `AGENT_MODEL_ID` or `READER_MODEL_ID`.
   - Do **not** pass `temperature`, `top_p` or `top_k`. Claude 5 models on Bedrock reject them.
3. Get Bedrock working first:
   - In the AWS console, open Bedrock in `us-east-1` and confirm the Claude models are enabled for the account. If the event hands out AWS credits or workshop accounts, use those.
   - Starting ids, as listed in AWS documentation on Nov 13, 2026 (confirm in the console): `us.anthropic.claude-sonnet-5` for `agent` and `reader`, and either `us.anthropic.claude-sonnet-5` or `us.anthropic.claude-haiku-5-5` for `hint`. P3.5 makes the final choice for `hint`.
4. `pingVision` sends `fixtures/eval/ping.png` (a typed image of `2 + 2 = 5`, checked into the repo) with the question "What equation is written? Reply with the equation only." and passes if the reply contains `2`, `+` and `5`.
5. `scripts/smoke.ts` calls `pingModel` and `pingVision` and prints one line each: `model  ok  842ms  us.anthropic.claude-sonnet-5`.
6. Wire `llm` in `/api/health` to a cached `pingModel` result (cache for 60 seconds so the status dot costs nothing).

**Acceptance**
- [ ] **P1.4-AC1** — The model answers through the adapter. *Verify:* `pnpm smoke` prints `model ok`.
- [ ] **P1.4-AC2** — The model reads an image. *Verify:* `pnpm smoke` prints `vision ok`.
- [ ] **P1.4-AC3** — The provider swaps without code changes. *Verify:* with `ANTHROPIC_API_KEY` set, `LLM_PROVIDER=anthropic HINT_MODEL_ID=<anthropic id> pnpm smoke` prints `model ok`. If no key for a second provider is available, a unit test with mocked constructors asserts that each provider value builds the matching class.
- [ ] **P1.4-AC4** — The agent override works. *Verify:* unit test: with `LLM_PROVIDER=bedrock` and `AGENT_PROVIDER=xai`, `providerFor("agent")` is `xai` and `providerFor("hint")` is `bedrock`.
- [ ] **P1.4-AC5** — The chosen provider and model ids are written in `status.md`.

**Fallback.** If the Bedrock ping still fails 30 minutes after starting this subphase (access not granted, quota at zero, credentials trouble), set `LLM_PROVIDER=anthropic`, record it in `status.md`, and move on. Return to Bedrock when someone is free; it is one variable.

---

### P1.5 — Database

**Goal.** A `Repo` that the rest of the app uses without knowing what is behind it.

**Build.**
1. Create a free Atlas cluster. Create a database user. Allow access from anywhere for the weekend (`0.0.0.0/0`), since the venue's addresses are unknown. Put the connection string in `MONGODB_URI`.
2. Install `mongodb`.
3. `src/lib/db/repo.ts`: the `Repo` interface from `contracts.md` §9.
4. `src/lib/db/memory.ts`: `MemoryRepo`, backed by maps. It deep-clones on write and read so tests cannot share state by accident.
5. `src/lib/db/mongo.ts`: `MongoRepo`. One shared `MongoClient` cached on `globalThis` so that hot reload does not open a new pool each time. Files go in a GridFS bucket named `filedata`. `ensureIndexes()` creates the indexes from `contracts.md` §9 and is called once at start.
6. `src/lib/db/index.ts`: `getRepo()` returns `MongoRepo` when `STORE=mongo` and `MemoryRepo` when `STORE=memory`.
7. `tests/unit/repo.shared.ts`: one behaviour suite that takes a `Repo`. It runs against `MemoryRepo` always, and against `MongoRepo` only when `MONGODB_URI` is set and `RUN_DB_TESTS=1`, using a throwaway database name that it drops afterwards.
8. `scripts/smoke.ts` gains a `db` line. `/api/health` reports `db` and `store`.

**Acceptance**
- [ ] **P1.5-AC1** — Both implementations behave the same. *Verify:* `pnpm verify` runs the suite on `MemoryRepo`; `RUN_DB_TESTS=1 pnpm test` runs it on `MongoRepo`. Both pass.
- [ ] **P1.5-AC2** — Atlas is reachable from the app. *Verify:* `pnpm smoke` prints `db ok` with `STORE=mongo`.
- [ ] **P1.5-AC3** — Files round-trip. *Verify:* the suite stores a 300 KB buffer with `putFile` and reads back identical bytes.
- [ ] **P1.5-AC4** — The app runs with no database. *Verify:* `STORE=memory pnpm dev` starts and `/api/health` shows `"store":"memory","db":true`.

**Fallback.** If Atlas is unreachable from the venue, build on `STORE=memory` and try again from a phone hotspot. Nothing else in the plan waits on Atlas except the MongoDB track evidence.

---

### P1.6 — The verify loop

**Goal.** One command proves the offline layers; one proves the online ones; a third runs the page in a browser.

**Build.**
1. `pnpm verify` = `tsc --noEmit && eslint . && vitest run`. Target: under 30 seconds.
2. `pnpm e2e` = Playwright against a server it starts itself with `MOCK_LLM=1 STORE=memory`. Chromium only.
3. `pnpm smoke` = `scripts/smoke.ts`. Flags `--no-lms` and `--no-llm` skip those checks. Exit code 1 if any attempted check fails.
4. `.github/workflows/verify.yml`: on every push and pull request, install with pnpm and run `pnpm verify` and `pnpm e2e`. No secrets are needed because both run offline.
5. Protect the habit, not the branch: `AGENTS.md` already says nothing merges to `main` unless `pnpm verify` passes.

**Acceptance**
- [ ] **P1.6-AC1** — `pnpm verify` passes locally in under 60 seconds.
- [ ] **P1.6-AC2** — `pnpm e2e` passes with no network. *Verify:* turn Wi-Fi off and run it.
- [ ] **P1.6-AC3** — The workflow is green on GitHub for the Phase 1 commit.

---

### P1.7 — The build workflow

**Goal.** The team's way of working satisfies the SpaceXSI category from the first hour, and the Peri clock starts.

**Build.**
1. **Cursor.** Open the repo in Cursor. Confirm its agent picks up `AGENTS.md` by asking it "which file do you read first in this repo?" and checking that it names the plan. Take a screenshot of Cursor working on a subphase and save it as `docs/tracks/img/cursor-1.png`.
2. **Grok Bot.** Create a Bot named *Verifier* and give it a recurring task, once an hour:
   > Pull the `main` branch of `Azrkiel/albert`. Run `pnpm install`, then `pnpm verify`, then `pnpm e2e`. Reply with one line: the commit id, pass or fail for each command, and the first failing test name if any. If anything failed, open a GitHub issue titled "main is red: <commit>" with the output.

   If the Bot cannot reach the repo or run Node on its computer, change the task to something it can do and that the team will really use, for example: hourly, read `docs/plan/status.md` on GitHub and post what changed and what is next. The requirement is a real automation in the workflow, so use whichever version works. Save a screenshot of the automation and one report as `docs/tracks/img/grokbot-1.png`.
3. **Track evidence folder.** Create `docs/tracks/` with the six files named in `tracks.md`, each containing only its checklist copied from `tracks.md`.
4. **Ask the C-questions.** Take `tracks.md` §0 to the organizer and sponsor tables. Write the answers into that table.
5. **Peri outreach.** Send the message in P8.2 to at least three organizations tonight. This is listed here because it cannot wait for Phase 8.

**Acceptance**
- [ ] **P1.7-AC1** — Cursor is the coding agent and reads the plan. *Verify:* the screenshot exists.
- [ ] **P1.7-AC2** — The Grok Bot automation exists and has reported at least once. *Verify:* the screenshot exists.
- [ ] **P1.7-AC3** — `tracks.md` §0 has an answer or "asked, waiting" beside each question.
- [ ] **P1.7-AC4** — Peri outreach is sent. *Verify:* `docs/tracks/peri.md` lists who was contacted and when.

**Fallback.** If Grok Bot access is not available to anyone on the team (it needs a paid Cursor or X plan; the MLH table may have promo codes), note it in `docs/tracks/spacexsi.md` and skip the category. It is a raffle and nothing else depends on it.

---

## Phase exit — gate G0

Run these in order. All must pass before splitting into lanes.

```bash
pnpm verify          # types, lint, unit and contract tests
pnpm e2e             # five pages render
pnpm smoke           # db ok · model ok · vision ok
```

- [ ] `status.md` records the provider, the three model ids, and the store in use.
- [ ] `main` contains Phase 1 and the GitHub workflow is green.
