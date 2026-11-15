import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TeachingCardSchema, WorksheetSchema } from "../contracts";
import type { Repo } from "./repo";

/** Loads fixtures/cards and fixtures/worksheets (validated) into the store. Returns the counts. */
export async function seedDemo(repo: Repo, root = join(process.cwd(), "fixtures")): Promise<{ cards: number; worksheets: number }> {
  const read = async (dir: string) => {
    const names = (await readdir(join(/*turbopackIgnore: true*/ root, dir))).filter((n) => n.endsWith(".json")).sort();
    return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(/*turbopackIgnore: true*/ root, dir, n), "utf8")) as unknown));
  };
  const cards = (await read("cards")).map((c) => TeachingCardSchema.parse(c));
  const worksheets = (await read("worksheets")).map((w) => WorksheetSchema.parse(w));
  for (const c of cards) await repo.upsertCard(c);
  for (const w of worksheets) await repo.upsertWorksheet(w);
  // The recorded original makes the offline demo exercise the real PDF routes too.
  const worksheet3 = worksheets.find(w => w.id === "calc2-ws3" && w.fileId === "calc2-worksheet-3");
  if (worksheet3 && !await repo.getFile(worksheet3.fileId)) {
    let bytes: Uint8Array | null;
    try { bytes = new Uint8Array(await readFile(join(/*turbopackIgnore: true*/ root, "github/files/synthetic/pdf/unit-3/worksheet-3.pdf"))); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      bytes = null; // Custom fixture roots may intentionally have no original.
    }
    if (bytes) await repo.putFile({ id: worksheet3.fileId, courseId: worksheet3.courseId, unitId: worksheet3.unitId,
      title: worksheet3.title, mime: "application/pdf", bytes: bytes.length, kind: "worksheet" }, bytes);
  }
  return { cards: cards.length, worksheets: worksheets.length };
}
