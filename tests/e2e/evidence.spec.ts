import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { examples } from "../unit/contracts.examples";

test("P7.1-AC2: replay handwriting and persist one missing_dx event across rungs", async ({ page, request }, testInfo) => {
  const recording = JSON.parse(readFileSync("fixtures/sessions/missing-dx.json", "utf8"));
  await page.goto("/work/calc2-ws3?dev=1&replay=missing-dx&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  const visible = await page.evaluate(() => window.__albert!.state.strokes.filter(s => s.erasedAt === undefined));
  expect(visible.length).toBeGreaterThan(0);
  expect([...new Set(visible.map(s => s.rowId))].sort()).toEqual([1, 2, 3].map(n => `calc2-ws3/p1/r${n}`));
  expect(await page.evaluate(() => window.__albert!.state.events)).toEqual(recording.events);
  await expect(page.locator('[data-problem-id="calc2-ws3/p1"] path[data-stroke-id]')).toHaveCount(visible.length);
  await page.locator('[data-problem-id="calc2-ws3/p1"]').screenshot({ path: testInfo.outputPath("missing-dx-replay.png") });
  // P2.8 has not supplied persisted UI sessions on this branch. Seed one and
  // call the real hint route directly; P3.1's hint-mark test remains separate.
  const input = JSON.parse(readFileSync("fixtures/eval/requests/missing-dx-r1.json", "utf8"));
  const sessionId = `evidence-${Date.now()}`;
  input.sessionId = sessionId;
  const card = structuredClone(examples.TeachingCard.valid);
  card.subskills[0]!.id = "calc2/u3/differential";
  const session = { ...examples.Session.valid, id: sessionId, worksheetId: input.worksheetId };
  const worksheet = { ...examples.Worksheet.valid, id: input.worksheetId, problems: [{ ...examples.Worksheet.valid.problems[0]!, id: input.problemId, subskillIds: [card.subskills[0]!.id] }] };
  expect((await request.post("/api/dev/evidence", { data: { session, card, worksheet } })).ok()).toBeTruthy();
  for (const rung of [1, 2, 3]) {
    const response = await request.post("/api/hint", { data: { ...input, rung, fixtureId: `calc2-ws3_p1-r${rung}` } });
    expect(await response.text()).toContain('"type":"done"');
  }
  const events = await (await request.get(`/api/dev/evidence?studentId=${session.studentId}&courseId=${session.courseId}`)).json();
  const progress = await request.get(`/api/progress/${session.courseId}`);
  expect(progress.ok()).toBeTruthy();
  expect(await progress.json()).toMatchObject({ skills: expect.arrayContaining([{ studentId: "demo", courseId: session.courseId, subskillId: card.subskills[0]!.id, unitId: card.unitId, level: 1, evidenceIds: [], recentErrorTypes: ["missing_dx"], updatedAt: expect.any(String) }]), recentErrors: expect.arrayContaining([expect.objectContaining({ errorType: "missing_dx", subskillId: card.subskills[0]!.id })]) });
  expect(events.filter((e: { sessionId: string }) => e.sessionId === sessionId)).toMatchObject([{ outcome: "error_made", errorType: "missing_dx" }]);
});
