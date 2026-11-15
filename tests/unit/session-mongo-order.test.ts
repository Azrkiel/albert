import { MongoClient } from "mongodb";
import { expect, it, vi } from "vitest";
import { MongoRepo } from "../../src/lib/db/mongo";
import type { SessionEvent } from "../../src/lib/contracts";

it("allocates Mongo append positions and reads ordered events without storage metadata (offline)", async () => {
  const db = new MongoClient("mongodb://127.0.0.1:27017").db("offline_order");
  const findOneAndUpdate = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: "s", next: 2 });
  const insertMany = vi.fn().mockResolvedValue({});
  const sort = vi.fn().mockReturnValue({ toArray: async () => [
    { _id: "a", sessionId: "s", sequence: 0, type: "problem_opened", at: 10, problemId: "first" },
    { _id: "b", sessionId: "s", sequence: 1, type: "problem_opened", at: 10, problemId: "second" },
    { _id: "c", sessionId: "s", sequence: 2, type: "problem_opened", at: 1, problemId: "third" },
  ] });
  const find = vi.fn().mockReturnValue({ sort });
  const fake = {
    createIndex: vi.fn().mockResolvedValue("index"), findOne: vi.fn().mockResolvedValue({ _id: "s", id: "s" }),
    findOneAndUpdate, insertMany, find,
  };
  vi.spyOn(db, "collection").mockReturnValue(fake as unknown as ReturnType<typeof db.collection>);
  const repo = new MongoRepo(db);
  const events: SessionEvent[] = [
    { type: "problem_opened", at: 10, problemId: "first" },
    { type: "problem_opened", at: 10, problemId: "second" },
    { type: "problem_opened", at: 1, problemId: "third" },
  ];
  await repo.appendEvents("s", events.slice(0, 2));
  await repo.appendEvents("s", events.slice(2));
  expect(findOneAndUpdate.mock.calls.map(call => call[1])).toEqual([{ $inc: { next: 2 } }, { $inc: { next: 1 } }]);
  expect(insertMany.mock.calls.flatMap(call => call[0]).map(doc => doc.sequence)).toEqual([0, 1, 2]);
  expect(await repo.listEvents("s")).toEqual(events);
  expect(find).toHaveBeenCalledWith({ sessionId: "s" });
  expect(sort).toHaveBeenCalledWith({ sequence: 1, _id: 1 });
});
