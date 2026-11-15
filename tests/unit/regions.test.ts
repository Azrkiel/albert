import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { readPdfText } from "../../src/lib/lms/pdf";
import { regionsFromText } from "../../src/lib/lms/regions";

it("maps a rotated label through a nonzero crop origin into logical page coordinates", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.setCropBox(20, 30, 400, 600);
  page.setRotation(degrees(90));
  // Displayed point coordinates: x=70-30=40, top y=132-20-12=100.
  page.drawText("1. Solve", { x: 132, y: 70, size: 12, rotate: degrees(90), font });
  const [text] = await readPdfText(await document.save());
  expect([text!.widthPt, text!.heightPt]).toEqual([600, 400]);
  const [region] = regionsFromText(text!.items, ["1"], text!);
  expect(region).toMatchObject({ label: "1", page: 1 });
  expect(region!.bbox.x).toBe(0);
  expect(region!.bbox.w).toBe(1200);
  expect(region!.bbox.y).toBeCloseTo(200);
  expect(region!.bbox.h).toBeCloseTo(600);
}, 30000);

it("R2.1-AC1: synthetic Worksheet 3 yields five ordered problems on their source pages", async () => {
  const bytes = new Uint8Array(readFileSync("fixtures/github/files/synthetic/pdf/unit-3/worksheet-3.pdf"));
  const pages = await readPdfText(bytes);
  const regions = pages.flatMap(p => regionsFromText(p.items, ["1", "2", "3", "4", "5"], p));
  expect(regions.map(r => [r.label, r.page])).toEqual([["1", 1], ["2", 1], ["3", 1], ["4", 2], ["5", 2]]);
  for (const region of regions) {
    expect(region.bbox.x).toBe(0);
    expect(region.bbox.w).toBe(1200);
    expect(region.bbox.y).toBeGreaterThan(0);
    expect(region.bbox.h).toBeGreaterThan(0);
    expect(region.bbox.y + region.bbox.h).toBeLessThanOrEqual(1200 * 792 / 612 + 0.001);
  }
  expect(regions[0]!.bbox.y + regions[0]!.bbox.h).toBeCloseTo(regions[1]!.bbox.y);
  expect(regions[2]!.bbox.y + regions[2]!.bbox.h).toBeCloseTo(1200 * 792 / 612);
}, 30000);

const size = { page: 2, widthPt: 600, heightPt: 800 };
const item = (str: string, x: number, y: number) => ({ str, x, y, width: 50, height: 12 });
it("recognises label forms at the left margin, orders by position, and scales to logical coordinates", () => {
  expect(regionsFromText([
    item("Problem 3", 40, 500), item("2) integrate", 40, 300), item("1. Find x", 40, 100),
    item("1. inline decoy", 250, 50), item("Problem 31", 40, 20), item("2", 40, 780),
  ], ["1", "2", "3"], size)).toEqual([
    { label: "1", page: 2, bbox: { x: 0, y: 200, w: 1200, h: 400 } },
    { label: "2", page: 2, bbox: { x: 0, y: 600, w: 1200, h: 400 } },
    { label: "3", page: 2, bbox: { x: 0, y: 1000, w: 1200, h: 600 } },
  ]);
});

it("R2.1-AC1: pages without recognised labels return no regions for the picker fallback", () => {
  expect(regionsFromText([item("Worksheet 3", 40, 20), item("No numbered exercises", 40, 60)], ["1", "2"], size)).toEqual([]);
  expect(regionsFromText([], ["1"], size)).toEqual([]);
});

it("treats label characters literally and keeps only the first occurrence of a label", () => {
  const result = regionsFromText([item("1a) one", 40, 100), item("1a) repeated reference", 40, 200), item("1aX) false", 40, 50)], ["1a"], size);
  expect(result).toEqual([{ label: "1a", page: 2, bbox: { x: 0, y: 200, w: 1200, h: 1400 } }]);
});
