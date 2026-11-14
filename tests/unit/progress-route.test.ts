import { afterEach, expect, it, vi } from "vitest";
import { MemoryRepo } from "../../src/lib/db/memory";
import { TeachingCardSchema, EvidenceEventSchema } from "../../src/lib/contracts";
import { examples } from "./contracts.examples";
const repo = new MemoryRepo();
vi.mock("../../src/lib/db", () => ({ getRepo: () => repo }));
const { GET } = await import("../../src/app/api/progress/[courseId]/route");
afterEach(() => vi.unstubAllEnvs());
it("returns 404 for an unknown course", async () => {
  expect((await GET(new Request("http://localhost/api/progress/missing"), { params: Promise.resolve({ courseId: "missing" }) })).status).toBe(404);
});
it("initializes taught skills without evidence and filters errors by demo student", async () => {
  vi.stubEnv("DEMO_STUDENT_ID", "first-time");
  const card = TeachingCardSchema.parse(examples.TeachingCard.valid);
  await repo.upsertCard(card);
  await repo.addEvidence([EvidenceEventSchema.parse(examples.EvidenceEvent.valid)]);
  const response = await GET(new Request("http://localhost/api/progress/course1"), { params: Promise.resolve({ courseId: card.courseId }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.skills).toHaveLength(3);
  expect(body.skills.every((s: { level: number; studentId: string }) => s.level === 1 && s.studentId === "first-time")).toBe(true);
  expect(body.recentErrors).toEqual([]);
});
