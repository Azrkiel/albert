import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentRunSchema, CourseConnectionSchema, CourseFileSchema, CourseOutlineSchema,
  CourseSchema, EvidenceEventSchema, SessionEventSchema, SessionSchema, SkillStateSchema,
  StoredHintSchema, StudyPlanSchema, TeachingCardSchema, WorksheetSchema,
  type Repo, type Session, type SessionEvent,
} from "../../src/lib/contracts";
import { examples } from "./contracts.examples";

export interface RepoHarness {
  repo: Repo;
  readSession(id: string): Promise<Session | null>;
  readEvents(id: string): Promise<SessionEvent[]>;
  dispose(): Promise<void>;
}

function fixtures() {
  return {
    connection: CourseConnectionSchema.parse(examples.CourseConnection.valid),
    outline: CourseOutlineSchema.parse(examples.CourseOutline.valid),
    course: CourseSchema.parse(examples.Course.valid),
    card: TeachingCardSchema.parse(examples.TeachingCard.valid),
    worksheet: WorksheetSchema.parse(examples.Worksheet.valid),
    file: CourseFileSchema.parse(examples.CourseFile.valid),
    session: SessionSchema.parse(examples.Session.valid),
    event: SessionEventSchema.parse(examples.SessionEvent.valid),
    hint: StoredHintSchema.parse(examples.StoredHint.valid),
    evidence: EvidenceEventSchema.parse(examples.EvidenceEvent.valid),
    skill: SkillStateSchema.parse(examples.SkillState.valid),
    plan: StudyPlanSchema.parse(examples.StudyPlan.valid),
    run: AgentRunSchema.parse(examples.AgentRun.valid),
  };
}

// Mutate all nested fields, including arrays, to detect shallow-copy implementations.
function mutate(value: unknown): void {
  if (value instanceof Uint8Array) { value.fill(0); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const field = record[key];
    if (typeof field === "string") record[key] = `${field}:changed`;
    else if (typeof field === "number") record[key] = field + 1;
    else if (typeof field === "boolean") record[key] = !field;
    else mutate(field);
  }
  if (Array.isArray(value)) value.push("changed");
}

async function isolated<T>(input: T, write: (value: T) => Promise<void>, read: () => Promise<unknown>) {
  const expected = structuredClone(input);
  await write(input);
  mutate(input);
  const output = await read();
  expect(output).toEqual(expected);
  mutate(output);
  expect(await read()).toEqual(expected);
}

export function repoBehaviour(name: string, create: () => Promise<RepoHarness>, enabled = true, timeout = 5000): void {
  describe.skipIf(!enabled)(name, { timeout }, () => {
    let harness: RepoHarness;
    let repo: Repo;
    let f: ReturnType<typeof fixtures>;
    beforeEach(async () => {
      harness = await create();
      repo = harness.repo;
      f = fixtures();
    }, 30000);
    afterEach(async () => { await harness?.dispose(); }, 30000);

    it("pings", async () => { expect(await repo.ping()).toBe(true); });

    it("returns null or empty lists for absent records", async () => {
      expect(await repo.getConnection("missing")).toBeNull();
      expect(await repo.getOutline("missing")).toBeNull();
      expect(await repo.getCourse("missing")).toBeNull();
      expect(await repo.getWorksheet("missing")).toBeNull();
      expect(await repo.getFile("missing")).toBeNull();
      expect(await repo.latestPlan("missing", "missing")).toBeNull();
      expect(await repo.getRun("missing")).toBeNull();
      expect(await repo.listCards("missing")).toEqual([]);
      expect(await repo.listWorksheets("missing")).toEqual([]);
      expect(await repo.listHints({})).toEqual([]);
      expect(await repo.listEvidence("missing", "missing")).toEqual([]);
      expect(await repo.listSkills("missing", "missing")).toEqual([]);
    });

    it("saves, replaces and isolates connections by student", async () => {
      const key = f.connection.studentId;
      await repo.saveConnection({ ...f.connection, source: "upload", courseId: "old" });
      await repo.saveConnection({ ...f.connection, studentId: "other" });
      await isolated(f.connection, v => repo.saveConnection(v), () => repo.getConnection(key));
      expect((await repo.getConnection("other"))?.studentId).toBe("other");
    });

    it("saves, replaces and isolates outlines", async () => {
      const id = f.outline.course.id;
      await repo.saveOutline({ ...f.outline, units: [] });
      await isolated(f.outline, v => repo.saveOutline(v), () => repo.getOutline(id));
    });

    it("upserts and isolates courses, removing omitted optional fields", async () => {
      const id = f.course.id;
      await repo.upsertCourse({ ...f.course, shortName: "old" });
      f.course.shortName = undefined;
      await isolated(f.course, v => repo.upsertCourse(v), () => repo.getCourse(id));
      expect((await repo.getCourse(id))?.shortName).toBeUndefined();
    });

    it("upserts cards by unit, filters course, orders by teaching order and isolates nested data", async () => {
      const courseId = f.card.courseId;
      await repo.upsertCard({ ...f.card, unitId: "later", order: 2 });
      await repo.upsertCard({ ...f.card, unitId: "other", courseId: "other" });
      await repo.upsertCard({ ...f.card, methods: [] });
      await isolated(f.card, v => repo.upsertCard(v), async () => (await repo.listCards(courseId))[0]);
      expect((await repo.listCards(courseId)).map(c => c.order)).toEqual([1, 2]);
    });

    it("upserts worksheets and isolates both single and list reads", async () => {
      const { id, courseId } = f.worksheet;
      const expected = structuredClone(f.worksheet);
      await repo.upsertWorksheet({ ...f.worksheet, problems: [] });
      await repo.upsertWorksheet({ ...f.worksheet, id: "other", courseId: "other" });
      await isolated(f.worksheet, v => repo.upsertWorksheet(v), () => repo.getWorksheet(id));
      const list = await repo.listWorksheets(courseId);
      expect(list).toEqual([expected]);
      mutate(list);
      expect(await repo.listWorksheets(courseId)).toEqual([expected]);
    });

    it("round-trips and isolates a 300 KB Buffer, replaces bytes and metadata", async () => {
      const bytes = Buffer.from(Array.from({ length: 300 * 1024 }, (_, i) => i % 251));
      const meta = { ...f.file, bytes: bytes.length };
      const expectedMeta = structuredClone(meta);
      const expectedBytes = new Uint8Array(bytes);
      await repo.putFile(meta, bytes);
      mutate(meta);
      bytes.fill(0);
      const result = await repo.getFile(expectedMeta.id);
      expect(result?.meta).toEqual(expectedMeta);
      expect(result?.bytes).toEqual(expectedBytes);
      mutate(result);
      expect(await repo.getFile(expectedMeta.id)).toEqual({ meta: expectedMeta, bytes: expectedBytes });
      const replacement = { ...expectedMeta, title: "replacement", bytes: 3 };
      await repo.putFile(replacement, new Uint8Array([3, 2, 1]));
      expect(await repo.getFile(expectedMeta.id)).toEqual({ meta: replacement, bytes: new Uint8Array([3, 2, 1]) });
      await repo.putFile({ ...replacement, bytes: 0 }, new Uint8Array());
      expect((await repo.getFile(expectedMeta.id))?.bytes.length).toBe(0);
    });

    it("creates and isolates sessions, rejects duplicate creation and persists the end timestamp", async () => {
      const id = f.session.id;
      const expected = structuredClone(f.session);
      await isolated(f.session, v => repo.createSession(v), () => harness.readSession(id));
      await expect(repo.createSession(expected)).rejects.toThrow();
      const at = "2026-11-13T13:00:00Z";
      await repo.endSession(id, at);
      expect(await harness.readSession(id)).toEqual({ ...expected, endedAt: at });
    });

    it("appends event batches without losing earlier events or leaking references", async () => {
      await repo.createSession(f.session);
      const events = [f.event];
      const first = structuredClone(events);
      await repo.appendEvents(f.session.id, events);
      mutate(events);
      const next: SessionEvent = { type: "problem_opened", at: 12, problemId: "p2" };
      await repo.appendEvents(f.session.id, [next]);
      await repo.appendEvents(f.session.id, []);
      expect(await harness.readEvents(f.session.id)).toEqual([...first, next]);
      expect(await harness.readEvents("other")).toEqual([]);
    });

    it("R2.3-AC2: lists events by time then insertion order, across batches and equal timestamps", async () => {
      await repo.createSession(f.session);
      const at = (n: number, id: string): SessionEvent => ({ type: "problem_opened", at: n, problemId: id });
      await repo.appendEvents(f.session.id, [at(5, "a"), at(3, "b"), at(5, "c")]);
      await repo.appendEvents(f.session.id, [at(5, "d"), at(1, "e"), at(3, "f")]);
      const listed = await repo.listEvents(f.session.id);
      expect(listed.map(e => e.type === "problem_opened" && e.problemId)).toEqual(["e", "b", "f", "a", "c", "d"]);
      expect(await repo.listEvents("other")).toEqual([]);
      mutate(listed);
      expect((await repo.listEvents(f.session.id)).map(e => e.at)).toEqual([1, 3, 3, 5, 5, 5]);
    });

    it("R2.3: latestOpenSession returns the newest open session of a worksheet", async () => {
      const make = (id: string, startedAt: string, worksheetId = f.session.worksheetId): Session => ({ ...f.session, id, startedAt, worksheetId });
      expect(await repo.latestOpenSession(f.session.worksheetId)).toBeNull();
      await repo.createSession(make("old", "2026-01-01T10:00:00.000Z"));
      await repo.createSession(make("new", "2026-01-01T11:00:00.000Z"));
      await repo.createSession(make("elsewhere", "2026-01-01T12:00:00.000Z", "other-sheet"));
      expect((await repo.latestOpenSession(f.session.worksheetId))?.id).toBe("new");
      await repo.endSession("new", "2026-01-01T11:30:00.000Z");
      expect((await repo.latestOpenSession(f.session.worksheetId))?.id).toBe("old");
      await repo.endSession("old", "2026-01-01T10:30:00.000Z");
      expect(await repo.latestOpenSession(f.session.worksheetId)).toBeNull();
    });

    it("rejects session mutations for unknown sessions", async () => {
      await expect(repo.appendEvents("missing", [f.event])).rejects.toThrow();
      await expect(repo.endSession("missing", f.session.startedAt)).rejects.toThrow();
    });

    it("saves and isolates hints, replaces by id, combines filters and sorts by time", async () => {
      const expected = structuredClone(f.hint);
      await repo.saveHint({ ...f.hint, marks: [] });
      await isolated(f.hint, v => repo.saveHint(v), async () => (await repo.listHints({ sessionId: expected.sessionId, courseId: expected.courseId }))[0]);
      const later = { ...expected, id: "later", at: "2026-11-13T13:00:00Z" };
      await repo.saveHint(later);
      await repo.saveHint({ ...expected, id: "other-session", sessionId: "other" });
      await repo.saveHint({ ...expected, id: "other-course", courseId: "other" });
      expect(await repo.listHints({ courseId: expected.courseId, sessionId: expected.sessionId })).toEqual([expected, later]);
      expect(await repo.listHints({ sessionId: expected.sessionId })).toHaveLength(3);
      expect(await repo.listHints({ courseId: expected.courseId })).toHaveLength(3);
      expect(await repo.listHints({})).toHaveLength(4);
    });

    it("adds and isolates evidence, filters both student and course, sorts by time, and tolerates retries", async () => {
      const { studentId, courseId } = f.evidence;
      const expected = structuredClone(f.evidence);
      await repo.addEvidence([]);
      await repo.addEvidence([f.evidence, f.evidence]);
      await isolated(f.evidence, v => repo.addEvidence([v]), async () => (await repo.listEvidence(studentId, courseId))[0]);
      const later = { ...expected, id: "later", at: "2026-11-13T13:00:00Z" };
      await repo.addEvidence([later, { ...expected, id: "other-student", studentId: "other" }, { ...expected, id: "other-course", courseId: "other" }]);
      expect(await repo.listEvidence(studentId, courseId)).toEqual([expected, later]);
    });

    it("saves and isolates skill batches, upserts the composite key and filters both student and course", async () => {
      const { studentId, courseId } = f.skill;
      const expected = structuredClone(f.skill);
      await repo.saveSkills([]);
      await repo.saveSkills([{ ...f.skill, level: 2 }]);
      await isolated(f.skill, v => repo.saveSkills([v]), async () => (await repo.listSkills(studentId, courseId))[0]);
      await repo.saveSkills([{ ...expected, studentId: "other" }, { ...expected, courseId: "other" }, { ...expected, subskillId: "sk2" }]);
      expect(await repo.listSkills(studentId, courseId)).toEqual([expected, { ...expected, subskillId: "sk2" }]);
    });

    it("isolates plans, chooses latest by generated time rather than insertion order, and updates only the requested item", async () => {
      const { studentId, courseId } = f.plan;
      const expected = structuredClone(f.plan);
      await repo.savePlan({ ...f.plan, summary: "old" });
      await isolated(f.plan, v => repo.savePlan(v), () => repo.latestPlan(studentId, courseId));
      await repo.savePlan({ ...expected, id: "older", generatedAt: "2026-11-12T12:00:00Z" });
      await repo.savePlan({ ...expected, id: "other-student", studentId: "other", generatedAt: "2026-11-14T12:00:00Z" });
      await repo.savePlan({ ...expected, id: "other-course", courseId: "other", generatedAt: "2026-11-14T12:00:00Z" });
      const later = { ...expected, id: "newest", generatedAt: "2026-11-13T13:00:00Z", items: [...expected.items, { ...expected.items[0]!, id: "second" }] };
      await repo.savePlan(later);
      expect(await repo.latestPlan(studentId, courseId)).toEqual(later);
      for (const status of ["done", "skipped", "todo"] as const) {
        await repo.setPlanItemStatus(later.id, "second", status);
        expect((await repo.latestPlan(studentId, courseId))?.items.map(i => i.status)).toEqual(["todo", status]);
      }
      await expect(repo.setPlanItemStatus("missing", "second", "done")).rejects.toThrow();
      await expect(repo.setPlanItemStatus(later.id, "missing", "done")).rejects.toThrow();
    });

    it("saves, replaces and isolates agent runs with nested events", async () => {
      const id = f.run.id;
      await repo.saveRun({ ...f.run, events: [] });
      await isolated(f.run, v => repo.saveRun(v), () => repo.getRun(id));
    });
  });
}
