# Albert — Status

The live record of the build. Update it in the same commit as the work it describes.

**How to use it**
- Tick a subphase only when **every** acceptance criterion in its phase file has been verified and `pnpm verify` passes.
- In the Evidence column write the commit and what was run, briefly: `a1b2c3d · pnpm verify, e2e replay`.
- A criterion that says *Verify by hand* needs a person. An agent that has done the rest writes `needs human: P2.1-AC2` in Evidence and leaves the box unticked.
- If something is cut, write `cut` and the reason. Do not leave it blank.
- If a fallback was taken, say which.

## Clock

Fill in once the schedule is announced. `T` is the start of hacking.

| Gate | Offset | Clock time | Passed at | Notes |
|---|---|---|---|---|
| T (hacking starts) | T+0h | | | |
| G0 — foundation | T+2h | | | |
| G1 — mocked hint on the page | T+8h | | | |
| G2 — live hint in ink | T+16h | | | |
| G3 — Moodle → cards → cited hint | T+22h | | | |
| G4 — progress, plan, re-plan, report | T+28h | | | |
| G5 — feature freeze | T+31h | | | |
| G6 — submitted | T+34h | | | |
| Submission deadline | T+36h | | | |
| Peri conversation | Saturday by 3 p.m. | | | |

## Settings in use

Record the real values as they are decided. Later phases and the write-up read them from here.

| Setting | Value | Decided in |
|---|---|---|
| `LLM_PROVIDER` | `bedrock` (us-east-1) | P1.4 |
| `HINT_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` for now; P3.5 decides (Sonnet vs Haiku, or 5.5 if access is granted) | P3.5 |
| `AGENT_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | P1.4 |
| `READER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | P1.4 |
| `AGENT_PROVIDER` override | none | tracks C2 |
| `STORE` | `mongo` (Atlas); `memory` for e2e and offline | P1.5 |
| `SEND_CLEAN_IMAGE` | | P3.5 |
| `STUCK.CLUSTER_GAP` | 22 | P2.5 |
| `STUCK.PAUSE_MIN_MS` | 8000 | P2.6 |
| `INK_LEVEL` | | P4.5 |
| Handwriting font | | P4.2 |
| Demo input device | | P8.4 |
| Moodle site address | | P5.2 |
| Demo student username | | P5.2 |
| Demo path: Moodle or upload | | P5 exit |
| Cards built by: agent or flat script | | P6.5 |

## Numbers for the write-up

| Measure | Value | From |
|---|---|---|
| Eval cases | | P3.4 |
| Status correct | | `pnpm eval:hints` |
| Row correct | | `pnpm eval:hints` |
| No answer on rungs 1 and 2 | | `pnpm eval:hints` (three runs) |
| Scope | | `pnpm eval:hints` |
| Time to first ink, median | | P3.6 |
| Time to first ink, 95th percentile | | P3.6 |
| Live first-ink times, three runs | | P4.4-AC6 |
| Ingestion time | | P6.5 |
| Golden checks passed | / 13 | P6.5 |
| Re-plan time | | P6.8 |
| Demo hints on target with the demo device | / 5 | P8.4 |
| Demo run times, three runs | | P8.6 |

## Subphases

### Phase 1 — Foundation · [`phase-1-foundation.md`](./phase-1-foundation.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [x] | P1.1 Scaffold and tooling | 4 | Codex | 16e8f3d · pnpm verify (AC2); pnpm dev + Chromium: HTTP 200, page rendered, zero console/page errors (AC1); pnpm run: all 11 commands (AC3); git check-ignore .env.local (AC4); env/folder/placeholder audit; pnpm install --frozen-lockfile --offline. |
| [x] | P1.1a Reconcile scaffold with GitHub course source | 2 | Codex | 24a5d08 - pnpm verify (typecheck, lint, zero tests; exit 0); pnpm run: all 11 documented commands; env/source wording audit; tracked GitHub fixture directories, unused Moodle placeholder removed; git check-ignore .env.local. |
| [x] | P1.2 Contracts in code | 3 | Codex | this commit (P1.2: implement shared contracts and fixture validation) - pnpm verify: typecheck, lint and 138 tests passed (exit 0); 47 named schemas with inferred types and valid/invalid examples; REQUIRED_SCHEMAS matches contracts.md; Repo/CourseSourceAdapter signatures compile against the documented interfaces; all fixture mappings exercised with synthetic temporary data (zero recorded JSON fixtures); invalid JSON/schema and unmapped fixtures fail; none entries skipped; rg duplicate-type audit: HintRequest/Stroke only in contracts; git diff --check clean. |
| [x] | P1.3 App shell and brand | 2 | Codex | this commit (P1.3: add app shell and health status) - pnpm verify: typecheck, lint and 141 tests passed (138 existing contract tests + 3 health tests; exit 0); real pnpm e2e: 8 Chromium tests passed in 11.2s (five routes/headings/descriptions/shared brand, zero captured console/page errors, exact health JSON, ready/unavailable status handling; AC1); curl.exe -s localhost:3000/api/health returned {"db":false,"llm":false,"courseSource":null,"provider":"bedrock","store":"memory"} (exit 0; AC2), with MOCK_LLM=1 STORE=memory LLM_PROVIDER=bedrock; desktop/mobile screenshots inspected, no horizontal overflow at 390px, computed colors match INK; git diff --check clean. |
| [x] | P1.4 Model access | 5 | Codex, Claude | this commit (P1.4: model provider adapter and smoke checks) - pnpm verify: typecheck, lint and 174 tests passed (36 llm/health/smoke tests plus 138 existing contract tests; exit 0). AC3: mocked constructors cover Bedrock, Anthropic and xAI with no sampling parameters; AC4: agent override leaves hint/reader on the base provider and rejects xAI for those roles. Health tests cover 60-second caching, concurrent pings, failures, configuration changes and offline mode. pnpm e2e: all 8 Chromium tests passed in 23.4s after deferring SDK loading in offline health checks (existing timeout unchanged). pnpm build passed; health is dynamic; two production health requests with MOCK_LLM=0 returned the exact five-key JSON and llm=false (exit 0). Generated and inspected fixtures/eval/ping.png. pnpm smoke printed `model fail 0ms (HINT_MODEL_ID unset)` and `vision fail 0ms`, exit 1: no .env.local, credentials or model ids configured. Default provider is bedrock; chosen live provider/model ids remain unset. Code/security/cleanup review and git diff --check clean. G0 integration (Nov 14): merged main; smoke prints db, model, vision; health db from Repo, llm from cached ping. Live run with LLM_PROVIDER=bedrock, all roles us.anthropic.claude-sonnet-4-6, STORE=mongo: `db ok 3214ms` / `model ok 759ms us.anthropic.claude-sonnet-4-6` (AC1) / `vision ok 918ms 2 + 2 = 5` (AC2); provider and ids recorded in Settings (AC5). AC3/AC4 by mocked-constructor and override unit tests. |
| [x] | P1.5 Database | 4 | Codex | 248e5dd + this evidence update · pnpm verify: typecheck, lint, 179 passed and 16 live tests skipped offline. User-provided final Atlas run: 6 files, 195 passed, no skips in 16.44s; all 16 Mongo behavior tests passed (AC1), including the 300 KB file round-trip (AC3). User local Atlas smoke: db ok 2636ms (AC2). STORE=memory pnpm dev + GET /api/health returned db:true/store:memory (AC4). Also reproduced missing dropDatabase permission on real local MongoDB 8.0.38 with readWriteAnyDatabase: all 195 tests passed after the cleanup fix, and an independent admin query verified zero leftover test databases. Cleanup verifies database absence and preserves failure reporting. No credentials committed. |
| [ ] | P1.6 The verify loop | 3 | Claude | G0 integration commit · AC1: pnpm verify 36s wall clock (typecheck, lint, 273 passed, 16 live tests skipped). pnpm e2e: 21 passed, 1 skipped (production replay, opt-in) in 31s with MOCK_LLM=1 STORE=memory; fixed the stale P1.3 health e2e expectation (db is true for STORE=memory since P1.5-AC4). pnpm smoke: `STORE=memory pnpm smoke --no-llm --no-source` printed `db ok`, exit 0; without model config it printed `model fail`/`vision fail`, exit 1. Added .github/workflows/verify.yml (pnpm verify + pnpm e2e on push and pull_request). needs human: P1.6-AC2 (Wi-Fi-off run). AC3: verify workflow green on GitHub for PR #4 (run 43572483313: install, pnpm verify, Playwright install, pnpm e2e); re-check on main after merge. |
| [ ] | P1.7 The build workflow | 4 | | Step 3 done: docs/tracks/ created with the six checklists from tracks.md, img/ folder, and an outreach log table in peri.md. needs human: P1.7-AC1 (Cursor screenshot), AC2 (Grok Bot automation), AC3 (tracks.md §0 answers), AC4 (Peri outreach). |
| [ ] | **Gate G0** | | | pnpm verify and pnpm e2e pass; Smoke now prints db ok / model ok / vision ok. Blocked on: P1.6-AC2/AC3, P1.7 human items, PR #4 merged to main. |

### Phase 2 — Canvas · [`phase-2-canvas.md`](./phase-2-canvas.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [x] | P2.1 Work surface and stroke capture | 4 | Codex | this commit (P2.1: capture timed strokes on the work surface) · P1.2 contracts/P1.3 shell available; broader G0 still pending. Test-first: missing capture module and missing browser surface failed as expected; hover-palm regression failed before its fix. P2.1-AC1: 25 capture/path unit tests pass. pnpm verify run: typecheck/lint pass, inherited 5s contract-test timeouts reproduced before source changes; pnpm verify --testTimeout=15000: all 166 tests pass. pnpm e2e: 13 Chromium tests pass (5 capture, 8 existing shell), including rendered clipping pixels, outside capture, cancel/lost-capture termination, and resize geometry. Local code/security/cleanup review and git diff --check pass. Added only perfect-freehand 1.2.3; additive work-page mount preserves heading/description/shell; shared upstream files rechecked, no Phase 5 task/loader visible. No PDFs accessed. Human report Nov 14: window resizing keeps ink anchored (P2.1-AC4 passed); mouse responsiveness passed the quick-writing check (P2.1-AC2 partially verified); browser zoom stability also reported. Touch/Wacom checks were initially deferred. Follow-up human report Nov 14: Wacom stylus and phone finger writing work (P2.1-AC2 passed across mouse/finger/stylus); phone stays still while drawing, with no scroll/zoom (P2.1-AC3 passed). All P2.1 acceptance checks now pass. Fresh plain pnpm verify: typecheck/lint and all 166 tests pass with the default timeout (earlier timing failures above retained as history). Phone UX feedback: writing boundary is hard to identify; column styling remains P2.2 scope. |
| [x] | P2.2 Problems and rows | 3 | Codex | f330a44 (P2.2: assign strokes to growing problem rows) - based on P2.1 e0006a9; contracts/capture/perfect-freehand available, broader G0 and earlier human checks still pending. Test-first: missing rows module and missing two-block browser UI failed as expected; clipped-margin and three-row tie edge tests failed before fixes. P2.2-AC1/AC3 and automated AC2: 20 rows/state unit tests pass (single row, 70/30, first-point ties, tall integral, boundaries/clipping, growth and two-problem ownership). pnpm verify run: typecheck/lint pass; inherited 5s contract-test timeouts reproduced before source changes and remain intermittent; pnpm verify --testTimeout=15000 passes all 186 tests. pnpm e2e: 16 Chromium tests pass (3 rows, 5 capture, 8 shell), including last-row growth, independent problems and resize relative to rules. Local code/security/cleanup review and git diff --check pass. No dependency or shared-contract changes; no Phase 5 task/loader visible, ProblemBlock accepts existing Worksheet problem metadata for its owner to integrate; route retains shell and local demo context. Existing local edits and earlier evidence preserved. No PDFs accessed. Follow-up Nov 14: synchronized with main 71b6fc5, preserving completed P2.1 human acceptance evidence from 34f793d; earlier P2.1 pending notes above are historical. Fresh plain pnpm verify passes typecheck/lint and all 186 tests with the default timeout; fresh pnpm e2e passes all 16 Chromium tests. Human report and two screenshots Nov 14: writing in row 4 adds row 5; writing in row 5 adds row 6, including when earlier rows are blank (P2.2-AC2 passed). Follow-up human report and resize screenshots Nov 14: ink remains aligned with its ruled rows after resizing (P2.1-AC4 repeat passed). All P2.2 acceptance checks now pass. |
| [x] | P2.3 Record and replay | 4 | Codex | this commit (P2.3: record and replay worksheet sessions) - based on origin/main 28cc02f, including P2.1 and P2.2 final acceptance 84e861e (PR #7); broader G0 remains pending. Test-first: missing recording module, replay hook and toolbar failed as expected; sink cancellation/error, asynchronous replacement and restart regressions failed before fixes. P2.3-AC1/AC2: 11 recording unit tests pass, including exact strokes/points/IDs/timing, both problems' metadata and growing rows, recorded row associations, 8000ms at 2000ms at 4x, malformed imports, seek/resume and replacement/cancellation. P2.3-AC3: real-page instant sample replay, exact state/three completed paths, export/load/restart, repeat and asynchronous loads, live two-problem round trip, opt-in tools and traversal rejection pass. P2.3-AC4: sample.json captured through the real canvas and Export toolbar; three synthetic automated mouse loops on rows 1-3 of the canonical demo problem, explicitly not human handwriting or a worked solution; original IDs/points/timing retained; existing fixture contract validator passes. Fresh plain pnpm verify: typecheck/lint and all 197 unit/contract tests pass. Baseline before source changes reproduced two inherited 5s contract-test timeouts; final runs pass unchanged default timeouts. Fresh pnpm e2e: all 21 development Chromium tests pass (capture, rows, shell and replay); production-only test skipped there and separately passes with ALBERT_E2E_PRODUCTION=1 after pnpm build, confirming no toolbar, fixture access, replay or window.__albert in production. Local code/security/cleanup review and git diff --check pass. No active Phase 5 owner/loader found; worksheet metadata interface and existing Suspense boundary preserved. No dependencies/contracts changed, no course PDFs accessed; original edits and prior acceptance evidence preserved. P2.4 not started. |
| [ ] | P2.4 Erase and undo | 3 | | |
| [ ] | P2.5 Clusters | 3 | | |
| [ ] | P2.6 Stuck detection | 4 | | |
| [ ] | P2.7 Snapshots | 5 | | |
| [ ] | P2.8 Session sync | 3 | | |
| [ ] | Seven recordings checked in | | | |

### Phase 3 — Tutor brain · [`phase-3-tutor-brain.md`](./phase-3-tutor-brain.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [ ] | P3.1 The route, mocked | 4 | | |
| [ ] | **Gate G1** (P3.1-AC4) | | | |
| [ ] | P3.2 A hand-written teaching card | 3 | | |
| [ ] | P3.3 The prompt and the reply | 5 | | |
| [ ] | P3.4 The eval set | 4 | | |
| [ ] | P3.5 Choose the model and the image mode | 2 | | |
| [ ] | P3.6 Streaming | 4 | | |
| [ ] | P3.7 Check | 3 | | |
| [ ] | P3.8 Failure behaviour | 4 | | |

### Phase 4 — Ink · [`phase-4-ink.md`](./phase-4-ink.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [ ] | P4.1 Layout | 4 | | |
| [ ] | P4.2 Text and math, level 0 | 4 | | |
| [ ] | P4.3 Marks | 4 | | |
| [ ] | P4.4 The conductor | 6 | | |
| [ ] | **Gate G2** (P4.4-AC6) | | | |
| [ ] | P4.5 Handwriting, level 1 | 3 | | |
| [ ] | P4.6 Finish | 3 | | |

### Phase 5 — LMS · [`phase-5-lms.md`](./phase-5-lms.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [ ] | P5.1 The seed course | 4 | | |
| [ ] | P5.2 The Moodle site | 4 | | |
| [ ] | P5.3 The Moodle adapter | 5 | | |
| [ ] | P5.4 The upload path | 3 | | |
| [ ] | P5.5 Connect and choose | 3 | | |
| [ ] | P5.6 The worksheet page | 4 | | |
| [ ] | P5.7 The Canvas stub | 1 | | |

### Phase 6 — Course agent · [`phase-6-course-agent.md`](./phase-6-course-agent.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [ ] | P6.1 The functions, without any agent | 4 | | |
| [ ] | P6.2 The agent skeleton | 5 | | |
| [ ] | P6.3 Tools | 4 | | |
| [ ] | P6.4 Skills and sub-agents | 3 | | |
| [ ] | P6.5 Ingest the seed course | 5 | | |
| [ ] | **Gate G3** (P6.5-AC5) | | | |
| [ ] | P6.6 Routes and the run panel | 4 | | |
| [ ] | P6.7 The study plan | 4 | | |
| [ ] | P6.8 Re-plan and memory | 5 | | |

### Phase 7 — Progress · [`phase-7-progress.md`](./phase-7-progress.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [ ] | P7.1 Evidence | 3 | | |
| [ ] | P7.2 Skill levels | 4 | | |
| [ ] | P7.3 The course page | 4 | | |
| [ ] | P7.4 The tutor report | 4 | | |
| [ ] | P7.5 Ending a session | 4 | | |
| [ ] | **Gate G4** (P7.5-AC4) | | | |

### Phase 8 — Ship · [`phase-8-ship.md`](./phase-8-ship.md)

| Done | Subphase | Criteria | Owner | Evidence |
|---|---|---|---|---|
| [ ] | P8.2 The Peri conversation — outreach sent (Friday) | | | |
| [ ] | P8.2 The Peri conversation | 4 | | |
| [ ] | P8.1 The whole path, tested | 3 | | |
| [ ] | P8.3 Track evidence | 3 | | |
| [ ] | P8.4 Demo hardening | 4 | | |
| [ ] | **Gate G5 — feature freeze** | | | |
| [ ] | P8.5 README and project description | 3 | | |
| [ ] | P8.6 The demo | 3 | | |
| [ ] | P8.7 Stretch goals (list which were done) | — | | |
| [ ] | P8.8 Submit | 3 | | |
| [ ] | **Gate G6 — submitted** | | | |

## Log

Newest first. One line per notable event: a gate passed, a fallback taken, a decision changed, something cut.

| When | Who | What |
|---|---|---|
| Nov 14 | Claude | P1.4 live: the Bedrock account (us-east-1) returns `not available for this account` for every Claude 5.x model and Opus 4.7; Sonnet 4.6 and Haiku 4.5 work. All three roles run on Sonnet 4.6 for now (user's choice; Sonnet 4.6 scored 42/42 on a 14-case calculus solve/find-the-error spot check, as did Haiku 4.5). Plan's starting ids (`us.anthropic.claude-sonnet-5`) are not usable on this account. Asking the Amazon rep for 5.x access; P3.5 picks the hint model on the eval set. IAM user needs AmazonBedrockFullAccess + AWSMarketplaceManageSubscriptions. |
| Nov 14 | Claude | G0 integration: merged main (P1.5, P2.1–P2.3) into p1.4-llm and retargeted PR #4 to main. Combined the P1.4 and P1.5 smoke scripts into one runner with `--no-llm` / `--no-source` flags (source check arrives with P5.3), merged the health route so db comes from the Repo and llm from the cached ping, fixed main's stale health e2e expectation, added the GitHub verify workflow and docs/tracks/. No credentials used or committed; live model checks remain for a person. |
| Nov 13 | Codex | Completed P1.3 only. Added brand constants, five stub pages, paper-white shared layout using INK through the contracts barrel, and a status dot reading the five-key health route. Tests first confirmed missing pages/health; the real browser run then caught an explicit runtime export incompatible with the scaffold's cacheComponents setting, fixed by using Next.js's default Node runtime. Final verify and real e2e passed; curl confirmed the placeholders. Local code/security/cleanup review found no remaining issues. P1.1/P1.1a/P1.2 implementation and evidence preserved, existing local plan edits retained. No dependencies added, no database/model/source access, no albert-files requests or PDFs read; manifest remains P5.2 and P1.4+ remains unstarted. |
| Nov 13 | Codex | Completed P1.1a then P1.2 only. P1.1 evidence preserved. Added GitHub source env/folders and 47 runtime contracts; service interfaces stay compile-time only. Tests first exposed missing schemas, then an import-order cycle; fixed with lazy schema construction and verified 138 tests. Local code/security/cleanup review: no remaining findings. No albert-files requests or PDF bodies read; manifest creation remains P5.2. Existing pnpm installation used through a local PATH shim; no dependency changes |
| Nov 13 | — | Plan written. Repo contains the plan only; no code yet |
