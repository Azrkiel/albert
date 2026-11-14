import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET } from "../../src/app/api/scope/[worksheetId]/route";
import { ScopeBundleSchema, TeachingCardSchema, WorksheetSchema, type TeachingCard, type Worksheet } from "../../src/lib/contracts";
import { getRepo, MemoryRepo, seedDemo } from "../../src/lib/db";
import { getScopeBundle, ScopeNotFoundError } from "../../src/lib/tutor";

const card = (n: number) => TeachingCardSchema.parse(JSON.parse(readFileSync(`fixtures/cards/calc2-u${n}.json`, "utf8")));
const worksheet = (id: string) => WorksheetSchema.parse(JSON.parse(readFileSync(`fixtures/worksheets/${id}.json`, "utf8")));
const cards = [1, 2, 3, 4].map(card);
const U = (n: number): TeachingCard => cards[n - 1] as TeachingCard;
async function seeded() {
  const repo = new MemoryRepo();
  await seedDemo(repo);
  return repo;
}

describe("P3.2-AC2 the scope rule", () => {
  it("covers units 1 to 3 and lists unit 4 by name only", async () => {
    const b = await getScopeBundle("calc2-ws3", "calc2-ws3/p1", await seeded());
    ScopeBundleSchema.parse(b);
    expect(b.taught).toBe(true);
    expect(b.card.unitId).toBe("calc2/u3");
    expect(new Set(b.coveredMethods.map((m) => m.unitId))).toEqual(new Set(["calc2/u1", "calc2/u2", "calc2/u3"]));
    for (const unit of [1, 2, 3]) for (const m of U(unit).methods) expect(b.coveredMethods.map((x) => x.id)).toContain(m.id);
    for (const m of U(4).methods) expect(b.coveredMethods.map((x) => x.id)).not.toContain(m.id);
    expect(b.upcomingMethods).toEqual([{ name: "Partial fractions", unitId: "calc2/u4", unitTitle: "Partial Fractions" }]);
    expect(Object.keys(b.upcomingMethods[0] ?? {}).sort()).toEqual(["name", "unitId", "unitTitle"]);
    expect(JSON.stringify(b)).not.toContain("u4.partial_fractions");
  });

  it("notation prefers unit 3 where units 1 and 3 define the same concept", async () => {
    const shared = U(1).notation.map((n) => n.concept).filter((c) => U(3).notation.some((n) => n.concept === c));
    expect(shared.length).toBeGreaterThan(0);
    const b = await getScopeBundle("calc2-ws3", "calc2-ws3/p4", await seeded());
    for (const concept of shared) {
      const entries = b.notation.filter((n) => n.concept === concept);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(U(3).notation.find((n) => n.concept === concept));
      expect(entries[0]).not.toEqual(U(1).notation.find((n) => n.concept === concept));
    }
    expect(b.notation.some((n) => n.concept === "integration by parts rule")).toBe(true);
  });

  it("a unit-1 worksheet sees nothing from later units except their names", async () => {
    const b = await getScopeBundle("calc2-ws1", "calc2-ws1/p1", await seeded());
    expect(b.coveredMethods.every((m) => m.unitId === "calc2/u1")).toBe(true);
    expect(b.upcomingMethods.map((m) => m.unitId)).toEqual(["calc2/u2", "calc2/u2", "calc2/u3", "calc2/u3", "calc2/u4"]);
  });

  it("an untaught own unit is flagged and contributes no covered methods", async () => {
    const repo = await seeded();
    await repo.upsertWorksheet({ ...worksheet("calc2-ws3"), id: "calc2-ws4", unitId: "calc2/u4", problems: [{ ...(worksheet("calc2-ws3").problems[0] as Worksheet["problems"][number]), id: "calc2-ws4/p1", subskillIds: ["u4.factor_denominator"] }] });
    const b = await getScopeBundle("calc2-ws4", "calc2-ws4/p1", repo);
    expect(b.taught).toBe(false);
    expect(b.coveredMethods.map((m) => m.unitId)).not.toContain("calc2/u4");
  });

  it("rejects unknown worksheets and problems", async () => {
    const repo = await seeded();
    await expect(getScopeBundle("nope", "nope/p1", repo)).rejects.toBeInstanceOf(ScopeNotFoundError);
    await expect(getScopeBundle("calc2-ws3", "calc2-ws3/p9", repo)).rejects.toBeInstanceOf(ScopeNotFoundError);
  });
});

describe("P3.2-AC3 problem subskills belong to covered units", () => {
  it.each(["calc2-ws1", "calc2-ws3"])("%s", (id) => {
    const ws = worksheet(id);
    const unit = cards.find((c: TeachingCard) => c.unitId === ws.unitId)!;
    const allowed = new Set(cards.filter((c) => c.order <= unit.order).flatMap((c) => c.subskills.map((s) => s.id)));
    const methods = new Set(cards.filter((c) => c.order <= unit.order).flatMap((c) => c.methods.map((m) => m.id)));
    for (const p of ws.problems) {
      expect(p.id.startsWith(`${ws.id}/p`)).toBe(true);
      for (const s of p.subskillIds) expect(allowed.has(s), `${p.id}: ${s}`).toBe(true);
      for (const m of p.methodIds) expect(methods.has(m), `${p.id}: ${m}`).toBe(true);
    }
  });

  it("fixtures: worksheet 3 has five problems (p1 is the missing-dx problem) and worksheet 1 has integration by parts", () => {
    expect(worksheet("calc2-ws3").problems.map((p) => p.id)).toEqual([1, 2, 3, 4, 5].map((n) => `calc2-ws3/p${n}`));
    expect(worksheet("calc2-ws3").problems[0]?.statementLatex).toContain(String.raw`\frac{dx}{x^2\sqrt{16-x^2}}`);
    expect(worksheet("calc2-ws1").problems.some((p) => p.methodIds.includes("u1.ibp"))).toBe(true);
  });

  it("unit 3 card is complete", () => {
    const u3 = U(3);
    expect(u3.builtBy).toBe("hand");
    expect(u3.methods[0]?.steps).toHaveLength(5);
    expect(u3.workedExamples.length).toBeGreaterThanOrEqual(2);
    expect(u3.workedExamples.map((e) => e.label)).toContain("Lecture 9, Example 2");
    expect(u3.pitfalls.some((p) => p.errorType === "missing_dx")).toBe(true);
    expect(cards.map((c) => c.builtBy)).toEqual(["hand", "hand", "hand", "hand"]);
  });
});

describe("seeding and the route", () => {
  it("seedDemo loads every fixture card and worksheet", async () => {
    const repo = new MemoryRepo();
    expect(await seedDemo(repo)).toEqual({ cards: 4, worksheets: 2 });
    expect((await repo.listCards("calc2")).map((c) => c.unitId)).toEqual(["calc2/u1", "calc2/u2", "calc2/u3", "calc2/u4"]);
    expect(await repo.getWorksheet("calc2-ws3")).not.toBeNull();
  });

  it("pnpm seed:demo with STORE=memory loads them", () => {
    const out = execFileSync("npx", ["tsx", "scripts/seed-demo.ts"], { env: { ...process.env, STORE: "memory" }, encoding: "utf8", shell: true });
    expect(out).toContain("loaded 4 cards and 2 worksheets");
  }, 30_000);

  it("GET /api/scope/[worksheetId] returns the bundle, 400 without problemId, 404 for unknown", async () => {
    process.env.STORE = "memory";
    await seedDemo(getRepo());
    const call = (path: string, id: string) => GET(new Request(`http://localhost/api/scope/${id}${path}`), { params: Promise.resolve({ worksheetId: id }) });
    const ok = await call("?problemId=calc2-ws3%2Fp1", "calc2-ws3");
    expect(ok.status).toBe(200);
    const body = ScopeBundleSchema.parse(await ok.json());
    expect(body.problem.id).toBe("calc2-ws3/p1");
    expect((await call("", "calc2-ws3")).status).toBe(400);
    expect((await call("?problemId=calc2-ws3%2Fp9", "calc2-ws3")).status).toBe(404);
    expect((await call("?problemId=x", "nope")).status).toBe(404);
  });
});
