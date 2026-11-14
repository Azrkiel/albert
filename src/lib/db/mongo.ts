import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GridFSBucket, MongoClient, type Db, type Document, type Filter, type ObjectId, type Sort } from "mongodb";
import type {
  AgentRun, Course, CourseConnection, CourseFile, CourseOutline, EvidenceEvent,
  PlanItem, Session, SessionEvent, SkillState, StoredHint, StudyPlan, TeachingCard,
  Worksheet,
} from "@/lib/contracts";
import type { Repo } from "./repo";

type StoredDocument = Document & { _id: string };
const withoutId = <T>(doc: StoredDocument): T => {
  const { _id, ...value } = doc;
  void _id;
  return value as T;
};

// Cache the driver, rather than reconnecting on each Next.js hot reload.
const shared = globalThis as typeof globalThis & { albertMongoClients?: Map<string, MongoClient> };
export function getMongoClient(uri: string): MongoClient {
  const clients = shared.albertMongoClients ??= new Map();
  let client = clients.get(uri);
  if (!client) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    clients.set(uri, client);
  }
  return client;
}

export class MongoRepo implements Repo {
  private indexes?: Promise<void>;
  private readonly bucket: GridFSBucket;

  constructor(private readonly db: Db) {
    this.bucket = new GridFSBucket(db, { bucketName: "filedata" });
  }

  ensureIndexes(): Promise<void> {
    return this.indexes ??= Promise.all([
      this.db.collection("cards").createIndex({ courseId: 1, order: 1 }),
      this.db.collection("worksheets").createIndex({ courseId: 1 }),
      this.db.collection("session_events").createIndex({ sessionId: 1, at: 1 }),
      this.db.collection("evidence").createIndex({ studentId: 1, courseId: 1, subskillId: 1, at: 1 }),
      this.db.collection("plans").createIndex({ studentId: 1, courseId: 1, generatedAt: -1 }),
      this.db.collection("hints").createIndex({ courseId: 1, at: 1 }),
    ]).then(() => undefined).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
  }

  private async collection(name: string) {
    await this.ensureIndexes();
    return this.db.collection<StoredDocument>(name, { ignoreUndefined: true });
  }
  private async put<T extends object>(name: string, id: string, value: T): Promise<void> {
    await (await this.collection(name)).replaceOne({ _id: id }, { ...value, _id: id }, { upsert: true });
  }
  private async one<T>(name: string, id: string): Promise<T | null> {
    const doc = await (await this.collection(name)).findOne({ _id: id });
    return doc ? withoutId<T>(doc) : null;
  }
  private async list<T>(name: string, filter: Filter<StoredDocument>, sort: Sort): Promise<T[]> {
    return (await (await this.collection(name)).find(filter).sort(sort).toArray()).map(doc => withoutId<T>(doc));
  }

  async saveConnection(c: CourseConnection): Promise<void> { await this.put("connections", c.studentId, c); }
  async getConnection(studentId: string): Promise<CourseConnection | null> { return this.one("connections", studentId); }
  async saveOutline(o: CourseOutline): Promise<void> { await this.put("outlines", o.course.id, o); }
  async getOutline(courseId: string): Promise<CourseOutline | null> { return this.one("outlines", courseId); }
  async upsertCourse(c: Course): Promise<void> { await this.put("courses", c.id, c); }
  async getCourse(id: string): Promise<Course | null> { return this.one("courses", id); }
  async upsertCard(c: TeachingCard): Promise<void> { await this.put("cards", c.unitId, c); }
  async listCards(courseId: string): Promise<TeachingCard[]> { return this.list("cards", { courseId }, { order: 1, unitId: 1 }); }
  async upsertWorksheet(w: Worksheet): Promise<void> { await this.put("worksheets", w.id, w); }
  async listWorksheets(courseId: string): Promise<Worksheet[]> { return this.list("worksheets", { courseId }, { id: 1 }); }
  async getWorksheet(id: string): Promise<Worksheet | null> { return this.one("worksheets", id); }
  async putText(id: string, text: string): Promise<void> { await this.put("texts", id, { text }); }
  async getText(id: string): Promise<string | null> { return (await this.one<{ text: string }>("texts", id))?.text ?? null; }

  async putFile(meta: CourseFile, bytes: Uint8Array): Promise<void> {
    const files = await this.collection("files");
    const upload = this.bucket.openUploadStream(meta.id, { metadata: { mime: meta.mime } });
    // Copy before awaiting the stream so caller mutation cannot change the upload.
    await pipeline(Readable.from([Buffer.from(bytes)]), upload);
    let previous: StoredDocument | null;
    try {
      previous = await files.findOneAndReplace({ _id: meta.id }, { ...meta, _id: meta.id, dataId: upload.id }, { upsert: true, returnDocument: "before" });
    } catch (error) {
      await this.bucket.delete(upload.id);
      throw error;
    }
    if (previous) await this.bucket.delete(previous.dataId as ObjectId);
  }
  async getFile(id: string): Promise<{ meta: CourseFile; bytes: Uint8Array } | null> {
    const doc = await (await this.collection("files")).findOne({ _id: id });
    if (!doc) return null;
    const { dataId, ...meta } = doc;
    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket.openDownloadStream(dataId as ObjectId)) chunks.push(Buffer.from(chunk));
    return { meta: withoutId<CourseFile>(meta), bytes: new Uint8Array(Buffer.concat(chunks)) };
  }

  async getSession(id: string): Promise<Session | null> { return this.one("sessions", id); }
  async createSession(s: Session): Promise<void> { await (await this.collection("sessions")).insertOne({ ...s, _id: s.id }); }
  async appendEvents(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (!await this.one<Session>("sessions", sessionId)) throw new Error(`Session not found: ${sessionId}`);
    if (events.length) await this.db.collection("session_events", { ignoreUndefined: true }).insertMany(events.map(event => ({ ...event, sessionId })));
  }
  async endSession(sessionId: string, at: string): Promise<void> {
    const result = await (await this.collection("sessions")).updateOne({ _id: sessionId }, { $set: { endedAt: at } });
    if (!result.matchedCount) throw new Error(`Session not found: ${sessionId}`);
  }
  async saveHint(h: StoredHint): Promise<void> { await this.put("hints", h.id, h); }
  async listHints(filter: { sessionId?: string; courseId?: string }): Promise<StoredHint[]> {
    const query: Filter<StoredDocument> = {};
    if (filter.sessionId !== undefined) query.sessionId = filter.sessionId;
    if (filter.courseId !== undefined) query.courseId = filter.courseId;
    return this.list("hints", query, { at: 1, id: 1 });
  }
  async addEvidence(events: EvidenceEvent[]): Promise<void> {
    for (const e of events) await this.put("evidence", e.id, e);
  }
  async listEvidence(studentId: string, courseId: string): Promise<EvidenceEvent[]> { return this.list("evidence", { studentId, courseId }, { at: 1, id: 1 }); }
  async saveSkills(skills: SkillState[]): Promise<void> {
    for (const s of skills) await this.put("skills", JSON.stringify([s.studentId, s.courseId, s.subskillId]), s);
  }
  async listSkills(studentId: string, courseId: string): Promise<SkillState[]> { return this.list("skills", { studentId, courseId }, { subskillId: 1 }); }
  async savePlan(p: StudyPlan): Promise<void> { await this.put("plans", p.id, p); }
  async latestPlan(studentId: string, courseId: string): Promise<StudyPlan | null> {
    const doc = await (await this.collection("plans")).findOne({ studentId, courseId }, { sort: { generatedAt: -1, id: 1 } });
    return doc ? withoutId<StudyPlan>(doc) : null;
  }
  async setPlanItemStatus(planId: string, itemId: string, status: PlanItem["status"]): Promise<void> {
    const result = await (await this.collection("plans")).updateOne({ _id: planId, "items.id": itemId }, { $set: { "items.$.status": status } });
    if (!result.matchedCount) throw new Error(`Plan item not found: ${planId}/${itemId}`);
  }
  async saveRun(r: AgentRun): Promise<void> { await this.put("agent_runs", r.id, r); }
  async getRun(id: string): Promise<AgentRun | null> { return this.one("agent_runs", id); }
  async ping(): Promise<boolean> {
    try {
      await this.ensureIndexes();
      return (await this.db.command({ ping: 1 })).ok === 1;
    } catch { return false; }
  }
}
