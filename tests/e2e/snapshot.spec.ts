import { expect, test, type Page } from "@playwright/test";
import { HintRequestSchema } from "../../src/lib/contracts";

type Snap = { png: string; width: number; height: number; rows: Array<{ rowId: string; index: number; clusterLabels: number[] }> };

async function replay(page: Page, name: string, layout: "ruled" | "free") {
  await page.goto(`/work/demo?dev=1&replay=${name}&speed=instant&layout=${layout}`);
  await page.waitForFunction(() => window.__albert?.replayDone === true);
}

/** Rows of one problem with live ink, in index order, with their store clusters' labels. */
async function storeRows(page: Page, problemId: string) {
  return page.evaluate((problemId) => {
    const { state } = window.__albert!;
    const inked = new Set(state.strokes.filter((s) => s.tool === "pen" && s.erasedAt === undefined).map((s) => s.rowId));
    return state.rows.filter((r) => r.problemId === problemId && inked.has(r.id)).sort((a, b) => a.index - b.index)
      .map((r) => ({ rowId: r.id, index: r.index, clusterLabels: (state.clusters[r.id] ?? []).map((c) => c.label) }));
  }, problemId);
}

async function snapshot(page: Page, upToRowId: string, marked = true): Promise<Snap & { nonWhite: number; layout: string }> {
  return page.evaluate(async ({ upToRowId, marked }) => {
    const snap = await window.__albert!.renderSnapshot!({ upToRowId, marked });
    const image = new Image();
    image.src = `data:image/png;base64,${snap.png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) dark++;
    if (image.naturalWidth !== snap.width || image.naturalHeight !== snap.height) throw new Error("PNG size differs from reported size");
    return { ...snap, nonWhite: dark / (canvas.width * canvas.height), layout: window.__albert!.state.layout };
  }, { upToRowId, marked });
}

for (const { layout, fixture, problemId } of [
  { layout: "ruled", fixture: "sample", problemId: "demo/p1" },
  { layout: "ruled", fixture: "ac3-handwriting", problemId: "demo-worksheet/p1" },
  { layout: "free", fixture: "ac4-handwriting", problemId: "demo-worksheet/p1" },
] as const) {
  test(`P2.7-AC1 (${layout}, ${fixture}): bounds, not blank, rows match the store's clusters`, async ({ page }) => {
    await replay(page, fixture, layout);
    const rows = await storeRows(page, problemId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const snap = await snapshot(page, rows.at(-1)!.rowId);
    expect(snap.layout).toBe(layout);
    expect(Math.max(snap.width, snap.height)).toBeLessThanOrEqual(1400);
    expect(snap.nonWhite).toBeGreaterThan(0.005);
    expect(snap.rows).toEqual(rows);
    const clean = await snapshot(page, rows.at(-1)!.rowId, false);
    expect([clean.width, clean.height]).toEqual([snap.width, snap.height]);
    expect(clean.nonWhite).toBeGreaterThan(0.005);
    expect(clean.nonWhite).toBeLessThan(snap.nonWhite); // the numbers and tags add pixels
  });
}

test("P2.7-AC2: with upToRowId at row 2 of a three-row fixture the image is shorter than at row 3", async ({ page }) => {
  await replay(page, "sample", "ruled");
  const rows = await storeRows(page, "demo/p1");
  expect(rows.map((r) => r.index)).toEqual([1, 2, 3]);
  const two = await snapshot(page, rows[1]!.rowId);
  const three = await snapshot(page, rows[2]!.rowId);
  expect(two.height).toBeLessThan(three.height);
  expect(two.rows.map((r) => r.index)).toEqual([1, 2]);
  expect(three.rows.map((r) => r.index)).toEqual([1, 2, 3]);
});

test("P2.7-AC5 in the page: the dev hook's HintRequest parses", async ({ page }) => {
  await replay(page, "sample", "ruled");
  const request = await page.evaluate(() => window.__albert!.buildHintRequest!("demo/p1/r2", 1, "manual"));
  expect(HintRequestSchema.parse(request).rows.map((r) => r.index)).toEqual([1, 2]);
  expect(request.history).toEqual([]);
});

test("P2.7 dev Snapshot button opens the marked image in a new tab", async ({ page }) => {
  await replay(page, "sample", "ruled");
  const [tab] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Snapshot", exact: true }).click()]);
  await tab.waitForURL(/^blob:/);
  const size = await tab.evaluate(async () => {
    const image = document.querySelector("img")!;
    await image.decode();
    return { w: image.naturalWidth, h: image.naturalHeight };
  });
  const expected = await snapshot(page, "demo/p1/r3");
  expect(size).toEqual({ w: expected.width, h: expected.height });
});

test("P2.7 Snapshot button is absent without ?dev=1", async ({ page }) => {
  await page.goto("/work/demo?replay=sample&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  await expect(page.getByRole("button", { name: "Snapshot", exact: true })).toHaveCount(0);
});

test("P2.7 production has no Snapshot button or snapshot hook", async ({ page }) => {
  test.skip(process.env.ALBERT_E2E_PRODUCTION !== "1", "Run with ALBERT_E2E_PRODUCTION=1 after pnpm build");
  await page.goto("/work/demo?dev=1&replay=sample&speed=instant");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Snapshot", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => "__albert" in window)).toBe(false);
});
