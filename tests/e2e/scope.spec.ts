import { expect, test } from "@playwright/test";

test("STORE=memory server loads the demo cards at start and serves /api/scope", async ({ request }) => {
  const res = await request.get("/api/scope/calc2-ws3?problemId=calc2-ws3%2Fp1");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.card.unitId).toBe("calc2/u3");
  expect(body.coveredMethods.map((m: { unitId: string }) => m.unitId)).not.toContain("calc2/u4");
  expect(body.upcomingMethods).toEqual([{ name: "Partial fractions", unitId: "calc2/u4", unitTitle: "Partial Fractions" }]);
  expect((await request.get("/api/scope/calc2-ws3")).status()).toBe(400);
  expect((await request.get("/api/scope/nope?problemId=x")).status()).toBe(404);
});
