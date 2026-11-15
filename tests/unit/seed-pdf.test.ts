import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryRepo } from "../../src/lib/db/memory";
import { seedDemo } from "../../src/lib/db/seed-demo";

it("seeds Worksheet 3's recorded original for offline PDF routes without overwriting an existing original", async () => {
  const repo = new MemoryRepo();
  await seedDemo(repo);
  const original = await repo.getFile("calc2-worksheet-3");
  expect(original).not.toBeNull();
  expect(original!.bytes).toEqual(new Uint8Array(readFileSync("fixtures/github/files/synthetic/pdf/unit-3/worksheet-3.pdf")));
  const replacement = new TextEncoder().encode("replacement");
  await repo.putFile({ ...original!.meta, bytes: replacement.length }, replacement);
  await seedDemo(repo);
  expect((await repo.getFile("calc2-worksheet-3"))!.bytes).toEqual(replacement);
});
