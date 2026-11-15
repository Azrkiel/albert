import { expect, it, vi } from "vitest";
import { MemoryRepo } from "../../src/lib/db/memory";
import { WorksheetSchema } from "../../src/lib/contracts";
import { examples } from "./contracts.examples";
const repo = new MemoryRepo();
vi.mock("../../src/lib/db", () => ({ getRepo: () => repo }));
const { GET } = await import("../../src/app/api/worksheet/[worksheetId]/route");
const call = (id: string) => GET(new Request(`http://localhost/api/worksheet/${id}`), { params: Promise.resolve({ worksheetId: id }) });

it("serves a stored worksheet as the Worksheet contract", async () => {
  const worksheet = WorksheetSchema.parse(examples.Worksheet.valid);
  await repo.upsertWorksheet(worksheet);
  const response = await call(worksheet.id);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(WorksheetSchema.parse(await response.json())).toEqual(worksheet);
});

it("404s an unknown worksheet", async () => {
  const response = await call("missing");
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: "not_found" });
});
