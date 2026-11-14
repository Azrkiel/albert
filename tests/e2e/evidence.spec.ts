import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

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
  // Use the actual P2.8 session and P3.2 cards; test setup must not replace
  // the shared demo worksheet or hide mismatched skill IDs in mock replies.
  await page.waitForFunction(() => typeof window.__albert?.sessionId === "string");
  const sessionId = await page.evaluate(() => window.__albert!.sessionId!);
  const input = JSON.parse(readFileSync("fixtures/eval/requests/missing-dx-r1.json", "utf8"));
  input.sessionId = sessionId;
  const response = page.waitForResponse(res => res.url().endsWith("/api/hint") && res.request().method() === "POST");
  await page.locator('[data-problem-id="calc2-ws3/p1"]').getByRole("button", { name: "Need a hint?", exact: true }).click();
  const first = await response;
  expect(first.request().postDataJSON().sessionId).toBe(sessionId);
  expect(await first.text()).toContain('"type":"done"');
  for (const rung of [2, 3]) {
    const response = await request.post("/api/hint", { data: { ...input, rung, fixtureId: `calc2-ws3_p1-r${rung}` } });
    expect(await response.text()).toContain('"type":"done"');
  }
  const events = await (await request.get("/api/dev/evidence?studentId=demo&courseId=calc2")).json();
  const progress = await request.get("/api/progress/calc2");
  expect(progress.ok()).toBeTruthy();
  expect(await progress.json()).toMatchObject({ skills: expect.arrayContaining([{ studentId: "demo", courseId: "calc2", subskillId: "u3.find_dx", unitId: "calc2/u3", level: 1, evidenceIds: [], recentErrorTypes: ["missing_dx"], updatedAt: expect.any(String) }]), recentErrors: expect.arrayContaining([expect.objectContaining({ errorType: "missing_dx", subskillId: "u3.find_dx" })]) });
  expect(events.filter((e: { sessionId: string }) => e.sessionId === sessionId)).toMatchObject([{ outcome: "error_made", errorType: "missing_dx" }]);
});
