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
  return { cards: cards.length, worksheets: worksheets.length };
}
