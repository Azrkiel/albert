import { MongoClient } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { getMongoClient, MongoRepo } from "../../src/lib/db/mongo";

function setup() {
  // A real Db object supplies driver options; all network operations are mocked.
  const client = new MongoClient("mongodb://127.0.0.1:27017");
  const db = client.db("repo_index_unit_test");
  const createIndex = vi.fn().mockResolvedValue("index");
  const collection = vi.spyOn(db, "collection").mockReturnValue({ createIndex } as unknown as ReturnType<typeof db.collection>);
  const command = vi.spyOn(db, "command").mockResolvedValue({ ok: 1 });
  return { repo: new MongoRepo(db), collection, createIndex, command };
}

describe("Mongo startup", () => {
  it("creates exactly the six contract indexes once, even with concurrent startup calls", async () => {
    const { repo, collection, createIndex } = setup();
    await Promise.all([repo.ensureIndexes(), repo.ensureIndexes(), repo.ping()]);
    await repo.ensureIndexes();
    expect(collection.mock.calls.map(([name]) => name)).toEqual([
      "filedata.chunks", "filedata.files", "cards", "worksheets", "session_events", "evidence", "plans", "hints",
    ]);
    expect(createIndex.mock.calls.map(([keys]) => keys)).toEqual([
      { courseId: 1, order: 1 }, { courseId: 1 }, { sessionId: 1, at: 1 },
      { studentId: 1, courseId: 1, subskillId: 1, at: 1 },
      { studentId: 1, courseId: 1, generatedAt: -1 }, { courseId: 1, at: 1 },
    ]);
  });

  it("reports failed index initialization and retries on the next operation", async () => {
    const { repo, createIndex } = setup();
    createIndex.mockRejectedValueOnce(new Error("offline"));
    expect(await repo.ping()).toBe(false);
    expect(await repo.ping()).toBe(true);
    expect(createIndex).toHaveBeenCalledTimes(12);
  });

  it("reports failed database pings as false", async () => {
    const { repo, command } = setup();
    command.mockRejectedValueOnce(new Error("offline"));
    expect(await repo.ping()).toBe(false);
    expect(await repo.ping()).toBe(true);
  });

  it("shares a MongoClient for the same connection across module reloads", async () => {
    const uri = "mongodb://127.0.0.1:27017";
    const client = getMongoClient(uri);
    vi.resetModules();
    const reloaded = await import("../../src/lib/db/mongo");
    expect(reloaded.getMongoClient(uri)).toBe(client);
  });
});
