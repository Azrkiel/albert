import { expect, test } from "@playwright/test";
import { HintRequestSchema } from "../../src/lib/contracts";

test("I'm stuck sends the real marked writing and cluster labels up to the current row", async ({ page }) => {
  await page.route("**/api/hint", route => route.fulfill({ contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "error", code: "model_unavailable", message: "Test response" }) + "\n" }));
  await page.goto("/work/calc2-ws3?layout=ruled");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(5);
  const problem = page.locator('section[data-problem-id="calc2-ws3/p1"]');
  const surface = problem.locator("svg[data-capture-ready=true]");
  await surface.scrollIntoViewIfNeeded();
  const points = await surface.evaluate(svg => [[120, 150], [160, 170], [120, 280], [160, 300]].map(([x, y]) => {
    const point = new DOMPoint(x, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  }));
  for (let index = 0; index < points.length; index += 2) {
    await page.mouse.move(points[index]!.x, points[index]!.y);
    await page.mouse.down();
    await page.mouse.move(points[index + 1]!.x, points[index + 1]!.y, { steps: 6 });
    await page.mouse.up();
  }
  await expect(problem.locator("path[data-stroke-id]")).toHaveCount(2);
  const sent = page.waitForRequest(request => request.url().endsWith("/api/hint") && request.method() === "POST");
  await problem.getByRole("button", { name: "I'm stuck", exact: true }).click();
  const request = HintRequestSchema.parse((await sent).postDataJSON());
  expect(request).toMatchObject({ problemId: "calc2-ws3/p1", rowId: "calc2-ws3/p1/r2", rung: 1, trigger: "manual" });
  expect(request.image.width).toBeGreaterThan(1);
  expect(request.image.height).toBeGreaterThan(1);
  expect(request.rows).toEqual([
    { rowId: "calc2-ws3/p1/r1", index: 1, clusterLabels: [1] },
    { rowId: "calc2-ws3/p1/r2", index: 2, clusterLabels: [1] },
  ]);
  const image = Buffer.from(request.image.marked, "base64");
  expect(image.readUInt32BE(16)).toBe(request.image.width);
  expect(image.readUInt32BE(20)).toBe(request.image.height);
  const blackPixels = await page.evaluate(async png => {
    const image = new Image();
    image.src = "data:image/png;base64," + png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index]! < 40 && pixels[index + 1]! < 40 && pixels[index + 2]! < 40) count++;
    }
    return count;
  }, request.image.marked);
  expect(blackPixels).toBeGreaterThan(20);
});

test("a snapshot preparation failure shows a safe note and a successful retry clears it", async ({ page }) => {
  await page.addInitScript(() => {
    const convert = OffscreenCanvas.prototype.convertToBlob;
    let fail = true;
    OffscreenCanvas.prototype.convertToBlob = function (options) {
      if (fail) { fail = false; return Promise.reject(new Error("PRIVATE_CANVAS_DETAIL")); }
      return convert.call(this, options);
    };
  });
  let requests = 0;
  await page.route("**/api/hint", route => {
    requests++;
    return route.fulfill({ contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "error", code: "model_unavailable", message: "Test response" }) + "\n" });
  });
  await page.goto("/work/calc2-ws3?layout=ruled");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(5);
  const problem = page.locator('section[data-problem-id="calc2-ws3/p1"]');
  const button = problem.getByRole("button", { name: "I'm stuck", exact: true });
  const preparationNote = page.getByRole("alert").filter({ hasText: "Could not prepare your writing for a hint." });
  await button.click();
  await expect(preparationNote).toHaveText("Could not prepare your writing for a hint. Try again.");
  expect(requests).toBe(0);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(problem.locator("[data-albert-column]")).toHaveText("Albert can't reach his notes right now. Try again.");
  expect(requests).toBe(1);
  await expect(preparationNote).toHaveCount(0);
});
