import { MongoServerError, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { dropTestDatabase } from "./repo.mongo-cleanup";

const name = `repo_${"a".repeat(32)}`;

function setup(databaseName = name) {
  const dropDatabase = vi.fn().mockResolvedValue(true);
  const dropCollection = vi.fn().mockResolvedValue(true);
  const toArray = vi.fn().mockResolvedValue([]);
  const listCollections = vi.fn().mockReturnValue({ toArray });
  const listDatabases = vi.fn().mockResolvedValue({ databases: [] });
  const db = { databaseName, dropDatabase, dropCollection, listCollections, admin: () => ({ listDatabases }) } as unknown as Db;
  return { db, dropDatabase, dropCollection, listCollections, toArray, listDatabases };
}

describe("MongoRepo test database cleanup", () => {
  it("uses dropDatabase when permitted and verifies the database is gone", async () => {
    const f = setup();
    await dropTestDatabase(f.db);
    expect(f.dropDatabase).toHaveBeenCalledOnce();
    expect(f.dropCollection).not.toHaveBeenCalled();
    expect(f.listDatabases).toHaveBeenCalledWith({ filter: { name }, nameOnly: true, authorizedDatabases: true });
  });

  it.each([
    new MongoServerError({ code: 13, message: "not authorized" }),
    new MongoServerError({ code: 8000, message: `user is not allowed to do action [dropDatabase] on [${name}.]` }),
  ])("removes every owned collection when dropDatabase is denied (%s)", async error => {
    const f = setup();
    f.dropDatabase.mockRejectedValue(error);
    f.toArray.mockResolvedValueOnce([
      { name: "sessions" }, { name: "filedata.files" }, { name: "filedata.chunks" },
    ]).mockResolvedValueOnce([]);
    await dropTestDatabase(f.db);
    expect(f.dropCollection.mock.calls).toEqual([["sessions"], ["filedata.files"], ["filedata.chunks"]]);
    expect(f.listDatabases).toHaveBeenCalledOnce();
  });

  it("refuses cleanup of an application database before issuing any command", async () => {
    const f = setup("albert");
    await expect(dropTestDatabase(f.db)).rejects.toThrow("Refusing");
    expect(f.dropDatabase).not.toHaveBeenCalled();
    expect(f.listCollections).not.toHaveBeenCalled();
    expect(f.dropCollection).not.toHaveBeenCalled();
  });

  it.each([
    new Error("connection lost"),
    new MongoServerError({ code: 8000, message: "invalid database name" }),
  ])("preserves unrelated failures without falling back (%s)", async error => {
    const f = setup();
    f.dropDatabase.mockRejectedValue(error);
    await expect(dropTestDatabase(f.db)).rejects.toBe(error);
    expect(f.listCollections).not.toHaveBeenCalled();
    expect(f.dropCollection).not.toHaveBeenCalled();
  });

  it("fails if a collection cannot be removed", async () => {
    const f = setup();
    const error = new MongoServerError({ code: 13, message: "dropCollection denied" });
    f.dropDatabase.mockRejectedValue(new MongoServerError({ code: 13, message: "dropDatabase denied" }));
    f.toArray.mockResolvedValueOnce([{ name: "sessions" }]);
    f.dropCollection.mockRejectedValue(error);
    await expect(dropTestDatabase(f.db)).rejects.toBe(error);
    expect(f.listDatabases).not.toHaveBeenCalled();
  });

  it("fails if collections remain after cleanup", async () => {
    const f = setup();
    f.toArray.mockResolvedValue([{ name: "sessions" }]);
    await expect(dropTestDatabase(f.db)).rejects.toThrow("left collections");
  });

  it("fails if the database is still listed even with no collections", async () => {
    const f = setup();
    f.listDatabases.mockResolvedValue({ databases: [{ name }] });
    await expect(dropTestDatabase(f.db)).rejects.toThrow("still exists");
  });

  it("fails when absence cannot be verified", async () => {
    const f = setup();
    const error = new MongoServerError({ code: 13, message: "listDatabases denied" });
    f.listDatabases.mockRejectedValue(error);
    await expect(dropTestDatabase(f.db)).rejects.toBe(error);
  });
});
