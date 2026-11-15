import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  SessionRecordingSchema, StoredHintSchema, StudyPlanSchema, WorksheetSchema,
  type EvidenceEvent, type Repo, type Session, type StoredHint, type StudyPlan, type TeachingCard, type Worksheet,
} from "../contracts";
import { seedDemo } from "../db/seed-demo";
import { recomputeSkills } from "./index";

/**
 * SEED / DEMO DATA. Everything this file writes is hand-written: two earlier sessions, the evidence and hints
 * they left, and a study plan. None of it is agent output. The plan id starts with SEED_PLAN_PREFIX so the course
 * page can say so. Dates are relative to `now`, so the plan always starts today.
 */
export const SEED_PLAN_PREFIX = "seed-demo-plan";
export const isSeedPlan = (planId: string) => planId.startsWith(SEED_PLAN_PREFIX);
/** The hand-written note on the seeded missing-dx hints. Student pages must never show it; the tutor report does. */
export const DEMO_PRIVATE_NOTE = "Student substituted x = 4 sin(theta) in the denominator but wrote no dx = 4 cos(theta) d(theta); the integral has no d(theta).";

export type DemoHistoryOptions = {
  /** Course id to seed under. Anything other than "calc2" re-keys the demo cards and worksheets (used by tests). */
  courseId?: string;
  studentId?: string;
  now?: Date;
  /** false: cards, worksheets and a plan only, so the student has no evidence yet. */
  history?: boolean;
};

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => iso(ms).slice(0, 10);
const startOfDay = (ms: number) => ms - (ms % DAY);
const stable = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 20);

/** Re-keys the calc2 demo ids under another course id so tests never collide with the shared calc2 data. */
function retarget<T>(value: T, courseId: string): T {
  if (courseId === "calc2") return value;
  return JSON.parse(JSON.stringify(value).replaceAll("calc2/u", `${courseId}/u`).replaceAll("calc2-ws", `${courseId}-ws`)
    .replaceAll('"courseId":"calc2"', `"courseId":"${courseId}"`)) as T;
}

// Worksheets 2 and 4 have no fixture yet (the course lane ingests the real ones). Statements are from seed/calc2.
const extraWorksheets: Worksheet[] = [
  { id: "calc2-ws2", courseId: "calc2", unitId: "calc2/u2", title: "Worksheet 2", fileId: "calc2-worksheet-2", problems: [
    { id: "calc2-ws2/p1", label: "1", statementLatex: String.raw`$\int \sin^3 x\,dx$`, page: 1, subskillIds: ["u2.odd_power_split", "u2.pythagorean_identity"], methodIds: ["u2.odd_power"] },
    { id: "calc2-ws2/p2", label: "2", statementLatex: String.raw`$\int \cos^2 x\,dx$`, page: 1, subskillIds: ["u2.even_power_half_angle"], methodIds: ["u2.half_angle"] },
    { id: "calc2-ws2/p3", label: "3", statementLatex: String.raw`$\int \sin^2 x\cos^2 x\,dx$`, page: 1, subskillIds: ["u2.even_power_half_angle", "u2.pythagorean_identity"], methodIds: ["u2.half_angle"] },
  ] },
  { id: "calc2-ws4", courseId: "calc2", unitId: "calc2/u4", title: "Worksheet 4", fileId: "calc2-worksheet-4", problems: [
    { id: "calc2-ws4/p1", label: "1", statementLatex: String.raw`$\int \frac{dx}{(x-1)(x+2)}$`, page: 1, subskillIds: ["u4.factor_denominator", "u4.set_up_decomposition", "u4.solve_coefficients"], methodIds: ["u4.partial_fractions"] },
    { id: "calc2-ws4/p2", label: "2", statementLatex: String.raw`$\int \frac{2x+3}{x(x+1)}\,dx$`, page: 1, subskillIds: ["u4.factor_denominator", "u4.set_up_decomposition", "u4.solve_coefficients"], methodIds: ["u4.partial_fractions"] },
    { id: "calc2-ws4/p3", label: "3", statementLatex: String.raw`$\int \frac{dx}{x(x+1)^2}$`, page: 1, subskillIds: ["u4.set_up_decomposition", "u4.solve_coefficients"], methodIds: ["u4.partial_fractions"] },
  ] },
].map((w) => WorksheetSchema.parse(w));

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = CRC[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}
/** Encodes 8-bit grayscale pixels as a PNG, with no native dependency (this module is bundled by Next). */
function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1); }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; // 8-bit, colour type 0 (grayscale)
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]));
}

/**
 * A believable handwritten snapshot: the strokes of the checked-in missing-dx recording, drawn dark on white and
 * cropped with 24 px of padding. Falls back to a plain white page if the recording is missing.
 */
export async function demoSnapshotPng(root = process.cwd()): Promise<Uint8Array> {
  try {
    const recording = SessionRecordingSchema.parse(JSON.parse(await readFile(join(/*turbopackIgnore: true*/ root, "fixtures", "sessions", "missing-dx.json"), "utf8")));
    const strokes = recording.events.flatMap((e) => (e.type === "stroke_end" && e.stroke.tool === "pen" ? [e.stroke] : []));
    const xs = strokes.flatMap((s) => s.points.map((p) => p.x)), ys = strokes.flatMap((s) => s.points.map((p) => p.y));
    const pad = 24;
    const x0 = Math.floor(Math.min(...xs)) - pad, y0 = Math.floor(Math.min(...ys)) - pad;
    const w = Math.ceil(Math.max(...xs)) - x0 + pad, h = Math.ceil(Math.max(...ys)) - y0 + pad;
    if (!(w > 0 && h > 0 && w * h < 4_000_000)) throw new Error("bad bounds");
    const pixels = new Uint8Array(w * h).fill(255);
    const dot = (cx: number, cy: number) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < w && y < h) pixels[y * w + x] = 20; } };
    for (const s of strokes) s.points.forEach((p, i) => {
      const prev = s.points[i - 1] ?? p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y)));
      for (let k = 1; k <= steps; k++) dot(Math.round(prev.x + ((p.x - prev.x) * k) / steps - x0), Math.round(prev.y + ((p.y - prev.y) * k) / steps - y0));
    });
    return encodePng(w, h, pixels);
  } catch {
    return encodePng(240, 80, new Uint8Array(240 * 80).fill(255));
  }
}

type Seeded = { sessions: Session[]; hints: StoredHint[]; evidence: EvidenceEvent[] };

function history(courseId: string, studentId: string, now: number, ws: Map<string, Worksheet>, snapshotFileId: string): Seeded {
  const p = (sheet: string, n: number) => `${courseId}-${sheet}/p${n}`;
  const t1 = startOfDay(now) - 3 * DAY + 15 * 3_600_000; // session 1: Worksheet 1, three days ago
  const t2 = startOfDay(now) - 1 * DAY + 16 * 3_600_000; // session 2: Worksheet 3, yesterday
  const s1: Session = { id: `seed-demo-session-1:${courseId}`, studentId, courseId, worksheetId: `${courseId}-ws1`, startedAt: iso(t1), endedAt: iso(t1 + 52 * 60_000) };
  const s2: Session = { id: `seed-demo-session-2:${courseId}`, studentId, courseId, worksheetId: `${courseId}-ws3`, startedAt: iso(t2), endedAt: iso(t2 + 38 * 60_000) };
  const ev = (s: Session, problemId: string, subskillId: string, outcome: EvidenceEvent["outcome"], at: number, extra: Partial<EvidenceEvent> = {}): EvidenceEvent =>
    ({ id: `seed-demo-ev:${stable(s.id, problemId, subskillId, outcome)}`, studentId, courseId, sessionId: s.id, problemId, subskillId, outcome, at: iso(at), ...extra });
  const hint = (s: Session, n: number, problemId: string, rowIndex: number, rung: 1 | 2 | 3, at: number, d: StoredHint["diagnose"], text: string, extra: Partial<StoredHint> = {}): StoredHint =>
    StoredHintSchema.parse({
      id: `seed-demo-hint:${s.id}:${n}`, sessionId: s.id, courseId, problemId, rowId: `${problemId}/r${rowIndex}`, rung,
      reading: { rows: [{ index: rowIndex - 1, latex: String.raw`\int \frac{dx}{x^2\sqrt{16-x^2}}`, confidence: "high" }, { index: rowIndex, latex: d.errorType === "missing_dx" ? String.raw`\int \frac{1}{16\sin^2\theta \cdot 4\cos\theta}` : String.raw`x e^x - \int e^x\,dx`, confidence: "high" }].filter((r) => r.index > 0) },
      diagnose: d, marks: [], hint: { kind: rung === 1 ? "question" : "nudge", segments: [{ type: "text", text }] }, ms: { firstEvent: 2400, total: 3100 }, at: iso(at), ...extra,
    });

  // Session 1 (Worksheet 1): p1 solved cold; p2 a sign slip, then solved after a question; p3 left unfinished after a hint.
  const h1 = hint(s1, 1, p("ws1", 2), 2, 1, t1 + 20 * 60_000, { status: "error", rowIndex: 2, errorType: "sign_error", subskillId: "u1.apply_rule", privateNote: "Student wrote uv + the integral of v du instead of uv minus it." }, "Look at the sign between the two terms. What does the rule say it should be?");
  const h2 = hint(s1, 2, p("ws1", 3), 2, 1, t1 + 40 * 60_000, { status: "error", rowIndex: 2, errorType: "stopped_after_one_round", subskillId: "u1.repeat_parts", privateNote: "Student applied parts once and stopped; the remaining integral still contains x squared." }, "Is the new integral simpler than the one you started with? What would you do next?");
  // Session 2 (Worksheet 3): problem 1, missing dx, two rungs, never finished.
  const h3 = hint(s2, 1, p("ws3", 1), 3, 1, t2 + 14 * 60_000, { status: "error", rowIndex: 3, clusterLabels: [4], errorType: "missing_dx", subskillId: "u3.find_dx", privateNote: DEMO_PRIVATE_NOTE }, "You replaced x. What does dx become?", { snapshotFileId });
  const h4 = hint(s2, 2, p("ws3", 1), 3, 2, t2 + 22 * 60_000, { status: "error", rowIndex: 3, clusterLabels: [4], errorType: "missing_dx", subskillId: "u3.find_dx", privateNote: DEMO_PRIVATE_NOTE }, "Differentiate x = 4 sin theta to find dx, then write it in the integral.");
  void ws;

  const evidence = [
    ev(s1, p("ws1", 1), "u1.choose_u", "unaided_correct", t1 + 10 * 60_000),
    ev(s1, p("ws1", 1), "u1.apply_rule", "unaided_correct", t1 + 10 * 60_000),
    ev(s1, p("ws1", 2), "u1.apply_rule", "error_made", t1 + 20 * 60_000, { errorType: "sign_error", hintId: h1.id }),
    ev(s1, p("ws1", 2), "u1.choose_u", "correct_after_r1", t1 + 30 * 60_000),
    ev(s1, p("ws1", 2), "u1.apply_rule", "correct_after_r1", t1 + 30 * 60_000),
    ev(s1, p("ws1", 3), "u1.repeat_parts", "error_made", t1 + 40 * 60_000, { errorType: "stopped_after_one_round", hintId: h2.id }),
    ev(s1, p("ws1", 3), "u1.repeat_parts", "abandoned", t1 + 52 * 60_000),
    ev(s2, p("ws3", 1), "u3.find_dx", "error_made", t2 + 14 * 60_000, { errorType: "missing_dx", hintId: h3.id }),
    ev(s2, p("ws3", 1), "u3.find_dx", "abandoned", t2 + 38 * 60_000),
  ];
  return { sessions: [s1, s2], hints: [h1, h2, h3, h4], evidence };
}

function plan(courseId: string, studentId: string, now: number, evidence: EvidenceEvent[]): StudyPlan {
  const today = startOfDay(now);
  const due = (n: number) => iso(today + n * DAY + 86_399_000);
  const find = (subskillId: string, outcome: EvidenceEvent["outcome"]) => evidence.filter((e) => e.subskillId === subskillId && e.outcome === outcome).map((e) => e.id);
  const w = (sheet: string, ...n: number[]) => n.map((i) => `${courseId}-${sheet}/p${i}`);
  const has = evidence.length > 0;
  return StudyPlanSchema.parse({
    id: `${SEED_PLAN_PREFIX}:${courseId}`, studentId, courseId, generatedAt: iso(today), trigger: "manual", horizonDays: 7,
    summary: has
      ? "You dropped dx on Worksheet 3 problem 1 and left it after two hints, and left Worksheet 1 problem 3 unfinished. Integration by parts is steady; trigonometric substitution is where the work is."
      : "Worksheet 3 is due in 4 days and you have not started it. Begin with problem 1, which is the closest to the worked examples in Lecture 9.",
    items: [
      { id: `${SEED_PLAN_PREFIX}-1`, date: day(today), worksheetId: `${courseId}-ws3`, problemIds: w("ws3", 1), subskillIds: ["u3.find_dx", "u3.choose_substitution"], lectureRef: { unitId: `${courseId}/u3`, label: "Lecture 9, Step 2" }, estMinutes: 20,
        reason: has ? "You dropped dx on Worksheet 3 problem 1 and stopped after two hints. Redo it and write dx before you integrate." : "Worksheet 3 is due soon and problem 1 matches Lecture 9, Example 2.",
        evidenceIds: find("u3.find_dx", "error_made"), dueAt: due(4), priority: 1, status: "todo" },
      ...(has ? [{ id: `${SEED_PLAN_PREFIX}-2`, date: day(today), worksheetId: `${courseId}-ws1`, problemIds: w("ws1", 3), subskillIds: ["u1.repeat_parts"], lectureRef: { unitId: `${courseId}/u1`, label: "Lecture 6" }, estMinutes: 15,
        reason: "You left Worksheet 1 problem 3 unfinished after a hint. Finish the second round of parts.", evidenceIds: find("u1.repeat_parts", "abandoned"), priority: 2, status: "todo" }] : []),
      { id: `${SEED_PLAN_PREFIX}-3`, date: day(today + DAY), worksheetId: `${courseId}-ws3`, problemIds: w("ws3", 2), subskillIds: ["u3.choose_substitution", "u3.simplify_identity"], lectureRef: { unitId: `${courseId}/u3`, label: "Lecture 9, Step 3" }, estMinutes: 25,
        reason: "Worksheet 3 is due in 3 days.", evidenceIds: [], dueAt: due(4), priority: 2, status: "todo" },
      { id: `${SEED_PLAN_PREFIX}-4`, date: day(today + 2 * DAY), worksheetId: `${courseId}-ws3`, problemIds: w("ws3", 3), subskillIds: ["u3.integrate_theta", "u3.reference_triangle"], lectureRef: { unitId: `${courseId}/u3`, label: "Lecture 10" }, estMinutes: 25,
        reason: "Worksheet 3 is due in 2 days.", evidenceIds: [], dueAt: due(4), priority: 2, status: "todo" },
      { id: `${SEED_PLAN_PREFIX}-5`, date: day(today + 3 * DAY), worksheetId: `${courseId}-ws3`, problemIds: w("ws3", 4, 5), subskillIds: ["u3.reference_triangle", "u3.find_dx"], lectureRef: { unitId: `${courseId}/u3`, label: "Lecture 10, Example 2" }, estMinutes: 30,
        reason: "Worksheet 3 is due tomorrow; these two are the last problems.", evidenceIds: [], dueAt: due(4), priority: 3, status: "todo" },
    ],
  });
}

/** Loads the demo cards and worksheets, plus (unless `history: false`) two earlier sessions and a hand-written plan. */
export async function seedDemoHistory(repo: Repo, options: DemoHistoryOptions = {}) {
  const courseId = options.courseId ?? "calc2";
  const studentId = options.studentId ?? (process.env.DEMO_STUDENT_ID?.trim() || "demo");
  const now = (options.now ?? new Date()).getTime();
  await seedDemo(repo);
  const base = await repo.listCards("calc2");
  const cards: TeachingCard[] = retarget(base, courseId);
  const sheets = new Map<string, Worksheet>();
  for (const w of [...(await repo.listWorksheets("calc2")), ...extraWorksheets.filter((e) => e.courseId === "calc2")]) sheets.set(w.id, w);
  const dueDays: Record<string, number> = { "calc2-ws3": 4, "calc2-ws4": 11 };
  const worksheets = [...sheets.values()].map((w) => retarget({ ...w, ...(dueDays[w.id] === undefined ? {} : { dueAt: iso(startOfDay(now) + dueDays[w.id]! * DAY + 86_399_000) }) }, courseId));
  for (const c of cards) await repo.upsertCard(c);
  for (const w of worksheets) await repo.upsertWorksheet(w);
  await repo.upsertCourse({ id: courseId, source: "upload", title: "Calculus II", shortName: "CALC2", ingestedAt: iso(now - 4 * DAY), unitIds: cards.map((c) => c.unitId) });

  const snapshotFileId = `seed-demo-snapshot:${courseId}`;
  const seeded: Seeded = options.history === false ? { sessions: [], hints: [], evidence: [] }
    : history(courseId, studentId, now, new Map(worksheets.map((w) => [w.id, w])), snapshotFileId);
  if (seeded.hints.length) {
    const bytes = await demoSnapshotPng();
    await repo.putFile({ id: snapshotFileId, courseId, title: "Seeded snapshot (demo data)", mime: "image/png", bytes: bytes.length, kind: "other" }, bytes);
  }
  for (const s of seeded.sessions) { await repo.createSession({ ...s, endedAt: undefined }).catch(() => undefined); await repo.endSession(s.id, s.endedAt!); }
  for (const h of seeded.hints) await repo.saveHint(h);
  await repo.addEvidence(seeded.evidence);
  await repo.savePlan(plan(courseId, studentId, now, seeded.evidence));
  await recomputeSkills(studentId, courseId, repo, iso(now));
  return { courseId, studentId, sessions: seeded.sessions.length, hints: seeded.hints.length, evidence: seeded.evidence.length };
}
