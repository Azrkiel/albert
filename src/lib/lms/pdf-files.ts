import { createHash } from "node:crypto";
import { z } from "zod";
import type { Repo, Worksheet } from "../contracts";
import { CourseSourceError } from "./adapter";
import { pdfPageSizes, rasterizePdfPage, readPdfText } from "./pdf";
import { regionsFromText } from "./regions";

const sizesSchema = z.array(z.object({ page: z.number().int().positive(), widthPt: z.number().positive(), heightPt: z.number().positive() }));
const textGeometrySchema = z.array(sizesSchema.element.extend({ items: z.array(z.object({
  str: z.string(), x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative(),
})) }));
async function sourcePdf(repo: Repo, fileId: string) {
  const file = await repo.getFile(fileId);
  if (!file) throw new CourseSourceError("not_found");
  if (file.meta.mime !== "application/pdf") throw new CourseSourceError("bad_reply");
  return file;
}
function derivedKey(fileId: string, bytes: Uint8Array) {
  return `pdf-page-v1:${createHash("sha256").update(fileId).update("\0").update(bytes).digest("hex")}`;
}
async function parsePdf<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch { throw new CourseSourceError("bad_reply"); }
}

export async function filePages(repo: Repo, fileId: string) {
  const file = await sourcePdf(repo, fileId);
  const key = `${derivedKey(fileId, file.bytes)}:sizes`;
  const cached = await repo.getText(key);
  if (cached) {
    try { return sizesSchema.parse(JSON.parse(cached)); } catch { /* Regenerate a damaged derived entry. */ }
  }
  const sizes = await parsePdf(async () => sizesSchema.parse(await pdfPageSizes(file.bytes)));
  await repo.putText(key, JSON.stringify(sizes));
  return sizes;
}

export async function filePagePng(repo: Repo, fileId: string, page: string): Promise<Uint8Array> {
  const file = await sourcePdf(repo, fileId);
  const n = Number(page);
  if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(n)) throw new CourseSourceError("not_found");
  const key = `${derivedKey(fileId, file.bytes)}:${n}:1200.png`;
  const cached = await repo.getFile(key);
  if (cached) return cached.bytes;
  const png = await parsePdf(() => rasterizePdfPage(file.bytes, n));
  if (!png) throw new CourseSourceError("not_found");
  await repo.putFile({ id: key, courseId: file.meta.courseId, unitId: file.meta.unitId, title: `${file.meta.title} — page ${n}`, mime: "image/png", bytes: png.length, kind: "other" }, png);
  return png;
}

async function textGeometry(repo: Repo, fileId: string, bytes: Uint8Array) {
  const key = `${derivedKey(fileId, bytes)}:text-geometry-v1`;
  const cached = await repo.getText(key);
  if (cached) {
    try { return textGeometrySchema.parse(JSON.parse(cached)); } catch { /* Regenerate a damaged derived entry. */ }
  }
  const pages = await parsePdf(async () => textGeometrySchema.parse(await readPdfText(bytes)));
  await repo.putText(key, JSON.stringify(pages));
  return pages;
}

/** Derived positions enrich a response without letting PDF layout overwrite validated course content. */
export async function worksheetWithRegions(repo: Repo, worksheet: Worksheet): Promise<Worksheet> {
  const problems = worksheet.problems.map(({ region, ...problem }) => { void region; return problem; });
  const file = await repo.getFile(worksheet.fileId);
  if (!file || file.meta.mime !== "application/pdf") return { ...worksheet, problems };
  const pages = await textGeometry(repo, worksheet.fileId, file.bytes);
  const regions = pages.flatMap(page => regionsFromText(page.items, problems.filter(p => p.page === page.page).map(p => p.label), page));
  return { ...worksheet, problems: problems.map(problem => {
    const match = regions.find(region => region.page === problem.page && region.label === problem.label);
    if (!match) return problem;
    return { ...problem, region: { page: match.page, bbox: match.bbox } };
  }) };
}
