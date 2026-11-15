import { expect, test, type Page } from "@playwright/test";

// P4.4: the conductor plays a hint stream as ink. The mock stream is fixtures/llm/calc2-ws3_p1-r{1,2}.json;
// the error mocks are the P3.8 ones in fixtures/llm/error-*.json.
const missingDx = 'section[data-problem-id="calc2-ws3/p1"]';
const albert = `${missingDx} g.albert`;
const r3 = "calc2-ws3/p1/r3";

async function openMissingDx(page: Page, query = "") {
  await page.goto(`/work/calc2-ws3?replay=missing-dx&speed=instant${query}`);
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  await expect(page.locator(missingDx).locator("svg[data-capture-ready=true]")).toBeVisible();
}
const tapMark = (page: Page) => page.locator(missingDx).getByRole("button", { name: "Need a hint?", exact: true }).click({ timeout: 25000 });

/** Draw a short pen stroke through a logical point (the SVG viewBox is the page). */
async function drawAt(page: Page, px: number, py: number) {
  const surface = page.locator(`${missingDx} svg[data-capture-ready=true]`);
  await surface.scrollIntoViewIfNeeded();
  const [a, b] = await surface.evaluate((svg, pts) => pts.map(([x, y]) => {
    const p = new DOMPoint(x, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: p.x, y: p.y };
  }), [[px - 20, py], [px + 20, py + 8]]);
  await page.mouse.move(a!.x, a!.y);
  await page.mouse.down();
  await page.mouse.move(b!.x, b!.y, { steps: 6 });
  await page.mouse.up();
}
const rowBox = (page: Page) => page.evaluate((id) => window.__albert!.state.rows.find((r) => r.id === id)!.bbox, r3);

test("P4.4-AC1 (G2 mock): circle, arrow, hint text, citation, then the More help chip, in that order", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openMissingDx(page);
  // Record the first frame each stage is on the page (text and citation count once their wipe has begun).
  await page.evaluate(() => {
    const seen: Record<string, number> = {};
    const q = (s: string) => document.querySelector(`section[data-problem-id="calc2-ws3/p1"] ${s}`);
    const shown = (s: string) => { const el = q(s); return !!el && !el.parentElement?.hasAttribute("visibility"); };
    const stages: Record<string, () => boolean> = {
      dot: () => !!q("[data-albert-dot]"),
      circle: () => !!q('g.albert [data-mark-kind="circle"]'),
      arrow: () => !!q('g.albert [data-mark-kind="arrow"]'),
      text: () => shown('g.albert [data-ink-segment="text"]'),
      citation: () => shown('g.albert [data-ink-segment="citation"]'),
      chip: () => !!q("[data-albert-chip]"),
    };
    (window as unknown as { __stages: Record<string, number> }).__stages = seen;
    const tick = () => { for (const [k, f] of Object.entries(stages)) if (!(k in seen) && f()) seen[k] = performance.now(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await tapMark(page);
  const chip = page.locator(`${missingDx} [data-albert-chip]`);
  await expect(chip).toHaveText("More help", { timeout: 15000 });
  const stages = await page.evaluate(() => (window as unknown as { __stages: Record<string, number> }).__stages);
  test.info().annotations.push({ type: "stages", description: JSON.stringify(stages) });
  const order = ["circle", "arrow", "text", "citation", "chip"] as const;
  for (const k of order) expect(stages[k], k).toBeGreaterThan(0);
  for (let i = 1; i < order.length; i++) expect(stages[order[i]!]!, `${order[i]} after ${order[i - 1]}`).toBeGreaterThanOrEqual(stages[order[i - 1]!]!);
  await expect(page.locator(`${albert} [data-albert-writing]`)).toContainText("dx");
  await expect(page.locator(`${albert} [data-ink-segment="citation"]`)).toContainText("Lecture 9");
  // The dot is gone once the hint is done; the hint is recorded as a hint_shown event with its marks.
  await expect(page.locator(`${missingDx} [data-albert-dot]`)).toHaveCount(0);
  const shown = await page.evaluate(() => window.__albert!.state.events.filter((e) => e.type === "hint_shown"));
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({ type: "hint_shown" });
  const kinds = (shown[0] as { marks: { spec: { type: string } }[] }).marks.map((m) => m.spec.type);
  expect(kinds).toEqual(expect.arrayContaining(["circle", "arrow", "writing"]));
  // The red HTML column keeps the plain text for screen readers but is not drawn over the ink.
  await expect(page.locator(`${missingDx} [data-albert-column]`)).toContainText("What does dx become?");
  expect(pageErrors).toEqual([]);
});

test("P4.4-AC2: rung 2 stacks under rung 1, rung 1's writing fades and its circle stays", async ({ page }) => {
  await openMissingDx(page);
  await tapMark(page);
  const chip = page.locator(`${missingDx} [data-albert-chip]`);
  await expect(chip).toBeVisible({ timeout: 15000 });
  await chip.click();
  await expect(page.locator(`${albert} [data-albert-writing]`)).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator(`${missingDx} [data-albert-chip]`)).toBeVisible({ timeout: 15000 });
  const writings = page.locator(`${albert} [data-albert-writing]`);
  await expect(writings.first()).toHaveCSS("opacity", "0.35");
  await expect(writings.last()).toHaveCSS("opacity", "1");
  const [first, second] = await writings.evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }));
  expect(second!.top).toBeGreaterThanOrEqual(first!.bottom - 1);
  // The circle and arrow from rung 1 stay, and rung 2 does not draw them again.
  await expect(page.locator(`${albert} [data-mark-kind="circle"]`)).toHaveCount(1);
  await expect(page.locator(`${albert} [data-mark-kind="arrow"]`)).toHaveCount(1);
  await expect(page.locator(`${albert} [data-mark-kind="circle"]`)).toHaveCSS("opacity", "1");
});

for (const fixtureId of ["error-timeout", "error-bad_model_output", "error-mid-stream"] as const) {
  test(`P4.4-AC3: ${fixtureId} leaves no Albert marks`, async ({ page }) => {
    let pending: string | undefined = fixtureId;
    await page.route("**/api/hint", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const postData = JSON.stringify(pending ? { ...body, fixtureId: pending } : body);
      pending = undefined;
      await route.continue({ postData });
    });
    await openMissingDx(page);
    await tapMark(page);
    if (fixtureId === "error-mid-stream") {
      // Marks and partial text really were drawn before the error took them away.
      await expect(page.locator(`${albert} [data-mark-kind="circle"]`)).toHaveCount(1, { timeout: 10000 });
    }
    await expect(page.locator(`${missingDx} [data-albert-column]`)).toHaveText(/Try again|too long|read that/, { timeout: 15000 });
    await expect(page.locator(`${albert} [data-albert-hint], ${missingDx} [data-albert-dot], ${missingDx} [data-albert-chip]`)).toHaveCount(0);
    await expect(page.locator(`${albert} [data-mark-kind], ${albert} [data-ink-segment]`)).toHaveCount(0);
    await expect(page.locator(`${missingDx} [data-albert-clear]`)).toHaveCount(0);
  });
}

test("P4.4-AC4: new ink in the row fades the hint; Clear Albert's notes removes it", async ({ page }) => {
  await openMissingDx(page);
  await tapMark(page);
  await expect(page.locator(`${missingDx} [data-albert-chip]`)).toBeVisible({ timeout: 15000 });
  const hint = page.locator(`${albert} [data-albert-hint]`);
  await expect(hint).toHaveCSS("opacity", "1");
  const row = await rowBox(page);
  await drawAt(page, row.x + row.w - 120, row.y + row.h - 30);
  await expect(hint).toHaveCSS("opacity", "0.35");
  await page.locator(`${missingDx} [data-albert-clear]`).click();
  await expect(page.locator(`${albert} [data-albert-hint]`)).toHaveCount(0);
  await expect(page.locator(`${missingDx} [data-albert-chip]`)).toHaveCount(0);
});

test("P4.4-AC5: Albert's ink never blocks the pen", async ({ page }) => {
  await openMissingDx(page);
  await tapMark(page);
  await expect(page.locator(`${missingDx} [data-albert-chip]`)).toBeVisible({ timeout: 15000 });
  await expect(page.locator(albert)).toHaveCSS("pointer-events", "none");
  const circle = await page.locator(`${albert} [data-mark-kind="circle"]`).evaluate((g) => { const b = (g as SVGGraphicsElement).getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const before = await page.evaluate(() => window.__albert!.state.strokes.length);
  // Through the circle's outline, where Albert's ink sits.
  await drawAt(page, circle.x + 2, circle.y + circle.h / 2);
  await expect.poll(() => page.evaluate(() => window.__albert!.state.strokes.length)).toBe(before + 1);
  await expect(page.locator(`${missingDx} path[data-stroke-id]`).last()).toBeVisible();
});

test("P4.4: the student writing mid-animation finishes it at once", async ({ page }) => {
  await openMissingDx(page);
  await tapMark(page);
  const revealing = page.locator(`${albert} [data-ink-revealing]`);
  await expect(revealing.first()).toBeAttached({ timeout: 10000 });
  const row = await rowBox(page);
  await drawAt(page, row.x + 300, row.y + row.h - 20);
  // The mock stream still has about a second to go; the pen is not kept waiting for it.
  await expect(revealing).toHaveCount(0, { timeout: 700 });
  await expect(page.locator(`${albert} [data-mark-kind="circle"]`)).toHaveCount(1);
});

test("P4.4: reduced motion draws everything in its final state at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMissingDx(page);
  await page.evaluate(() => {
    const w = window as unknown as { __revealed: number };
    w.__revealed = 0;
    const tick = () => { if (document.querySelector("[data-ink-revealing]")) w.__revealed++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await tapMark(page);
  await expect(page.locator(`${missingDx} [data-albert-chip]`)).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => (window as unknown as { __revealed: number }).__revealed)).toBe(0);
  await expect(page.locator(`${albert} [data-ink-segment="citation"]`)).toContainText("Lecture 9");
});

/** A custom reply through the real client and conductor, replacing the route's answer. */
async function replyWith(page: Page, hint: Record<string, unknown>) {
  const events = [
    { type: "started", hintId: "custom-1", at: 0 }, { type: "reading", rows: [] },
    { type: "diagnosis", status: "error", inScope: true },
    { type: "mark", mark: { type: "circle", rowId: r3, clusterIds: [`${r3}/c1`] } },
    { type: "hint", kind: "question", ...hint }, { type: "done", hintId: "custom-1", ms: { firstEvent: 10, total: 20 } },
  ];
  await page.route("**/api/hint", (route) => route.fulfill({ status: 200, contentType: "application/x-ndjson",
    body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" }));
}

test("P4.4: text and math get spaces between them", async ({ page }) => {
  await replyWith(page, { segments: [{ type: "text", text: "Now find" }, { type: "math", latex: "dx" }, { type: "text", text: "— what is it?" }] });
  await openMissingDx(page);
  await tapMark(page);
  await expect(page.locator(`${missingDx} [data-albert-chip]`)).toBeVisible({ timeout: 15000 });
  const rect = (loc: ReturnType<Page["locator"]>) => loc.evaluate((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; });
  const find = await rect(page.locator(`${albert} [data-albert-writing] [data-ink-text]`, { hasText: /^find$/ }));
  const math = await rect(page.locator(`${albert} [data-albert-writing] [data-ink-segment="math"]`));
  const dash = await rect(page.locator(`${albert} [data-albert-writing] [data-ink-text]`, { hasText: /^—$/ }));
  // "find" and the math do not touch (the segments carry no space of their own); the dash stays tight to the math.
  expect(math.l - find.r).toBeGreaterThan(2);
  expect(dash.l - math.r).toBeLessThan(math.l - find.r);
});

test("P4.4: a formula or word too wide for the column still shows the hint", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await replyWith(page, { segments: [
    { type: "text", text: "Compare" },
    { type: "math", latex: "a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}+a_{13}+a_{14}+a_{15}+a_{16}" },
    { type: "text", text: "with Supercalifragilisticexpialidocious_and_more_unbroken_characters_here_to_overflow" }] });
  await openMissingDx(page);
  await tapMark(page);
  await expect(page.locator(`${missingDx} [data-albert-chip]`)).toBeVisible({ timeout: 15000 });
  const writing = page.locator(`${albert} [data-albert-writing]`);
  await expect(writing).toContainText("Compare");
  const svg = await page.locator(`${missingDx} svg[data-capture-ready=true]`).boundingBox();
  const box = await writing.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(svg!.x + svg!.width + 1);
  expect(pageErrors).toEqual([]);
});
