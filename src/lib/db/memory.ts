import type {
  AgentRun, Course, CourseConnection, CourseFile, CourseOutline, EvidenceEvent,
  PlanItem, Session, SessionEvent, SkillState, StoredHint, StudyPlan, TeachingCard,
  Worksheet,
} from "@/lib/contracts";
import type { Repo } from "./repo";

const copy = <T>(value: T): T => structuredClone(value);
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const skillKey = (s: SkillState) => JSON.stringify([s.studentId, s.courseId, s.subskillId]);

export class MemoryRepo implements Repo {
  private texts = new Map<string, string>();
  async putText(id: string, text: string): Promise<void> { this.texts.set(id, text); }
  async getText(id: string): Promise<string | null> { return this.texts.get(id) ?? null; }
  private connections = new Map<string, CourseConnection>();
  private outlines = new Map<string, CourseOutline>();
  private courses = new Map<string, Course>();
  private cards = new Map<string, TeachingCard>();
  private worksheets = new Map<string, Worksheet>();
  private files = new Map<string, { meta: CourseFile; bytes: Uint8Array }>();
  protected sessions = new Map<string, Session>();
  protected sessionEvents = new Map<string, SessionEvent[]>();
  private hints = new Map<string, StoredHint>();
  private evidence = new Map<string, EvidenceEvent>();
  private skills = new Map<string, SkillState>();
  private plans = new Map<string, StudyPlan>();
  private runs = new Map<string, AgentRun>();

  async saveConnection(c: CourseConnection): Promise<void> { this.connections.set(c.studentId, copy(c)); }
  async getConnection(studentId: string): Promise<CourseConnection | null> { return copy(this.connections.get(studentId) ?? null); }
  async saveOutline(o: CourseOutline): Promise<void> { this.outlines.set(o.course.id, copy(o)); }
  async getOutline(courseId: string): Promise<CourseOutline | null> { return copy(this.outlines.get(courseId) ?? null); }
  async upsertCourse(c: Course): Promise<void> { this.courses.set(c.id, copy(c)); }
  async getCourse(id: string): Promise<Course | null> { return copy(this.courses.get(id) ?? null); }
  async upsertCard(c: TeachingCard): Promise<void> { this.cards.set(c.unitId, copy(c)); }
  async listCards(courseId: string): Promise<TeachingCard[]> {
    return copy([...this.cards.values()].filter(c => c.courseId === courseId).sort((a, b) => a.order - b.order || a.unitId.localeCompare(b.unitId)));
  }
  async upsertWorksheet(w: Worksheet): Promise<void> { this.worksheets.set(w.id, copy(w)); }
  async listWorksheets(courseId: string): Promise<Worksheet[]> { return copy([...this.worksheets.values()].filter(w => w.courseId === courseId).sort(byId)); }
  async getWorksheet(id: string): Promise<Worksheet | null> { return copy(this.worksheets.get(id) ?? null); }
  async putFile(meta: CourseFile, bytes: Uint8Array): Promise<void> {
    this.files.set(meta.id, { meta: copy(meta), bytes: new Uint8Array(bytes) });
  }
  async getFile(id: string): Promise<{ meta: CourseFile; bytes: Uint8Array } | null> { return copy(this.files.get(id) ?? null); }
  async getSession(id: string): Promise<Session | null> { return copy(this.sessions.get(id) ?? null); }
  async createSession(s: Session): Promise<void> {
    if (this.sessions.has(s.id)) throw new Error(`Session already exists: ${s.id}`);
    this.sessions.set(s.id, copy(s));
  }
  async appendEvents(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (!this.sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
    this.sessionEvents.set(sessionId, [...(this.sessionEvents.get(sessionId) ?? []), ...copy(events)]);
  }
  /** By `at`, then append order (Array.prototype.sort is stable, so equal `at` keeps insertion order). */
  async listEvents(sessionId: string): Promise<SessionEvent[]> {
    return copy([...(this.sessionEvents.get(sessionId) ?? [])].sort((a, b) => a.at - b.at));
  }
  async latestOpenSession(worksheetId: string): Promise<Session | null> {
    return copy([...this.sessions.values()].filter(s => s.worksheetId === worksheetId && s.endedAt === undefined)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || byId(a, b))[0] ?? null);
  }
  async endSession(sessionId: string, at: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.endedAt = at;
  }
  async saveHint(h: StoredHint): Promise<void> { this.hints.set(h.id, copy(h)); }
  async listHints(filter: { sessionId?: string; courseId?: string }): Promise<StoredHint[]> {
    return copy([...this.hints.values()].filter(h =>
      (filter.sessionId === undefined || h.sessionId === filter.sessionId) &&
      (filter.courseId === undefined || h.courseId === filter.courseId),
    ).sort((a, b) => a.at.localeCompare(b.at) || byId(a, b)));
  }
  async addEvidence(events: EvidenceEvent[]): Promise<void> { for (const e of events) this.evidence.set(e.id, copy(e)); }
  async listEvidence(studentId: string, courseId: string): Promise<EvidenceEvent[]> {
    return copy([...this.evidence.values()].filter(e => e.studentId === studentId && e.courseId === courseId).sort((a, b) => a.at.localeCompare(b.at) || byId(a, b)));
  }
  async saveSkills(skills: SkillState[]): Promise<void> { for (const s of skills) this.skills.set(skillKey(s), copy(s)); }
  async listSkills(studentId: string, courseId: string): Promise<SkillState[]> {
    return copy([...this.skills.values()].filter(s => s.studentId === studentId && s.courseId === courseId).sort((a, b) => a.subskillId.localeCompare(b.subskillId)));
  }
  async savePlan(p: StudyPlan): Promise<void> { this.plans.set(p.id, copy(p)); }
  async latestPlan(studentId: string, courseId: string): Promise<StudyPlan | null> {
    return copy([...this.plans.values()].filter(p => p.studentId === studentId && p.courseId === courseId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || byId(a, b))[0] ?? null);
  }
  async setPlanItemStatus(planId: string, itemId: string, status: PlanItem["status"]): Promise<void> {
    const item = this.plans.get(planId)?.items.find(i => i.id === itemId);
    if (!item) throw new Error(`Plan item not found: ${planId}/${itemId}`);
    item.status = status;
  }
  async saveRun(r: AgentRun): Promise<void> { this.runs.set(r.id, copy(r)); }
  async getRun(id: string): Promise<AgentRun | null> { return copy(this.runs.get(id) ?? null); }
  async ping(): Promise<boolean> { return true; }
}
