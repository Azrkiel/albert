# Working in this repo

This repo is **Albert**, a handwriting-first math tutor built for HackPrinceton Fall 2026. The whole build is planned in `docs/plan/`. You work from that plan.

## Read these first, in this order

1. `docs/plan/00-main-plan.md` — what Albert is, how it fits together, the order of work. Read all of it once.
2. `docs/plan/contracts.md` — the data shapes, routes, constants, env vars and commands. Your code must match it.
3. `docs/plan/status.md` — what is done and what is next.
4. The phase file for the work you are about to do (`docs/plan/phase-N-*.md`).
5. `docs/plan/decisions.md` — when you are about to choose a library or a design, check whether it is already decided.

`docs/plan/tracks.md` explains the prize tracks. Read it before touching anything it names.

## How to pick work

1. Open `status.md`. Find the first unticked subphase in your lane whose phase dependencies are met (the table at the top of each phase file says what it depends on).
2. Read that subphase in its phase file from **Goal** to **Fallback**.
3. Do exactly that subphase. Do not start the next one in the same change.

## How to do a subphase

1. Build what **Build** describes, in the files it names.
2. Write the tests its **Acceptance** criteria name. Tests come with the code, not later.
3. Run `pnpm verify`. Fix until it passes.
4. Run each criterion's **Verify** step and look at the result.
5. Update `status.md`: tick the subphase if every criterion passed, and write the commit and what you ran in Evidence.
6. Commit with the subphase id first: `P2.5: cluster strokes within a row`.

## Rules

- **Verified means run and seen.** Never tick a box because the code looks right.
- **Criteria marked "Verify by hand" need a person.** Do everything else, then write `needs human: <criterion id>` in the Evidence column and leave the box unticked. Do not claim a manual check you did not do.
- **Contracts are shared.** Import types from `src/lib/contracts` only. If a shape must change, change the zod schema, `docs/plan/contracts.md` and every fixture in the same commit, and say so in the commit message.
- **Validate model output.** Anything a model returns is parsed with zod and checked before use. See `decisions.md` D15.
- **Keep pure logic pure.** Row assignment, clustering, stuck detection, layout, level computation and validators are plain functions with unit tests and no DOM, network or clock inside them. Pass time in as an argument.
- **Keep the two paths apart.** `src/lib/tutor` (hints) never imports from `src/lib/agent` (the course agent), and the other way round. Both read and write through `src/lib/db`.
- **No secrets in the repo.** Keys, tokens and passwords live in `.env.local`. Recorded fixtures must have tokens redacted.
- **Do not weaken a criterion to make it pass.** If it cannot be met, take the subphase's **Fallback**, or change the criterion in the plan in the same commit and explain why in `status.md`.
- **Thirty-minute rule.** If you are stuck on one thing for 30 minutes, take the fallback and record it.
- **Check current docs for fast-moving libraries** before coding against them: `deepagents`, LangChain model packages, the Bedrock model ids, MathJax. The plan lists the pages in `00-main-plan.md` §9. Trust the installed package's types over the plan's snippets.
- **Stay in scope.** `00-main-plan.md` §8 lists what is not being built. Stretch goals are in `phase-8-ship.md` P8.7 and are not started before gate G4.
- **`main` must run the demo** from gate G2 onward. Work on a branch; merge only what passes `pnpm verify` and `pnpm e2e`.

## Commands

| Command | Use |
|---|---|
| `pnpm dev` | Run the app |
| `pnpm verify` | Type-check, lint, unit and contract tests. Run before every commit |
| `pnpm e2e` | Browser tests with recorded strokes and recorded model replies. No network needed |
| `pnpm smoke` | Check the database, the model and Moodle are reachable |
| `pnpm eval:hints` | Score hint quality and speed against the live model |
| `pnpm agent:ingest -- --course <id> --check` | Run course ingestion and its golden checks |
| `pnpm check:tracks` | Check each prize track's evidence is in place |

To run everything with no keys and no network: `STORE=memory MOCK_LLM=1 pnpm dev`.

## Conventions

- TypeScript, strict. No `any` in `src/lib`.
- One module per folder under `src/lib`, each with an `index.ts` that is its public surface.
- Tests live in `tests/unit` and `tests/e2e`, named after what they test.
- Fixtures live in `fixtures/` and are validated by the contract test.
- New dependencies need a reason in the commit message. The plan already names the ones it expects.
- Text shown to students is plain and short. Albert does not praise, scold or pad.

## If something in the plan is wrong

The plan was written before any code existed. When reality disagrees with it, fix the plan in the same commit as the code and add a line to the Log in `status.md`. A plan that no longer matches the repo is worse than no plan.
