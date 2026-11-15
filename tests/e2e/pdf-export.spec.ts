import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";
import { readPdfText } from "../../src/lib/lms/pdf";
import { geometryOf, pageTransform } from "../../src/lib/ink/pdf-export";

test.setTimeout(60000);

test.beforeEach(async ({ request }) => {
  for (let n = 0; n < 200; n++) {
    const response = await request.get("/api/session/latest?worksheetId=calc2-ws3");
    if (response.status() === 404) return;
    expect(response.ok()).toBe(true);
    const { session } = await response.json();
    expect((await request.post(`/api/session/${session.id}/end`)).ok()).toBe(true);
  }
  throw new Error("Too many open test sessions");
});
async function open(page: Page) {
  const metadata = page.waitForResponse(r => r.url().endsWith("/api/files/calc2-worksheet-3/pages"));
  await page.goto("/work/calc2-ws3");
  expect((await metadata).ok()).toBe(true);
  await expect(page.locator("svg[data-capture-ready=true][data-page]")).toHaveCount(2);
}
async function draw(page: Page, n: number, y: number) {
  const svg = page.locator(`svg[data-capture-ready=true][data-page="${n}"]`);
  await svg.evaluate((svg, y) => { const p = new DOMPoint(0, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!); window.scrollBy(0, p.y - innerHeight / 2); }, y);
  const points = await svg.evaluate((svg, y) => [new DOMPoint(1100, y), new DOMPoint(1150, y + 20)].map(p => {
    const c = p.matrixTransform((svg as SVGSVGElement).getScreenCTM()!); return { x: c.x, y: c.y };
  }), y);
  await page.mouse.move(points[0]!.x, points[0]!.y); await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 4 }); await page.mouse.up();
}
function annotations(doc: PDFDocument, index: number) { return (doc.getPage(index).node.Annots()?.asArray() ?? []).map(ref => doc.context.lookup(ref, PDFDict)); }
async function save(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("Worksheet 3 — annotated.pdf");
  const bytes = new Uint8Array(await readFile((await download.path())!));
  return { doc: await PDFDocument.load(bytes), bytes };
}

test("R2.4: Save PDF preserves originals and adds editable ink on pages 1 and 2", async ({ page, request }) => {
  await open(page);
  await draw(page, 1, 400); await draw(page, 2, 240);
  const strokes = await page.evaluate(() => window.__albert!.state.strokes);
  const original = await PDFDocument.load(await (await request.get("/api/files/calc2-worksheet-3")).body());
  const { doc } = await save(page);
  expect(doc.getPageCount()).toBe(original.getPageCount());
  for (const index of [0, 1]) {
    expect(geometryOf(doc.getPage(index))).toEqual(geometryOf(original.getPage(index)));
    expect(annotations(doc, index).length).toBeGreaterThan(annotations(original, index).length);
    const ink = annotations(doc, index).find(a => a.get(PDFName.of("Subtype")) === PDFName.of("Ink"))!;
    expect(ink).toBeDefined();
    expect((ink.get(PDFName.of("NM")) as PDFString).decodeText()).toBe(strokes[index]!.id);
    const coords = ink.lookup(PDFName.of("InkList"), PDFArray).lookup(0, PDFArray).asArray().map(v => (v as PDFNumber).asNumber());
    const expected = strokes[index]!.points.flatMap(p => { const q = pageTransform(geometryOf(original.getPage(index))).toPdf(p.x, p.y); return [q.x, q.y]; });
    coords.forEach((n, i) => expect(n).toBeCloseTo(expected[i]!));
    expect(ink.has(PDFName.of("AP"))).toBe(true);
  }
});

test("R2.4: helper text/math remain visible on a labelled note page, with original pages intact", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/hint", route => {
    const rowId = route.request().postDataJSON().rows[0].rowId;
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "started", hintId: "pdf-export-hint", at: 0 },
      { type: "mark", mark: { type: "circle", rowId, clusterIds: [`${rowId}/c1`] } },
      { type: "hint", kind: "question", segments: [{ type: "text", text: "Use" }, { type: "math", latex: "\\frac{dx}{d\\theta}" }, { type: "text", text: "from your substitution." }], citation: { unitId: "calc2-u3", label: "Lecture 9, Step 2" } },
      { type: "done", hintId: "pdf-export-hint", ms: { firstEvent: 1, total: 2 } },
    ].map(e => JSON.stringify(e) + "\n").join("") });
  });
  // Work near the foot of page 2 leaves no room under it, so the note falls back to a labelled note page.
  await open(page); await draw(page, 2, 1440);
  const block = page.locator('[data-pdf-page="2"]');
  await block.getByRole("button", { name: "I'm stuck", exact: true }).click();
  await expect(block.locator("[data-albert-writing] svg[data-ink-math] path").first()).toBeAttached();
  await expect(block.locator("[data-albert-chip]")).toBeAttached();
  const original = await PDFDocument.load(await (await request.get("/api/files/calc2-worksheet-3")).body());
  const { doc, bytes } = await save(page);
  expect(doc.getPageCount()).toBe(3);
  for (const i of [0, 1]) expect(geometryOf(doc.getPage(i))).toEqual(geometryOf(original.getPage(i)));
  expect(annotations(doc, 1)).toHaveLength(1);
  const content = doc.getPage(2).node.Contents() as PDFArray;
  const streams = content.asArray().map(ref => doc.context.lookup(ref)).filter((s): s is PDFRawStream => s instanceof PDFRawStream);
  const commands = streams.map(s => new TextDecoder().decode(decodePDFRawStream(s).decode())).join("\n");
  expect(commands).toContain("Tj"); // Embedded hand-font text, including the source-page label and citation.
  expect(commands).toMatch(/\b[mc]\b/); // MathJax glyph paths, not an image of the note.
  expect(doc.getPage(2).getSize()).toEqual({ width: 612, height: 792 });
  const noteText = (await readPdfText(bytes))[2]!.items.map(item => item.str).join(" ");
  expect(noteText).toContain("Albert notes for page 2");
  expect(noteText).toContain("Lecture 9, Step 2");
});

test("R2.4: drawing during export setup is included in the consistent download snapshot", async ({ page }) => {
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { seen = resolve; });
  await page.route("**/*pdf-export-dom*.js", async route => { seen(); await held; await route.continue(); });
  await open(page); await draw(page, 1, 400);
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  await requested;
  await draw(page, 2, 240);
  release();
  const download = await waiting;
  const doc = await PDFDocument.load(await readFile((await download.path())!));
  expect(annotations(doc, 0)).toHaveLength(1);
  expect(annotations(doc, 1)).toHaveLength(1);
});

test("R2.4: a failed download leaves ink usable and Save PDF can be retried", async ({ page }) => {
  let fail = true;
  await page.route("**/api/files/calc2-worksheet-3", route => {
    if (fail) { fail = false; return route.fulfill({ status: 503, body: "unavailable" }); }
    return route.continue();
  });
  await open(page); await draw(page, 1, 400);
  const first = await page.evaluate(() => window.__albert!.state.strokes[0]);
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not save the PDF" })).toBeVisible();
  expect(await page.evaluate(() => window.__albert!.state.strokes[0])).toEqual(first);
  await draw(page, 2, 240);
  const { doc } = await save(page);
  expect(annotations(doc, 0)).toHaveLength(1);
  expect(annotations(doc, 1)).toHaveLength(1);
});
