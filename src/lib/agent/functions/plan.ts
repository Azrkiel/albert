import { StudyPlanSchema, type StudyPlan, type TeachingCard, type Worksheet } from "../../contracts";

export type PlanCourse = { cards: readonly TeachingCard[]; worksheets: readonly Worksheet[]; evidenceIds: Iterable<string> };

export const DEFAULT_PLAN_MAX_MINUTES = 60;
const DAY_MS = 86_400_000;

export function planMaxMinutesPerDay(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.PLAN_MAX_MINUTES_PER_DAY);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PLAN_MAX_MINUTES;
}

/** The five rules of contracts section 8. Pure: returns problems (empty when the plan is valid). */
export function validatePlan(plan: StudyPlan, course: PlanCourse, maxMinutesPerDay = DEFAULT_PLAN_MAX_MINUTES): string[] {
  const parsed = StudyPlanSchema.safeParse(plan);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const problems: string[] = [];
  const worksheets = new Map(course.worksheets.map((w) => [w.id, w]));
  const subskillCard = new Map(course.cards.flatMap((c) => c.subskills.map((s) => [s.id, c] as const)));
  const cardByUnit = new Map(course.cards.map((c) => [c.unitId, c]));
  const evidence = new Set(course.evidenceIds);
  const start = Date.parse(`${plan.generatedAt.slice(0, 10)}T00:00:00Z`);
  const minutesByDay = new Map<string, number>();
  const ids = new Set<string>();
  for (const item of plan.items) {
    const at = `Item ${item.id}`;
    if (ids.has(item.id)) problems.push(`${at}: duplicate item id`);
    ids.add(item.id);
    // 1. Everything referenced exists in the course.
    const worksheet = worksheets.get(item.worksheetId);
    if (!worksheet) problems.push(`${at}: unknown worksheetId ${item.worksheetId}`);
    for (const id of item.problemIds) if (worksheet && !worksheet.problems.some((p) => p.id === id)) problems.push(`${at}: problem ${id} is not in worksheet ${item.worksheetId}`);
    for (const id of item.subskillIds) if (!subskillCard.has(id)) problems.push(`${at}: unknown subskillId ${id}`);
    // 2. The date is inside the horizon and not after the due date.
    const day = Date.parse(`${item.date}T00:00:00Z`);
    if (day < start || day >= start + plan.horizonDays * DAY_MS) problems.push(`${at}: date ${item.date} is outside the ${plan.horizonDays}-day horizon starting ${plan.generatedAt.slice(0, 10)}`);
    if (item.dueAt && day > Date.parse(item.dueAt)) problems.push(`${at}: date ${item.date} is after its due date ${item.dueAt}`);
    // 3. Day totals are checked after the loop.
    minutesByDay.set(item.date, (minutesByDay.get(item.date) ?? 0) + item.estMinutes);
    // 4. Evidence that exists, or a due date.
    for (const id of item.evidenceIds) if (!evidence.has(id)) problems.push(`${at}: unknown evidenceId ${id}`);
    if (!item.evidenceIds.some((id) => evidence.has(id)) && !item.dueAt) problems.push(`${at}: needs an existing evidenceId or a dueAt`);
    // 5. Nothing from a unit that is not taught.
    if (worksheet && cardByUnit.get(worksheet.unitId)?.taught === false) problems.push(`${at}: worksheet ${item.worksheetId} belongs to an upcoming unit`);
    for (const id of item.subskillIds) if (subskillCard.get(id)?.taught === false) problems.push(`${at}: subskill ${id} belongs to an upcoming unit`);
  }
  for (const [date, minutes] of minutesByDay) if (minutes > maxMinutesPerDay) problems.push(`${date}: ${minutes} minutes planned, more than ${maxMinutesPerDay}`);
  return problems;
}
