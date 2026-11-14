// Synthetic data only: no course files or model responses have been downloaded.
const at = "2026-11-13T12:00:00Z";
const bbox = { x: 10, y: 100, w: 40, h: 20 };
const point = { x: 10, y: 100, t: 0, p: 0.5 };
const stroke = { id: "st_1", problemId: "p1", rowId: null, tool: "pen", pointerType: "pen", points: [point], t0: 0, t1: 0, bbox };
const row = { id: "p1/r1", problemId: "p1", index: 1, bbox };
const signal = { kind: "pause", problemId: "p1", rowId: row.id, at: 8000 };
const turn = { hintId: "h1", rung: 1, rowId: row.id, text: "What changes?", studentWroteAfter: false };
const request = { sessionId: "s1", worksheetId: "w1", problemId: "p1", rowId: row.id, rung: 1, trigger: "pause", image: { marked: "iVBORw0KGgo=", width: 100, height: 100 }, rows: [{ rowId: row.id, index: 1, clusterLabels: [1] }], history: [turn] };
const reading = { rows: [{ index: 1, latex: "x=2", confidence: "high" }] };
const diagnose = { status: "stalled", privateNote: "No new step yet." };
const hint = { kind: "question", segments: [{ type: "text", text: "What changes?" }] };
const spec = { type: "circle", rowId: row.id, clusterIds: ["c1"] };
const mark = { id: "m1", hintId: "h1", problemId: "p1", spec, bbox, drawnAt: 8200 };
const snapshot = { owner: "Azrkiel", repo: "albert-files", commitSha: "a".repeat(40), manifestPath: "manifest.json", demoDay: "2026-11-13" };
const course = { id: "course1", source: "github", snapshot, title: "Synthetic calculus", unitIds: ["u1"] };
const file = { id: "f1", courseId: course.id, unitId: "u1", title: "Lecture 1", mime: "application/pdf", bytes: 100, kind: "lecture_notes" };
const card = { unitId: "u1", courseId: course.id, order: 1, title: "Substitution", taught: true, lectures: [{ label: "Lecture 1", fileId: "f1" }], methods: [{ id: "method1", name: "Substitution", summary: "Change variables.", steps: ["Choose u."], lecture: "Lecture 1" }], notation: [{ concept: "variable", teacherWrites: "u", avoid: ["v"] }], workedExamples: [{ label: "Example 1", problemLatex: "x", stepsLatex: ["u=x"], methodIds: ["method1"], fileId: "f1", page: 1 }], conventions: [], pitfalls: [{ description: "Missing differential", subskillId: "sk1", errorType: "missing_dx" }], subskills: [1, 2, 3].map((n) => ({ id: `sk${n}`, name: `Skill ${n}`, description: "Practice substitution." })), sourceFileIds: ["f1"], builtBy: "hand" };
const problem = { id: "p1", label: "1", statementLatex: "Integrate $x$.", page: 1, subskillIds: ["sk1"], methodIds: ["method1"] };
const worksheet = { id: "w1", courseId: course.id, unitId: "u1", title: "Worksheet 1", fileId: "f2", problems: [problem] };
const skill = { studentId: "demo", courseId: course.id, subskillId: "sk1", unitId: "u1", level: 1, evidenceIds: [], recentErrorTypes: [], updatedAt: at };
const item = { id: "pi1", date: "2026-11-13", worksheetId: "w1", problemIds: ["p1"], subskillIds: ["sk1"], estMinutes: 15, reason: "Practice before the deadline.", evidenceIds: [], dueAt: at, priority: 1, status: "todo" };
const plan = { id: "plan1", studentId: "demo", courseId: course.id, generatedAt: at, trigger: "ingest", horizonDays: 7, summary: "Start with substitution.", items: [item] };
const event = { at, type: "note", label: "Starting" };
const run = { id: "run1", kind: "ingest", courseId: course.id, studentId: "demo", threadId: "thread1", status: "running", startedAt: at, events: [event] };
const ref = { title: "Lecture 1", mime: "application/pdf", url: "https://example.org/lecture.pdf", kindGuess: "lecture_notes", lectureLabel: "Lecture 1" };
const manifest = { version: 1, course: { id: "calc2", title: "Synthetic calculus" }, units: [{ order: 1, title: "Substitution" }, { order: 2, title: "Future unit" }], files: [{ path: "lecture notes/lecture-1.pdf", title: "Lecture 1", mime: "application/pdf", kind: "lecture_notes", unitOrder: 1, lectureLabel: "Lecture 1" }, { path: "syllabus.pdf", title: "Syllabus", mime: "application/pdf", kind: "syllabus" }], assignments: [{ id: "a1", title: "Homework", unitOrder: 1, filePaths: ["lecture notes/lecture-1.pdf"], dueOffsetDays: 2 }] };
const recording = { version: 1, name: "Synthetic pause", worksheetId: "w1", problems: [{ id: "p1", label: "1", statementLatex: "Integrate $x$." }], rows: [row], events: [{ type: "stroke_end", at: 0, stroke }], durationMs: 8000 };
const hintEvent = { type: "started", hintId: "h1", at: 8000 };

export const examples = {
  BBox: { valid: bbox, invalid: { ...bbox, w: -1 } },
  Point: { valid: point, invalid: { ...point, p: 1.1 } },
  Stroke: { valid: stroke, invalid: { ...stroke, tool: "brush" } },
  Row: { valid: row, invalid: { ...row, index: 0 } },
  Cluster: { valid: { id: "c1", rowId: row.id, label: 1, strokeIds: [stroke.id], bbox }, invalid: { id: "c1", rowId: row.id, label: 0, strokeIds: [], bbox } },
  SessionEvent: { valid: recording.events[0], invalid: { type: "stroke_end", at: 0 } },
  StuckSignal: { valid: signal, invalid: { ...signal, kind: "idle" } },
  Rung: { valid: 1, invalid: 4 },
  HintRequest: { valid: request, invalid: { ...request, rung: 0 } },
  HintTurn: { valid: turn, invalid: { ...turn, studentWroteAfter: "yes" } },
  AlbertReply: { valid: { reading, diagnosis: diagnose, marks: [], hint }, invalid: { reading, diagnosis: diagnose, marks: Array(4).fill({ type: "circle", rowIndex: 1, clusterLabels: [1] }), hint } },
  ReadWork: { valid: reading, invalid: { rows: [{ index: 1, latex: "x", confidence: "certain" }] } },
  Diagnose: { valid: diagnose, invalid: { status: "stalled" } },
  Mark: { valid: { type: "circle", rowIndex: 1, clusterLabels: [1] }, invalid: { type: "arrow", fromHint: false, toRowIndex: 1, toClusterLabels: [1] } },
  WriteHint: { valid: hint, invalid: { ...hint, kind: "answer" } },
  InkSegment: { valid: { type: "break" }, invalid: { type: "math", text: "x" } },
  HintEvent: { valid: hintEvent, invalid: { type: "error", code: "oops", message: "Try again." } },
  AlbertMarkSpec: { valid: spec, invalid: { type: "arrow", rowId: row.id } },
  HintErrorCode: { valid: "timeout", invalid: "oops" },
  AlbertMark: { valid: mark, invalid: { ...mark, bbox: null } },
  CheckRequest: { valid: { sessionId: request.sessionId, worksheetId: request.worksheetId, problemId: request.problemId, image: request.image, rows: request.rows, history: request.history, finalRowId: row.id }, invalid: { sessionId: "s1", finalRowId: row.id } },
  Verdict: { valid: "not_yet", invalid: "wrong" },
  CheckResponse: { valid: { verdict: "not_yet", reading: [{ rowId: row.id, latex: "x" }], firstWrongRowId: row.id, subskillIds: ["sk1"] }, invalid: { verdict: "wrong", reading: [], subskillIds: [] } },
  Course: { valid: course, invalid: { ...course, snapshot: undefined } },
  CourseFile: { valid: file, invalid: { ...file, bytes: -1 } },
  TeachingCard: { valid: card, invalid: { ...card, builtBy: "model" } },
  Worksheet: { valid: worksheet, invalid: { ...worksheet, problems: [{ ...problem, subskillIds: [] }] } },
  ScopeBundle: { valid: { worksheetId: "w1", problemId: "p1", problem, card, taught: true, coveredMethods: [{ id: "method1", name: "Substitution", unitId: "u1", summary: "Change variables." }], upcomingMethods: [{ name: "Fractions", unitId: "u2", unitTitle: "Future unit" }], notation: card.notation }, invalid: { worksheetId: "w1", problemId: "p1" } },
  Outcome: { valid: "unaided_correct", invalid: "correct" },
  EvidenceEvent: { valid: { id: "ev1", studentId: "demo", courseId: course.id, subskillId: "sk1", problemId: "p1", sessionId: "s1", at, outcome: "unaided_correct" }, invalid: { id: "ev1", at: "yesterday", outcome: "unaided_correct" } },
  SkillLevel: { valid: 0, invalid: 6 },
  SkillState: { valid: skill, invalid: { ...skill, recentErrorTypes: ["a", "b", "c", "d"] } },
  TutorReport: { valid: { course: { id: course.id, title: course.title }, student: { id: "demo", name: "Demo" }, period: { from: at, to: at }, summary: "Practice substitution.", totals: { minutes: 10, problemsAttempted: 1, solvedUnaided: 0, hintsByRung: { 1: 1, 2: 0, 3: 0 } }, stuckPoints: [], skills: [{ ...skill, name: "Substitution", unitTitle: "Unit 1" }], suggestedFocus: ["Substitution"] }, invalid: { course: { id: course.id, title: course.title } } },
  StudyPlan: { valid: plan, invalid: { ...plan, horizonDays: 14 } },
  PlanItem: { valid: item, invalid: { ...item, estMinutes: 46 } },
  AgentRun: { valid: run, invalid: { ...run, status: "done" } },
  AgentEvent: { valid: event, invalid: { ...event, at: "today" } },
  GitHubSnapshot: { valid: snapshot, invalid: { ...snapshot, commitSha: "main" } },
  CourseConnection: { valid: { studentId: "demo", connectedAt: at, source: "github", snapshot, courseId: course.id }, invalid: { studentId: "demo", connectedAt: at, source: "github", courseId: course.id } },
  Session: { valid: { id: "s1", studentId: "demo", courseId: course.id, worksheetId: "w1", startedAt: at }, invalid: { id: "s1", studentId: "demo", courseId: course.id, worksheetId: "w1", startedAt: "today" } },
  StoredHint: { valid: { id: "h1", sessionId: "s1", courseId: course.id, problemId: "p1", rowId: row.id, rung: 1, reading, diagnose, marks: [spec], hint, ms: { firstEvent: 100, total: 500 }, at }, invalid: { id: "h1", rung: 1 } },
  CourseOutline: { valid: { course: { id: course.id, title: course.title }, files: [], units: [{ order: 1, title: "Substitution", sectionId: "course1/u1", files: [ref] }], assignments: [{ id: "a1", title: "Homework", unitOrder: 1, fileRefs: [ref] }] }, invalid: { course: { id: course.id, title: course.title }, files: [], units: [], assignments: [{}] } },
  FileRef: { valid: ref, invalid: { ...ref, kindGuess: "answers" } },
  CourseManifest: { valid: manifest, invalid: { ...manifest, files: [{ ...manifest.files[0], path: "../secret.pdf" }] } },
  SessionRecording: { valid: recording, invalid: { ...recording, version: 2 } },
  MockHint: { valid: { fixtureId: "default-r1", events: [hintEvent], delaysMs: [0] }, invalid: { fixtureId: "default-r1", events: [hintEvent], delaysMs: [] } },
  EvalCase: { valid: { id: "case1", request: "p1.json", worksheetId: "w1", problemId: "p1", stuckRowIndex: 1, rung: 1, expect: { status: ["stalled"], kind: ["question"] } }, invalid: { id: "case1", request: "p1.json", worksheetId: "w1", problemId: "p1", stuckRowIndex: 1, rung: 4, expect: { status: ["stalled"] } } },
};
