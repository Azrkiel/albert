import { readFileSync, existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { examples } from "../unit/contracts.examples";

test("hint route persists one missing_dx event across rungs", async ({ request }) => {
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
  expect(events.filter((e: { sessionId: string }) => e.sessionId === sessionId)).toMatchObject([{ outcome: "error_made", errorType: "missing_dx" }]);
});

test("P7.1-AC2 recorded missing-dx replay", async ({ page }) => {
  test.fixme(!existsSync("fixtures/sessions/missing-dx.json"), "blocked: P2.6 hint mark and missing-dx recording are absent on main");
  await page.goto("/work/calc2-ws3?replay=missing-dx&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  await page.getByRole("button", { name: "Need a hint?", exact: true }).click();
  await expect(page.locator('[data-albert-column]').first()).toContainText("What does dx become?");
});
