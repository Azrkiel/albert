import { expect, test, type Page } from "@playwright/test";
import { PAGE } from "../../src/lib/contracts";

async function position(page: Page, x: number, y: number) {
  return page.getByRole("img", { name: "Worksheet work surface" }).first().evaluate((svg, point) => {
    const matrix = (svg as SVGSVGElement).getScreenCTM()!;
    const client = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: client.x, y: client.y };
  }, { x, y });
}

async function draw(page: Page, from = { x: 100, y: 100 }, to = { x: 300, y: 180 }) {
  const start = await position(page, from.x, from.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const end = await position(page, to.x, to.y);
  await page.mouse.move(end.x, end.y, { steps: 8 });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/work/demo-worksheet");
  await expect(page.getByRole("img", { name: "Worksheet work surface" }).first()).toBeVisible();
  // A real pointer interaction below also proves the effect attached after hydration.
  await expect(page.locator("svg[data-capture-ready=true]").first()).toBeVisible();
});

test("draws live ink, commits one filled path, and suppresses touch scrolling", async ({ page }) => {
  await draw(page);
  await expect(page.locator("[data-live-stroke]").first()).not.toHaveAttribute("d", "");
  await page.mouse.up();
  const ink = page.locator("[data-stroke-id]");
  await expect(ink).toHaveCount(1);
  await expect(ink).toHaveAttribute("d", /^M.+Z$/);
  await expect(ink).toHaveAttribute("fill", "#1b1b1f");
  await expect(page.locator("[data-live-stroke]").first()).toHaveAttribute("d", "");
  await expect(page.getByRole("img", { name: "Worksheet work surface" }).first()).toHaveCSS("touch-action", "none");
});

test("rejects Albert starts and clips only finished ink to the student column", async ({ page }) => {
  await draw(page, { x: PAGE.albertCol.x + 30, y: 100 }, { x: 100, y: 100 });
  await page.mouse.up();
  await expect(page.locator("[data-stroke-id]")).toHaveCount(0);
  await draw(page, { x: 700, y: 100 }, { x: 950, y: 150 });
  const live = page.locator("[data-live-stroke]").first();
  expect(await live.evaluate((path) => path.closest("[clip-path]") === null)).toBe(true);
  await page.mouse.up();
  const clip = await page.locator("[data-stroke-id]").evaluate((path) => path.closest("[clip-path]")!.getAttribute("clip-path"));
  const id = clip!.slice(5, -1);
  await expect(page.locator(`[id="${id}"] rect`)).toHaveAttribute("width", String(PAGE.studentCol.w));
  const pixels = await page.getByRole("img", { name: "Worksheet work surface" }).first().evaluate(async (svg, geometry) => {
    // Measure ink clipping independently of problem text and row decorations.
    const inkOnly = svg.cloneNode(true) as SVGSVGElement;
    inkOnly.querySelector("[data-problem-decoration]")?.remove();
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(inkOnly)], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = geometry.width;
      canvas.height = (svg as SVGSVGElement).viewBox.baseVal.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let student = 0, outside = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! > 0 && data[i]! < 100) {
          if ((i / 4) % canvas.width < geometry.studentCol.w) student++;
          else outside++;
        }
      }
      return { student, outside };
    } finally { URL.revokeObjectURL(url); }
  }, PAGE);
  expect(pixels.student).toBeGreaterThan(0);
  expect(pixels.outside).toBe(0);
});

test("pointer capture finishes outside the SVG without a duplicate on lost capture", async ({ page }) => {
  await draw(page);
  await page.mouse.move(1, 1, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("[data-stroke-id]")).toHaveCount(1);
  await draw(page);
  await page.mouse.up();
  await expect(page.locator("[data-stroke-id]")).toHaveCount(2);
});

test("cancellation and unexpected capture loss terminate once and allow another stroke", async ({ page }) => {
  for (const type of ["pointercancel", "lostpointercapture"]) {
    await draw(page);
    await page.getByRole("img", { name: "Worksheet work surface" }).first().evaluate((svg, eventType) => {
      svg.dispatchEvent(new PointerEvent(eventType, { pointerId: 1, pointerType: "mouse" }));
    }, type);
    await page.mouse.up();
  }
  await expect(page.locator("[data-stroke-id]")).toHaveCount(2);
  await expect(page.locator("[data-live-stroke]").first()).toHaveAttribute("d", "");
});

test("resize preserves stored logical paths and maps subsequent ink with the new matrix", async ({ page }) => {
  await draw(page);
  await page.mouse.up();
  const first = page.locator("[data-stroke-id]").first();
  const path = await first.getAttribute("d");
  const id = await first.getAttribute("data-stroke-id");
  await page.setViewportSize({ width: 620, height: 900 });
  await expect(first).toHaveAttribute("d", path!);
  await expect(first).toHaveAttribute("data-stroke-id", id!);
  await draw(page);
  await page.mouse.up();
  const bounds = await page.locator("[data-stroke-id]").evaluateAll((paths) => paths.map((path) => {
    const box = (path as SVGGraphicsElement).getBBox();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }));
  expect(bounds).toHaveLength(2);
  for (const key of ["x", "y", "w", "h"] as const) expect(bounds[1]![key]).toBeCloseTo(bounds[0]![key], 0);
});
