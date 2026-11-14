import { ScopeBundleSchema, type ScopeBundle, type TeachingCard, type Worksheet } from "../contracts";
import { getRepo, type Repo } from "../db";

export class ScopeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeNotFoundError";
  }
}

/**
 * Pure form of the scope rule (contracts.md section 6, D10). For a worksheet in unit n,
 * taught units with order <= n are covered; units with order > n are upcoming and
 * contribute method names only. The card is the worksheet's own unit, in full.
 */
export function buildScopeBundle(worksheet: Worksheet, problemId: string, cards: TeachingCard[]): ScopeBundle {
  const problem = worksheet.problems.find((p) => p.id === problemId);
  if (!problem) throw new ScopeNotFoundError(`Problem not found: ${worksheet.id}/${problemId}`);
  const card = cards.find((c) => c.unitId === worksheet.unitId);
  if (!card) throw new ScopeNotFoundError(`No teaching card for unit ${worksheet.unitId}`);

  const ordered = [...cards].sort((a, b) => a.order - b.order || a.unitId.localeCompare(b.unitId));
  const covered = ordered.filter((c) => c.order <= card.order && c.taught);
  const upcoming = ordered.filter((c) => c.order > card.order);

  const notation = new Map<string, TeachingCard["notation"][number]>();
  for (const c of covered) for (const entry of c.notation) notation.set(entry.concept, entry); // latest unit wins

  return ScopeBundleSchema.parse({
    worksheetId: worksheet.id,
    problemId,
    problem,
    card,
    taught: card.taught,
    coveredMethods: covered.flatMap((c) => c.methods.map((m) => ({ id: m.id, name: m.name, unitId: c.unitId, summary: m.summary }))),
    upcomingMethods: upcoming.flatMap((c) => c.methods.map((m) => ({ name: m.name, unitId: c.unitId, unitTitle: c.title }))),
    notation: [...notation.values()],
  });
}

export async function getScopeBundle(worksheetId: string, problemId: string, repo: Repo = getRepo()): Promise<ScopeBundle> {
  const worksheet = await repo.getWorksheet(worksheetId);
  if (!worksheet) throw new ScopeNotFoundError(`Worksheet not found: ${worksheetId}`);
  return buildScopeBundle(worksheet, problemId, await repo.listCards(worksheet.courseId));
}
