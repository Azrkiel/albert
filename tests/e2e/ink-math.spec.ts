import { expect, test, type Page } from "@playwright/test";

const RED = "rgb(200, 50, 30)"; // INK.albert #c8321e
const FORMULA = String.raw`\frac{dx}{d\theta} = 4\cos\theta`;

async function openWork(page: Page) {
  await page.goto("/work/calc2-ws3");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(5);
  await page.waitForFunction(() => window.__albert?.mathReady === true, null, { timeout: 15000 });
}

test("P4.2-AC3: MathJax is ready within 3 s of page load", async ({ page }) => {
  // Warm-up visit: the dev server compiles the route and the MathJax chunk on first request.
  await openWork(page);
  await page.reload({ waitUntil: "load" });
  const readyAt = await page.waitForFunction(() => window.__albert?.mathReady === true && performance.now(), null, { timeout: 3000 });
  const loadEnd = await page.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).loadEventEnd);
  const ready = Number(await readyAt.jsonValue());
  test.info().annotations.push({ type: "mathReady", description: `${Math.round(ready)} ms after navigation start, load event ended at ${Math.round(loadEnd)} ms` });
  expect(ready - loadEnd).toBeLessThanOrEqual(3000);
});

test("P4.2-AC1: mathToSvg renders the formula as paths nested in the page's SVG", async ({ page }) => {
  await openWork(page);
  const result = await page.evaluate(async (latex) => {
    const hook = window.__albert!;
    const math = await hook.mathToSvg!(latex, 26);
    const again = await hook.mathToSvg!(latex, 26);
    const surface = document.querySelector("svg[data-capture-ready]")!;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-ink-test", "");
    group.setAttribute("transform", "translate(806 200)");
    group.append(math.node);
    surface.append(group);
    const first = math.node.querySelector("path")!;
    return {
      paths: group.querySelectorAll("path").length, glyphPaths: math.glyphPaths.length, w: math.w, h: math.h,
      fallback: math.fallback, nested: math.node.ownerSVGElement === surface,
      attrs: ["width", "height", "x", "y"].map((name) => math.node.getAttribute(name)),
      fill: getComputedStyle(first).fill, renderedWidth: math.node.getBoundingClientRect().width,
      cachedCopy: again.node !== math.node && again.w === math.w && again.glyphPaths.length === math.glyphPaths.length,
    };
  }, FORMULA);
  expect(result.fallback).toBe(false);
  expect(result.paths).toBeGreaterThanOrEqual(8);
  expect(result.glyphPaths).toBe(result.paths);
  expect(result.w).toBeGreaterThanOrEqual(60);
  expect(result.w).toBeLessThanOrEqual(400);
  expect(result.h).toBeGreaterThan(0);
  expect(result.nested).toBe(true);
  expect(result.attrs).toEqual([String(result.w), String(result.h), "0", "0"]);
  expect(result.fill).toBe(RED);
  expect(result.renderedWidth).toBeGreaterThan(0);
  expect(result.cachedCopy).toBe(true);
});

test("P4.2-AC2: a text segment is SVG text in the handwriting font, filled red", async ({ page }) => {
  await openWork(page);
  const result = await page.evaluate(async () => {
    const hook = window.__albert!;
    const { node, w, h } = await hook.renderSegment!({ type: "text", text: "What does dx become?" }, 26);
    node.setAttribute("transform", "translate(806 200)");
    document.querySelector("svg[data-capture-ready]")!.append(node);
    const text = node.querySelector("text")!;
    const style = getComputedStyle(text);
    return { tag: text.tagName, fontFamily: style.fontFamily, fill: style.fill, w, h, length: text.getComputedTextLength(),
      fontLoaded: document.fonts.check('26px "Albert Hand"'),
      faces: Array.from(document.fonts).filter((face) => face.family.includes("Albert Hand")).map((face) => face.status) };
  });
  expect(result.tag).toBe("text");
  expect(result.fontFamily).toContain("Albert Hand");
  expect(result.fill).toBe(RED);
  expect(result.faces).toContain("loaded");
  expect(result.fontLoaded).toBe(true);
  // The hidden measurer (unscaled) must agree with the scaled page within 1 px, or layout misplaces words.
  expect(Math.abs(result.w - result.length)).toBeLessThan(1);
  expect(result.w).toBeGreaterThan(100);
  expect(result.h).toBeGreaterThan(0);
});

test("P4.2-AC4: bad LaTeX degrades to plain hand text instead of dropping the hint", async ({ page }) => {
  await openWork(page);
  const result = await page.evaluate(async () => {
    const hook = window.__albert!;
    const math = await hook.mathToSvg!(String.raw`\frac{`, 26);
    const segment = await hook.renderSegment!({ type: "math", latex: String.raw`\frac{` }, 26);
    const text = math.node.querySelector("text");
    return { fallback: math.fallback, paths: math.node.querySelectorAll("path").length, text: text?.textContent,
      font: text?.getAttribute("font-family"), fill: text?.getAttribute("fill"), w: math.w,
      segmentText: segment.node.querySelector("text")?.textContent, segmentGlyphs: segment.glyphs };
  });
  expect(result).toMatchObject({ fallback: true, paths: 0, text: String.raw`\frac{`, fill: "#c8321e", segmentText: String.raw`\frac{` });
  expect(result.font).toContain("Albert Hand");
  expect(result.w).toBeGreaterThan(0);
  expect(result.segmentGlyphs).toBeGreaterThan(0);
});

test("revealWipe grows a clip from 0 to the element's width, then removes it", async ({ page }) => {
  await openWork(page);
  const result = await page.evaluate(async () => {
    const hook = window.__albert!;
    const { node } = await hook.renderSegment!({ type: "text", text: "Check the differential." }, 26);
    node.setAttribute("transform", "translate(806 300)");
    document.querySelector("svg[data-capture-ready]")!.append(node);
    const done = hook.revealWipe!(node, 400);
    const rect = () => node.querySelector("clipPath rect");
    const startWidth = Number(rect()?.getAttribute("width"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const midWidth = Number(rect()?.getAttribute("width"));
    await done;
    return { startWidth, midWidth, full: node.getBBox().width, clipped: node.hasAttribute("clip-path"), left: node.querySelectorAll("clipPath").length };
  });
  expect(result.startWidth).toBe(0);
  expect(result.midWidth).toBeGreaterThan(0);
  expect(result.midWidth).toBeLessThan(result.full);
  expect(result).toMatchObject({ clipped: false, left: 0 });
});

test("production: P4.2 dev hooks are absent but the handwriting font still loads", async ({ page }) => {
  test.skip(process.env.ALBERT_E2E_PRODUCTION !== "1", "Run with ALBERT_E2E_PRODUCTION=1 after pnpm build");
  await page.goto("/work/calc2-ws3");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(5);
  expect(await page.evaluate(() => "__albert" in window)).toBe(false);
  await page.waitForFunction(() => document.fonts.check('26px "Albert Hand"'), null, { timeout: 5000 });
});
