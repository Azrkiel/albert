import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { MongoClient } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionEventSchema, type Session, type SessionEvent } from "../../src/lib/contracts";
import { getRepo, MemoryRepo, MongoRepo } from "../../src/lib/db";
import { repoBehaviour } from "./repo.shared";
import { dropTestDatabase } from "./repo.mongo-cleanup";

// Atlas caps database names at 38 bytes; this preserves the full UUID in 37.
function testDatabaseName(): string {
  return `repo_${randomUUID().replaceAll("-", "")}`;
}

class InspectableMemoryRepo extends MemoryRepo {
  async readSession(id: string): Promise<Session | null> { return structuredClone(this.sessions.get(id) ?? null); }
  async readEvents(id: string): Promise<SessionEvent[]> { return structuredClone(this.sessionEvents.get(id) ?? []); }
}

repoBehaviour("MemoryRepo", async () => {
  const repo = new InspectableMemoryRepo();
  return { repo, readSession: id => repo.readSession(id), readEvents: id => repo.readEvents(id), dispose: async () => {} };
});

if (process.env.RUN_DB_TESTS === "1" && existsSync(".env.local")) loadEnvFile(".env.local");
const mongoEnabled = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.MONGODB_URI);

repoBehaviour("MongoRepo (live, throwaway database)", async () => {
  const client = new MongoClient(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 5000 });
  // Never use MONGODB_DB here: only a freshly generated test database is dropped.
  const db = client.db(testDatabaseName());
  const repo = new MongoRepo(db);
  return {
    repo,
    readSession: async id => {
      const doc = await db.collection<Session>("sessions").findOne({ id }, { projection: { _id: 0 } });
      return doc;
    },
    readEvents: async sessionId => (await db.collection("session_events").find({ sessionId }).sort({ _id: 1 }).toArray()).map(doc => SessionEventSchema.parse(doc)),
    dispose: async () => { try { await dropTestDatabase(db); } finally { await client.close(); } },
  };
}, mongoEnabled, 30000);

describe("MongoRepo test databases", () => {
  it("keeps throwaway names unique and within Atlas's 38-byte limit", () => {
    const names = [testDatabaseName(), testDatabaseName()];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(38);
  });
});

describe("getRepo", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("returns one persistent MemoryRepo without requiring Mongo credentials", async () => {
    vi.stubEnv("STORE", "memory");
    vi.stubEnv("MONGODB_URI", "");
    expect(getRepo()).toBeInstanceOf(MemoryRepo);
    expect(getRepo()).toBe(getRepo());
    expect(await getRepo().ping()).toBe(true);
  });
  it("defaults to Mongo and requires its URI", () => {
    vi.stubEnv("STORE", "");
    vi.stubEnv("MONGODB_URI", "");
    expect(() => getRepo()).toThrow("MONGODB_URI");
  });
  it("caches MongoRepo by URI and database without connecting until first use", () => {
    vi.stubEnv("STORE", "mongo");
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:27017");
    vi.stubEnv("MONGODB_DB", "repo_selection_test");
    const first = getRepo();
    expect(first).toBeInstanceOf(MongoRepo);
    expect(getRepo()).toBe(first);
    vi.stubEnv("MONGODB_DB", "repo_selection_test_other");
    expect(getRepo()).not.toBe(first);
  });
  it("rejects an unsupported store", () => {
    vi.stubEnv("STORE", "typo");
    expect(() => getRepo()).toThrow("Unknown STORE");
  });
});
