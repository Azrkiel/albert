# Albert — Contracts

The shared shapes every module agrees on. Phase 1 turns this file into zod schemas in `src/lib/contracts/`, one file per section, and every type below is then `z.infer` of its schema. After that, the code is the source of truth and this file is kept in step with it.

`Repo` and `CourseSourceAdapter` describe service behavior and remain TypeScript interfaces. They have no runtime data schema; the schema-completeness test covers the named data types, while a compile-time check covers both interfaces.

**Rules**

- Every API route parses its input and its output with these schemas.
- Everything a model returns is parsed with these schemas before it is used. A parse failure is handled, never ignored (see §4.5).
- Changing a shape means changing the schema, this file, and every fixture that uses it, in one commit.
- Ids are opaque strings. The formats shown are recommendations that make logs readable.

Types are written as TypeScript for reading. `ISO` means an ISO 8601 timestamp string. `ms` means milliseconds.

---

## 1. Page geometry

The work surface uses one fixed logical coordinate system so that strokes mean the same thing on every screen. The surface is scaled to fit with CSS; stored coordinates are always logical.

```ts
const PAGE = {
  width: 1200,                 // logical px
  studentCol: { x: 0,   w: 760 },   // the student writes here
  gutter:     { x: 760, w: 30 },
  albertCol:  { x: 790, w: 410 },   // Albert writes here
  rowHeight: 128,              // was 84; raised after P2.5-AC3: a hand-written stacked fraction was ~125 px tall
  rowPaddingTop: 10,
  statementMinHeight: 96,      // space above the rows for the problem statement
} as const;

const LINE = {                 // free layout only (P2.5a): lines inferred from ink
  GAP: 16,                     // logical px; fraction parts within this of their bar join its line…
  GAP_PER_HEIGHT: 0.5,         // …or within this share of the part's own height, if larger (big writing)
  MIN_OVERLAP: 0.3,            // share of the shorter height a stroke must overlap a line to join it…
  REACH: 0.5,                  // …or its centre lies within this many glyph heights of the line's ink
  PAD: 8,                      // logical px added above and below a line's ink for its row box
  DIVIDER_MIN_HEIGHT: 120,     // P2.5b: a divider is at least this tall…
  DIVIDER_MIN_GLYPHS: 3,       // …and this many times the median letter height written before it…
  DIVIDER_MAX_WIDTH_RATIO: 0.15, // …no wider than this × its height…
  DIVIDER_MAX_PATH_RATIO: 1.1, // …and nearly straight: path length ÷ distance between its ends
} as const;

const INK = {
  student: "#1b1b1f",
  albert:  "#c8321e",
  clusterLabel: "#2f6fdb",     // numbers drawn on snapshots only, never on screen
} as const;

type BBox = { x: number; y: number; w: number; h: number };  // logical px
```

## 2. Strokes

```ts
type Point = {
  x: number; y: number;        // logical px on the work surface
  t: number;                   // ms since the session started
  p: number;                   // pressure 0..1; 0.5 when the device reports none
};

type Stroke = {
  id: string;                  // "st_" + nanoid
  problemId: string;
  rowId: string | null;        // null only while the stroke is in progress
  tool: "pen" | "eraser";
  pointerType: "pen" | "touch" | "mouse";
  points: Point[];
  t0: number; t1: number;      // first and last point time
  bbox: BBox;
  erasedAt?: number;           // set when an eraser or undo removed it; strokes are never deleted
};

type Row = {
  id: string;                  // `${problemId}/r${n}`: ruled, n = index; free, n = creation order, never reused
  problemId: string;
  index: number;               // 1-based within the problem, top to bottom
  bbox: BBox;                  // ruled: the student-column band; free: the line's column (dividers bound it) around its ink ± LINE.PAD
};

type Cluster = {
  id: string;                  // `${rowId}/c${label}`
  rowId: string;
  label: number;               // 1-based, left to right within the row
  strokeIds: string[];
  bbox: BBox;
};
```

**Row assignment (ruled layout).** A stroke belongs to the row that contains the largest share of its points. Ties go to the row containing the stroke's first point.

**Line assignment (free layout, P2.5a).** A row is a line of work inferred from the ink; its band is the vertical extent of its live pen strokes. A finished pen stroke joins the line it overlaps most vertically, if the overlap is at least `LINE.MIN_OVERLAP` of the shorter height or its centre lies within `LINE.REACH` × the line's median glyph height (non-flat strokes) of the line's ink (ties: larger overlap, nearer band centre, then older line). Otherwise it joins a line through a fraction: it is centred over or under a flat stroke (width ≥ 3× height) of that line, or it is itself flat and covers the centre of a stroke of that line (sideways, the bar's ends get the same tolerance as the gap), with a vertical gap of at most `max(LINE.GAP, LINE.GAP_PER_HEIGHT × the height of the part that is not the bar)`. Otherwise it starts a new line. Assignment happens once, when the stroke ends, and is recorded. Indexes are recomputed top to bottom over lines with live ink; a line whose ink is all erased keeps its row (so undo can restore it), numbered after the lines with ink.

**Dividers (free layout, P2.5b).** A long, near-vertical, nearly straight pen stroke (`LINE.DIVIDER_*`) is a divider; "long" is relative to the letters written before it in the problem, so a "1" never counts and a stroke's status never changes later. A stroke never joins ink on the other side of a live divider whose height covers both strokes' centres, so side work starts its own lines. Indexes run through the main column top to bottom, then each side column; a divider gets its own unnumbered row, placed last, and is never clustered.

**Clustering.** Within a row, sort live pen strokes by `bbox.x` (ties by `t0`, then `id`). Start a new cluster when the horizontal gap between a stroke's left edge and the current cluster's right edge (the running maximum) exceeds `CLUSTER_GAP`. Strokes that overlap horizontally join (this keeps an integral sign with its limits, an `=` and an `i` together).

**Fractions.** A stroke at least 3× wider than tall, with ink centred above it and below it within its x-range, is a fraction bar. Its clusters are the numerator's, then the bar, then the denominator's, so Albert can circle the numerator or the denominator as a run of adjacent labels. Ink just past the bar's ends that lies wholly above or below its centre line, within `CLUSTER_GAP` of that side's ink (an exponent on the denominator), joins that side. The widest bar splits first; numerators and denominators are clustered by the same rules, so nested fractions work. A flat stroke with ink on one side only (a minus sign, an overline) follows the gap rule. Labels run left to right, with a fraction placed by its left edge.

## 3. Session events and stuck signals

```ts
type SessionEvent =
  | { type: "stroke_end"; at: number; stroke: Stroke }
  | { type: "erase"; at: number; strokeIds: string[]; rowId: string }
  | { type: "undo"; at: number; strokeIds: string[]; rowId: string; redo?: true }
  | { type: "stuck"; at: number; signal: StuckSignal }
  | { type: "hint_requested"; at: number; hintId: string; rowId: string; rung: Rung }
  | { type: "hint_shown"; at: number; hintId: string; marks: AlbertMark[] }
  | { type: "check_requested"; at: number; problemId: string }
  | { type: "check_result"; at: number; problemId: string; verdict: Verdict }
  | { type: "problem_opened"; at: number; problemId: string };

type StuckSignal = {
  kind: "pause" | "erase_loop" | "cross_out" | "manual";
  problemId: string;
  rowId: string;
  at: number;
  detail?: { pauseMs?: number; eraseCount?: number; crossedClusterIds?: string[] };
};

const STUCK = {
  PAUSE_MIN_MS: 8000,          // never fire sooner than this
  PAUSE_MAX_MS: 20000,         // never wait longer than this
  PAUSE_FACTOR: 2.5,           // threshold = clamp(FACTOR × median gap between strokes)
  ERASE_LOOP_COUNT: 2,         // erase or undo actions on one row…
  ERASE_LOOP_WINDOW_MS: 45000, // …within this window
  CROSS_OUT_COVERAGE: 0.6,     // a stroke covering this share of existing ink in a row
  CROSS_OUT_MIN_LENGTH_RATIO: 1.2, // path length ÷ bbox diagonal
  REARM_ON: "new_ink",         // one signal per row until the student writes again
  CLUSTER_GAP: 4,              // logical px; tuned in P2.5-AC3 (real gaps between symbols were 4–15 px)
} as const;
```

**Undo/redo (P2.4).** An ordinary `undo` event reverses the most recent drawing or row erase action; `undo` with `redo: true` reapplies the most recently undone action. Both name exactly that action's stroke IDs and row. Drawing/erasing starts a new edit and clears the redo stack. An empty action emits no event. Undo of drawing sets `erasedAt` to the event time; undo of erasing removes `erasedAt`. Redo of drawing removes it; redo of erasing stamps the redo time. IDs, original points and stroke timing never change, and `stroke_end` is never duplicated. The common reducer derives both stacks during live use and replay. The optional flag disambiguates history direction without introducing a new event type; existing recordings and canonical undo payloads remain valid. Eraser gestures emit one `erase` event per affected row, at the supplied gesture completion time, containing only that row's intersected live pen strokes. Clear row uses the same event with all live pen strokes in the row. Stylus `buttons & 32` selects the eraser for that gesture.

The detector is a pure function: `detectStuck(events: SessionEvent[], now: number, rows: Row[], clusters: Cluster[]) => StuckSignal | null`. It holds no timers. The page calls it on each event and on a one-second tick.

## 4. Hints

### 4.1 Request

```ts
type Rung = 1 | 2 | 3;         // 1 question · 2 next step named · 3 one worked step

type HintRequest = {
  sessionId: string;
  worksheetId: string;
  problemId: string;
  rowId: string;               // the stuck row
  rung: Rung;
  trigger: StuckSignal["kind"];
  problemSource?: "worksheet" | "handwriting"; // omitted means worksheet (legacy callers)
  image: {
    marked: string;            // base64 PNG: rows 1..stuck, with row tags and cluster numbers
    clean?: string;            // base64 PNG without marks; general handwriting includes it; worksheet opt-in
    width: number; height: number;
  };
  rows: Array<{ rowId: string; index: number; clusterLabels: number[] }>;
  history: HintTurn[];         // earlier hints on this problem in this session, oldest first
  fixtureId?: string;          // used only with MOCK_LLM=1
};

type HintTurn = {
  hintId: string; rung: Rung; rowId: string;
  text: string;                // the hint as plain text, math as LaTeX in $…$
  studentWroteAfter: boolean;  // did new ink appear after this hint
};
```

**Problem source.** Worksheet hints load the assigned problem and its unit teaching card; the page must display that assigned exercise. General calculus explicitly sends `problemSource: "handwriting"`: the first handwritten problem and subsequent visible rows are authoritative. This path loads no worksheet or course scope, omits course citations/subskills/deferred units, and stores neither course hints nor skill evidence. The ordinary ladder, pointing, privacy, deadline and logging rules still apply. `inScope: true` on a general hint means no course scope is asserted. General snapshots include an unlabelled copy alongside the marked image so blue labels do not obscure transcription. Missing/illegible problem ink asks for a reread rather than inventing an exercise. The optional field also flows into the derived `CheckRequest`; a future general check must not create course evidence. Mock general requests use course-free `handwriting-r1` through `handwriting-r3` fixtures; worksheet mocks are unchanged.

**Snapshot rendering.** White background, black ink, 2× device scale, cropped to the union of the rows' ink plus 24 px padding, scaled down so the longer side is at most 1400 px. In the marked image each row has a tag `R1`, `R2`, … at its left edge and each cluster has its number above it in `INK.clusterLabel` at 14 px.

### 4.2 The model's reply

The model answers by calling **one** tool, `albert_reply`, exactly once. The call is forced, so a complete reply is guaranteed. Its input has four parts, and the schema lists them in the order the model must write them: read first, then judge, then point, then speak.

```ts
type AlbertReply = {
  reading: ReadWork;           // 1
  diagnosis: Diagnose;         // 2
  marks: Mark[];               // 3 — zero to three
  hint: WriteHint;             // 4
};

// 1
type ReadWork = {
  rows: Array<{ index: number; latex: string; confidence: "high" | "medium" | "low" }>;
};

// 2
type Diagnose = {
  status: "error" | "on_track" | "stalled" | "unreadable";
  rowIndex?: number;           // the first row that is wrong (status "error")
  clusterLabels?: number[];    // the wrong symbols in that row
  errorType?: string;          // snake_case, e.g. "missing_dx", "sign_error", "wrong_substitution"
  subskillId?: string;         // must be one of the subskills in the scope bundle
  privateNote: string;         // what is actually wrong; never shown to the student
  easierOutOfScope?: { methodName: string; unitId: string };
};

// 3
type Mark =
  | { type: "circle" | "underline" | "cross_out"; rowIndex: number; clusterLabels: number[] }
  | { type: "arrow"; fromHint: true; toRowIndex: number; toClusterLabels: number[] };

// 4
type WriteHint = {
  kind: "question" | "nudge" | "next_step" | "worked_step" | "reread";
  segments: InkSegment[];
  citation?: { unitId: string; label: string };   // e.g. "Lecture 9, Step 2"
};

type InkSegment =
  | { type: "text"; text: string }
  | { type: "math"; latex: string }
  | { type: "break" };
```

### 4.3 Stream from server to browser

`POST /api/hint` replies with `application/x-ndjson`, one event per line.

```ts
type HintEvent =
  | { type: "started"; hintId: string; at: number }
  | { type: "reading"; rows: Array<{ rowId: string; latex: string; confidence: string }> }
  | { type: "diagnosis"; status: Diagnose["status"]; rowId?: string; clusterIds?: string[];
      errorType?: string; subskillId?: string; inScope: boolean;
      deferredMethod?: { name: string; unitId: string; unitTitle: string } }
  | { type: "mark"; mark: AlbertMarkSpec }
  | { type: "hint"; kind: WriteHint["kind"]; segments: InkSegment[];
      citation?: { unitId: string; label: string } }
  | { type: "done"; hintId: string; ms: { firstEvent: number; total: number } }
  | { type: "error"; hintId?: string; code: HintErrorCode; message: string };

// The server has already turned row indexes and cluster labels into ids.
type AlbertMarkSpec =
  | { type: "circle" | "underline" | "cross_out"; rowId: string; clusterIds: string[] }
  | { type: "arrow"; toRowId: string; toClusterIds: string[] };

type HintErrorCode = "model_unavailable" | "bad_model_output" | "timeout" | "bad_request";
```

`privateNote` never leaves the server. It is stored with the hint for the tutor report and for evidence.

### 4.4 Rules the server enforces on every hint

| Rule | Check |
|---|---|
| Rung 1 is a question | `kind` is `question` or `nudge`, the text ends with `?`, at most 18 words, at most one math segment |
| Rung 2 names a step and does not perform it | `kind` is `next_step`, at most 24 words, no math segment containing `=` |
| Rung 3 shows one step | `kind` is `worked_step`, at most two math segments |
| Scope | `diagnose.subskillId` is in the scope bundle. No method name from `upcomingMethods` appears in the hint except inside a sentence that defers it |
| Pointing | Every `clusterLabel` exists in the named row. Unknown labels are dropped and the mark falls back to the whole row |
| Unreadable work | `status: "unreadable"` forces `kind: "reread"`, no marks, no evidence |

### 4.5 When the model's output is wrong

1. Parse failure or a failed rule: retry once with the validation error appended to the prompt.
2. Second failure: send `{ type: "error", code: "bad_model_output" }`. The page shows "Albert couldn't read that. Try again?" and nothing is drawn.
3. A reply slower than `HINT_TIMEOUT_MS` (12000): abort and send `timeout`.

### 4.6 Marks on the page

```ts
type AlbertMark = {
  id: string; hintId: string; problemId: string;
  spec: AlbertMarkSpec | { type: "writing"; rowId: string; segments: InkSegment[]; citation?: string };
  bbox: BBox;                  // where it was drawn, for replay and for clearing
  drawnAt: number;
};
```

## 5. Check

```ts
type CheckRequest = Omit<HintRequest, "rung" | "trigger" | "rowId"> & { finalRowId: string };

type Verdict = "correct" | "not_yet" | "unreadable";

type CheckResponse = {
  verdict: Verdict;
  reading: Array<{ rowId: string; latex: string }>;
  firstWrongRowId?: string;    // present when verdict is "not_yet"; the page offers a hint there
  subskillIds: string[];       // the subskills this problem exercised
};
```

A check never reveals the answer or the wrong step's fix. On `not_yet` the page shows "Not yet. Want a hint?" and a tap sends a rung 1 `HintRequest` for `firstWrongRowId`.

## 6. Course content

```ts
type Course = {
  id: string;                  // "github:<owner>/<repo>:<manifestPath>~<manifestId>:<sha>:<demoDay>" | "upload:<uuid>"
  source: "github" | "upload";
  snapshot?: GitHubSnapshot;   // required when source is github; pins files and dates
  title: string; shortName?: string;
  ingestedAt?: ISO;
  unitIds: string[];           // in teaching order
};

type CourseFile = {
  id: string; courseId: string; unitId?: string;
  title: string; mime: string; bytes: number;
  kind: "lecture_notes" | "slides" | "worksheet" | "syllabus" | "other";
  sourceUrl?: string;          // never sent to the browser with a token in it
  textCacheId?: string;        // extracted text and LaTeX, cached after first read
};

type TeachingCard = {
  unitId: string;              // `${courseId}/u${order}`
  courseId: string;
  order: number;               // 1-based teaching order
  title: string;
  taught: boolean;             // true: built from lecture notes. false: names only, from the syllabus
  lectures: Array<{ label: string; fileId: string }>;          // "Lecture 9"
  methods: Array<{ id: string; name: string; summary: string; steps: string[]; lecture: string }>;
  notation: Array<{ concept: string; teacherWrites: string; avoid: string[]; note?: string }>;
  workedExamples: Array<{ label: string; problemLatex: string; stepsLatex: string[];
                          methodIds: string[]; fileId: string; page: number }>;
  conventions: string[];       // "Always draw the reference triangle before converting back."
  pitfalls: Array<{ description: string; subskillId: string; errorType: string }>;
  subskills: Array<{ id: string; name: string; description: string }>;   // 3 to 8 per unit
  sourceFileIds: string[];
  builtBy: "agent" | "flat_script" | "hand";
};

type Worksheet = {
  id: string; courseId: string; unitId: string;
  title: string; fileId: string;
  dueAt?: ISO; assignmentId?: string;
  problems: Array<{
    id: string;                // `${worksheetId}/p${label}`
    label: string;             // "1", "2a"
    statementLatex: string;    // the problem as text with LaTeX in $…$
    page: number;
    region?: { page: number; bbox: BBox }; // R2.1: 1-based PDF page, top-left logical px at PAGE.width
    subskillIds: string[];     // at least one; all from units with order ≤ this worksheet's unit
    methodIds: string[];
  }>;
};

type ScopeBundle = {
  worksheetId: string; problemId: string;
  problem: Worksheet["problems"][number];
  card: TeachingCard;                         // the worksheet's own unit, in full
  taught: boolean;                            // card.taught; false means Albert has no notes for this unit yet
  coveredMethods: Array<{ id: string; name: string; unitId: string; summary: string }>;   // this unit and earlier
  upcomingMethods: Array<{ name: string; unitId: string; unitTitle: string }>;            // later units: names only
  notation: TeachingCard["notation"];         // merged across covered units; the latest unit wins
};
```

**Scope rule (D10).** For a worksheet in unit *n*: units with `order ≤ n` that are `taught` are covered, units with `order > n` are upcoming. Upcoming units contribute method **names** only, so the model can recognise an out-of-scope shortcut without being handed how to do it.

## 7. Progress

```ts
type Outcome =
  | "unaided_correct"          // check passed, no hint used on this problem
  | "correct_after_r1" | "correct_after_r2" | "correct_after_r3"   // check passed, highest rung used
  | "error_made"               // a hint diagnosed an error for this subskill
  | "abandoned";               // session ended with the problem unfinished after a hint

type EvidenceEvent = {
  id: string; studentId: string; courseId: string;
  subskillId: string; problemId: string; sessionId: string;
  at: ISO; outcome: Outcome; errorType?: string; hintId?: string;
};

type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5;
// 0 not taught yet · 1 taught, no evidence · 2 can follow along · 3 can do with help
// 4 can do independently · 5 can teach it (drill mode only)

type SkillState = {
  studentId: string; courseId: string; subskillId: string; unitId: string;
  level: SkillLevel;
  evidenceIds: string[];       // the events that justify the level
  recentErrorTypes: string[];  // most recent first, max 3
  updatedAt: ISO;
};
```

**Level rule (D11).** `computeLevel(events, unitTaught)` is a pure function of the subskill's whole event history. *Positive* outcomes are the four `correct` ones; `unaided_correct` supports level 4, `correct_after_r1` and `correct_after_r2` support level 3, `correct_after_r3` supports level 2.

| Level | Condition |
|---|---|
| 0 | The unit is not taught yet (`taught: false`) |
| 1 | The unit is taught and there are no positive events |
| 2 | At least one positive event |
| 3 | At least two positive events that support level 3 or higher, on different problems |
| 4 | At least two `unaided_correct` events on different problems, and at least one is *cold*: no hint for this subskill in the 20 minutes before it, or it happened in a later session than another positive event for this subskill |
| 5 | Awarded only by drill mode (stretch) |
| −1 step | If the two most recent events are both `error_made` or `abandoned`, lower the result by one, never below 1 |

`computeLevel` accepts optional `StoredHint[]` history in addition to evidence. Production recomputation supplies it, including hints with no error evidence; otherwise no-hint timing can only be inferred from `error_made` and assisted-correct events. A cold solve has no hint for that subskill within the preceding 20 minutes (inclusive), or a positive event occurred earlier in a different session. Equal timestamps are ordered by event ID for deterministic demotion; time comparisons use parsed instants so offset timestamps work. `computeSkills` takes optional explicit `at`; without it `updatedAt` is the latest evidence time, or the Unix epoch for empty history. The impure recomputation wrapper supplies the current time.

The rule follows the Socratic tutor skill: levels are earned on two or more independent checks, at least one of them unprompted, and a failed review lowers the level.

**Tutor report.** Built by plain code from hints, evidence, skills and sessions (Phase 7, P7.4).

```ts
type TutorReport = {
  course: { id: string; title: string };
  student: { id: string; name: string };
  period: { from: ISO; to: ISO };
  summary: string;                       // the plan's "how you're doing" text
  totals: { minutes: number; problemsAttempted: number; solvedUnaided: number;
            hintsByRung: { 1: number; 2: number; 3: number } };
  stuckPoints: Array<{                   // most frequent first
    subskillId: string; subskillName: string; unitTitle: string;
    errorType: string; count: number; lastAt: ISO;
    example: { hintId: string; worksheetTitle: string; problemLabel: string;
               snapshotFileId?: string; albertRead: string; albertAsked: string;
               tutorNote: string };      // tutorNote is the hint's privateNote; tutors see it, students never do
  }>;
  skills: Array<SkillState & { name: string; unitTitle: string }>;
  suggestedFocus: string[];              // up to three subskill names, lowest level first
};
```

## 8. Study plan and agent runs

```ts
type StudyPlan = {
  id: string; studentId: string; courseId: string;
  generatedAt: ISO;
  trigger: "ingest" | "session_end" | "manual";
  horizonDays: 7;
  summary: string;             // "how you're doing", two sentences, plain language
  items: PlanItem[];
};

type PlanItem = {
  id: string;
  date: string;                // YYYY-MM-DD, within the horizon
  worksheetId: string; problemIds: string[];
  subskillIds: string[];
  lectureRef?: { unitId: string; label: string };
  estMinutes: number;          // 5..45
  reason: string;              // one sentence the student reads
  evidenceIds: string[];       // may be empty only when the reason is a due date
  dueAt?: ISO;
  priority: 1 | 2 | 3;
  status: "todo" | "done" | "skipped";
};
```

**Plan validity.** `validatePlan(plan, course)` is plain code and must pass before a plan is saved:

1. Every `worksheetId`, `problemId` and `subskillId` exists in the course.
2. Every `date` is inside the horizon and not after the item's `dueAt`.
3. No day totals more than `PLAN_MAX_MINUTES_PER_DAY` (60).
4. Every item has at least one `evidenceId` that exists, or a `dueAt`.
5. No item uses a problem from a unit that is not `taught`.

```ts
type AgentRun = {
  id: string; kind: "ingest" | "replan";
  courseId: string; studentId: string; threadId: string;
  status: "running" | "succeeded" | "failed";
  startedAt: ISO; endedAt?: ISO;
  events: AgentEvent[];
  result?: { cardsSaved?: number; worksheetsSaved?: number; planId?: string };
};

type AgentEvent = {
  at: ISO;
  type: "todo" | "subagent_start" | "subagent_end" | "tool" | "file" | "note" | "error";
  label: string;               // short, shown in the run panel
  detail?: unknown;
};
```

`POST /api/agent/ingest` and `POST /api/agent/replan` reply with `text/event-stream` (header `X-Run-Id`; a second request for a course whose run is still going attaches to that run and gets its earlier events replayed; `MOCK_LLM=1` replays `fixtures/agent/ingest-run.json` at 8x, gaps capped at 120 ms); each message is one `AgentEvent`, and the last is `{ type: "note", label: "done", detail: AgentRun["result"] }`.

## 9. Storage

```ts
interface Repo {
  // connection
  saveConnection(c: CourseConnection): Promise<void>;
  getConnection(studentId: string): Promise<CourseConnection | null>;
  // course content
  saveOutline(o: CourseOutline): Promise<void>;   getOutline(courseId: string): Promise<CourseOutline | null>;
  upsertCourse(c: Course): Promise<void>;           getCourse(id: string): Promise<Course | null>;
  upsertCard(c: TeachingCard): Promise<void>;       listCards(courseId: string): Promise<TeachingCard[]>;
  upsertWorksheet(w: Worksheet): Promise<void>;     listWorksheets(courseId: string): Promise<Worksheet[]>;
  getWorksheet(id: string): Promise<Worksheet | null>;
  putFile(meta: CourseFile, bytes: Uint8Array): Promise<void>;
  getFile(id: string): Promise<{ meta: CourseFile; bytes: Uint8Array } | null>;
  putText(id: string, text: string): Promise<void>;
  getText(id: string): Promise<string | null>;
  // sessions
  getSession(id: string): Promise<Session | null>;
  createSession(s: Session): Promise<void>;         appendEvents(sessionId: string, e: SessionEvent[]): Promise<void>;
  endSession(sessionId: string, at: ISO): Promise<void>;
  saveHint(h: StoredHint): Promise<void>;           listHints(filter: { sessionId?: string; courseId?: string }): Promise<StoredHint[]>;
  // progress
  addEvidence(e: EvidenceEvent[]): Promise<void>;   listEvidence(studentId: string, courseId: string): Promise<EvidenceEvent[]>;
  saveSkills(s: SkillState[]): Promise<void>;       listSkills(studentId: string, courseId: string): Promise<SkillState[]>;
  // plans and runs
  savePlan(p: StudyPlan): Promise<void>;            latestPlan(studentId: string, courseId: string): Promise<StudyPlan | null>;
  setPlanItemStatus(planId: string, itemId: string, status: PlanItem["status"]): Promise<void>;
  saveRun(r: AgentRun): Promise<void>;              getRun(id: string): Promise<AgentRun | null>;
  ping(): Promise<boolean>;
}

type GitHubSnapshot = { owner: string; repo: string; commitSha: string; manifestPath: string;
                        demoDay: string }; // YYYY-MM-DD, fixed at import

type CourseConnection = { studentId: string; connectedAt: ISO } & (
  | { source: "github"; snapshot: GitHubSnapshot; courseId: string }
  | { source: "upload"; courseId: string }
); // no token in persisted connection; optional GitHub token comes from server env
type Session = { id: string; studentId: string; courseId: string; worksheetId: string; startedAt: ISO; endedAt?: ISO };
type StoredHint = { id: string; sessionId: string; courseId: string; problemId: string; rowId: string; rung: Rung;
                    reading: ReadWork; diagnose: Diagnose; marks: AlbertMarkSpec[]; hint: WriteHint;
                    snapshotFileId?: string; ms: { firstEvent: number; total: number }; at: ISO };
```

**Text cache:** `putText` upserts a transcription by id; `getText` returns it or `null`. `CourseFile.textCacheId` points to that text. PDF page counts come from the original cached bytes. Text is stored separately from binary files.

**MongoDB collections** (database `albert`): `connections`, `courses`, `cards`, `worksheets`, `files` (metadata) with a GridFS bucket `filedata`, `texts` (transcriptions keyed by `_id`), `sessions`, `session_events`, `hints`, `evidence`, `skills`, `plans`, `agent_runs`. The LangGraph checkpointer and store create their own collections; leave their names at the package defaults.

**Indexes:** `cards {courseId, order}`, `worksheets {courseId}`, `session_events {sessionId, at}`, `evidence {studentId, courseId, subskillId, at}`, `plans {studentId, courseId, generatedAt: -1}`, `hints {courseId, at}`.

## 10. Course-source adapter

```ts
interface CourseSourceAdapter {
  readonly source: Course["source"];
  listCourses(): Promise<Array<{ id: string; title: string; shortName?: string }>>;
  getOutline(courseId: string): Promise<CourseOutline>;
  downloadFile(ref: FileRef): Promise<{ bytes: Uint8Array; mime: string }>;
}

type CourseOutline = {
  course: { id: string; title: string };
  files: FileRef[];             // course-wide files, including the syllabus
  units: Array<{
    order: number; title: string; sectionId: string;
    files: FileRef[];
  }>;
  assignments: Array<{ id: string; title: string; unitOrder?: number; dueAt?: ISO; fileRefs: FileRef[] }>;
};

type FileRef = { title: string; mime: string; bytes?: number; url: string; kindGuess: CourseFile["kind"];
                 lectureLabel?: string };
```

The existing `src/lib/lms` folder hosts both initial sources; its name does not imply a working LMS integration. `getAdapter(courseId)` selects an adapter from the stored course source. `saveOutline` / `getOutline` persist the normalized outline alongside the course in both Repo implementations.

```ts
type CourseManifest = {
  version: 1;
  course: { id: string; title: string; shortName?: string };
  units: Array<{ order: number; title: string }>;
  files: Array<{
    path: string; title: string; mime: "application/pdf";
    kind: CourseFile["kind"]; unitOrder?: number; lectureLabel?: string;
  }>;
  assignments: Array<{
    id: string; title: string; unitOrder: number; filePaths: string[];
    dueOffsetDays?: number;    // integer days from snapshot.demoDay, due at 23:59:59 UTC
  }>;
};
```

Manifest file paths are relative to its directory. Accept only normalized repository-relative paths beneath that directory; reject URLs, absolute paths and traversal. Require unique unit orders, file paths and assignment ids; every file unit and assignment reference must exist. Derive each outline `sectionId` as `${courseId}/u${order}` and preserve `lectureLabel` in its file references. Import only listed PDFs, never evaluation answers. Preserve empty future units and course-wide syllabus files. Unit order controls scope as before; a worksheet file alone does not make a unit taught.

Resolve `COURSE_GITHUB_REF` through `GET /repos/{owner}/{repo}/commits/{ref}`, then fetch the manifest and PDFs through `GET /repos/{owner}/{repo}/contents/{path}?ref={commitSha}` with `Accept: application/vnd.github.raw+json`. Use that SHA for every request and cache the manifest, normalized outline and bytes. Do not persist temporary download URLs. Snapshot-qualified course ids keep a new revision separate from existing cards, citations and student history. Re-importing the same snapshot and demo day is idempotent. Hints and original-file views use the Repo cache only. This MVP supports the configured public course repository. Automatic GitHub updates and LMS sync are post-hackathon work; P5.7 covers LMS sync.

## 11. API routes

| Route | Method | In | Out |
|---|---|---|---|
| `/api/health` | GET | — | `{ db: boolean; llm: boolean; courseSource: boolean \| null; provider: string; store: string }` |
| `/api/source/connect` | POST | —; imports configured GitHub manifest | `{ courseId, title, commitSha }` |
| `/api/source/courses` | GET | — | `Array<{ id, title, shortName?, ingested: boolean }>` |
| `/api/source/upload` | POST | multipart: files, plus `meta` JSON naming each file's unit order and kind | `{ courseId }` |
| `/api/agent/ingest` | POST | `{ courseId }` | SSE of `AgentEvent` |
| `/api/agent/replan` | POST | `{ courseId, trigger }` | SSE of `AgentEvent` |
| `/api/agent/runs/[runId]` | GET | — | `AgentRun` |
| `/api/agent/context` | GET | `?courseId=` | `{ cards: number, worksheets: Array<{ id, title }> }` (R1.2: what the Learn panel shows as ready) |
| `/api/course/[courseId]` | GET | — | `{ course, units: Array<Pick<TeachingCard, "unitId"\|"order"\|"title"\|"subskills">>, worksheets, plan, skills }` |
| `/api/worksheet/[worksheetId]` | GET | — | `Worksheet` |
| `/api/files/[fileId]` | GET | — | The cached file's bytes with its mime type. Serves only files already in the `Repo` |
| `/api/files/[fileId]/pages` | GET | — | `Array<{ page: number; widthPt: number; heightPt: number }>`; 1-based displayed PDF pages (crop and rotation applied) |
| `/api/files/[fileId]/page/[n]` | GET | — | One PNG, decoded width 1200 px, proportional height; render at 2x then downsample; derived files cached in the Repo by original id/content hash and renderer version |
| `/api/scope/[worksheetId]` | GET | `?problemId=` | `ScopeBundle` |
| `/api/session` | POST | `{ worksheetId }` | `{ sessionId }` |
| `/api/session/[id]/events` | POST | `{ events: SessionEvent[] }` | `{ ok: true }` |
| `/api/session/[id]/end` | POST | — | `{ evidenceAdded: number; replanRunId?: string }` |
| `/api/hint` | POST | `HintRequest` | NDJSON of `HintEvent` |
| `/api/check` | POST | `CheckRequest` | `CheckResponse` |
| `/api/progress/[courseId]` | GET | — | `{ skills: SkillState[]; recentErrors: Array<{ subskillId, errorType, at, hintId }> }` |
| `/api/plan/[courseId]` | GET | — | `StudyPlan \| null` |
| `/api/plan/[planId]/item/[itemId]` | PATCH | `{ status }` | `{ ok: true }` |
| `/api/report/[courseId]` | GET | — | `TutorReport` |

All routes run on the Node runtime. The optional GitHub token and model keys never reach the browser. Source errors return `{ code, message }` with `not_found`, `forbidden`, `rate_limited`, `unavailable` or `bad_reply`; source import does not invoke the model. No LMS credential routes are built for the hackathon.

PDF page routes only read original bytes already in the Repo. Unknown files and invalid/out-of-range page numbers return 404; non-PDF or unreadable PDF sources return a safe `bad_reply`. Derived metadata and PNG cache entries change when source bytes change. Worksheet regions are optional: detected labels define full-width vertical bands from the label to the next label or page bottom; no detected label leaves the problem picker in charge. PDF.js display coordinates account for crop, page rotation and the PDF-to-canvas y flip before scaling to `PAGE.width`.

Rendering rejects non-finite/non-positive dimensions, dimensions above 16384 px, or more than 16000000 pixels before native canvas allocation, returning safe `bad_reply`. Supported pages retain the 2400→1200 pipeline; P6.1's 3000-px longest-side/3.75-MB reader limits remain unchanged. Normalized text geometry is also cached by original id/content hash and geometry version. Worksheet responses derive regions from that geometry without overwriting stored worksheets. The offline demo seeds the recorded Worksheet 3 original when available and never overwrites existing bytes.

Worksheet GET preserves P5.6's `Cache-Control: no-store`, unknown-worksheet 404 `{ error: "not_found", message }`, and safe worksheet/store failure 500 `{ error: "server_error", message }`. PDF parsing/rendering failures retain the source-error response (for example 502 `bad_reply`); raw source or database details are never returned.

## 12. Environment

```bash
# model
LLM_PROVIDER=bedrock             # bedrock | anthropic | xai
AGENT_PROVIDER=                  # optional; overrides LLM_PROVIDER for the course agent only (tracks.md §8)
HINT_MODEL_ID=                   # chosen in P3.5
AGENT_MODEL_ID=                  # used by the course agent
READER_MODEL_ID=                 # used to read PDFs during ingestion; may equal AGENT_MODEL_ID
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_SESSION_TOKEN=
ANTHROPIC_API_KEY=               # fallback provider
XAI_API_KEY=                     # optional provider for the agent
HINT_TIMEOUT_MS=12000
SEND_CLEAN_IMAGE=0
MOCK_LLM=0                       # 1 = hints come from fixtures/llm

# data
STORE=mongo                      # mongo | memory
MONGODB_URI=
MONGODB_DB=albert

# course source (server only; published in P5.2)
COURSE_GITHUB_REPO=Azrkiel/albert-files
COURSE_GITHUB_REF=main            # resolved to a commit SHA once per explicit import
COURSE_MANIFEST_PATH=manifest.json # add at the content repo root in P5.2
COURSE_DEMO_DAY=                  # YYYY-MM-DD; defaults to UTC import date, then persisted
COURSE_GITHUB_TOKEN=              # optional read-only token for API quota; never NEXT_PUBLIC

# app
DEMO_STUDENT_ID=demo
NEXT_PUBLIC_AUTO_HINT=0          # "AUTO_HINT" in the plan. 1 = a pause writes a rung 1 hint without a tap
NEXT_PUBLIC_CANVAS_LAYOUT=ruled  # ruled | free (P2.5a, D18). free = write anywhere; becomes the default once P2.5a-AC4 passes
PLAN_MAX_MINUTES_PER_DAY=60

# optional
LANGSMITH_TRACING= LANGSMITH_API_KEY=
```

Apply the P1.1a scaffold follow-up before P1.2: update `.env.example` to list the course-source variables above instead of the old Moodle variables, and add the GitHub fixture directories. Other variables retain their existing defaults. Real values live in `.env.local`, which is git-ignored. The public content repository currently contains PDFs but no manifest; P5.2 adds it before live manifest-based import can work.

**URL flags on the work page**

| Flag | Effect |
|---|---|
| `?dev=1` | Shows the dev toolbar (export, load, snapshot) and the cluster overlay (plus line bands in the free layout) |
| `?layout=free` / `?layout=ruled` | Overrides `NEXT_PUBLIC_CANVAS_LAYOUT` for this page load |
| `?replay=<name>` | Plays `fixtures/sessions/<name>.json`. Add `&speed=4` or `&speed=instant` |
| `?auto=1` | Same as `NEXT_PUBLIC_AUTO_HINT=1` for this page load |
| `?demo=1` | Demo mode: auto-hint on, dev tools hidden, thicker ink, a **Reset demo** control |
| `?problem=<label>` | Scrolls to that problem |

## 13. Commands

| Command | What it does | Network |
|---|---|---|
| `pnpm dev` | Runs the app | — |
| `pnpm verify` | Type-check, lint, unit and contract tests | No |
| `pnpm e2e` | Playwright replay tests with `MOCK_LLM=1` and `STORE=memory` | No |
| `pnpm smoke` | Pings the database, the model and (if configured) the GitHub course manifest; prints a pass or fail line for each | Yes |
| `pnpm eval:hints` | Runs the hint eval set against the live model and prints the score table | Yes |
| `pnpm agent:ingest -- --course <id>` | Runs course ingestion from the terminal and prints the event stream | Yes |
| `pnpm agent:replan -- --course <id>` | Runs a re-plan from the terminal | Yes |
| `pnpm ingest:flat -- --course <id>` | Builds cards with a plain loop, no agent framework | Yes |
| `pnpm seed:pdf` | Builds the seed course PDFs from `seed/` | No |
| `pnpm seed:demo` | Loads hand-checked cards, worksheets and evidence for the offline demo | No |
| `pnpm check:tracks` | Checks that each track's evidence exists (see `tracks.md`) | No |

## 14. Fixtures

Recorded data that makes offline verification possible. The contract test (`tests/unit/contracts.test.ts`) parses every file in these folders with the schema shown.

| Folder | Schema | Created in |
|---|---|---|
| `fixtures/sessions/*.json` | `SessionRecording` | P2.3, and the list at the end of Phase 2 |
| `fixtures/llm/*.json` | `MockHint` | P3.1 |
| `fixtures/eval/requests/*.json` | `HintRequest` | P3.1, P3.4 |
| `fixtures/eval/cases/*.json` | `EvalCase` | P3.4 |
| `fixtures/cards/*.json` | `TeachingCard` | P3.2 |
| `fixtures/worksheets/*.json` | `Worksheet` | P3.2 |
| `fixtures/plans/*.json` | `StudyPlan` | P6.7 |
| `fixtures/agent/*.json` | `AgentRun` | P6.6 |
| `fixtures/github/manifest.json` | `CourseManifest` (synthetic transport only until P5.1 artifacts) | P5.2 |
| `fixtures/github/live-manifest.json` | `CourseManifest` (separate confirmed live mapping) | P5.2 |
| `fixtures/github/commit.json` | none: recorded GitHub commit response | P5.2 |
| `fixtures/github/files/*` | none: copies of manifest-listed PDFs | P5.2 |
| `fixtures/eval/*.png` | none: images for model pings | P1.4, P2.7 |
| `fixtures/eval/last-run.json` | none: output of the latest `pnpm eval:hints` run | P3.4 |

```ts
type SessionRecording = {
  version: 1;
  name: string;
  worksheetId: string;
  problems: Array<{ id: string; label: string; statementLatex: string }>;
  rows: Row[];
  events: SessionEvent[];      // in time order
  durationMs: number;
  notes?: string;              // what the recording is meant to show
  layout?: "ruled" | "free";   // absent = "ruled"; free recordings replay with inferred lines
};

type MockHint = {
  fixtureId: string;           // "<problemId with / replaced by _>-r<rung>" or "default-r<rung>"
  events: HintEvent[];         // what the route emits, in order
  delaysMs: number[];          // the wait before each event; same length as events
};

type EvalCase = {
  id: string;
  recording?: string;          // a file in fixtures/sessions, or…
  request?: string;            // …a file in fixtures/eval/requests
  worksheetId: string; problemId: string;
  stuckRowIndex: number;
  rung: Rung;
  history?: HintTurn[];
  expect: {
    status: Diagnose["status"][];          // any of these is correct
    stuckRowLatex?: string;                // what the stuck row says
    errorRowIndex?: number;
    errorClusterLabels?: number[];         // any overlap is correct
    errorType?: string;
    kind?: WriteHint["kind"][];
    mustNotMention?: string[];             // plain or LaTeX fragments that would give the answer away
    mustMentionAny?: string[];
    citationIncludes?: string;             // e.g. "Lecture 9"
    forbiddenMethods?: string[];           // out-of-scope method names
  };
};
```
