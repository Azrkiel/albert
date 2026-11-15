import type { AlbertMarkSpec, AlbertReply, Diagnose, HintRequest, Mark, Rung, ScopeBundle, WriteHint } from "../contracts";

export function hintText(hint: WriteHint): string {
  return hint.segments.map((segment) => segment.type === "text" ? segment.text : segment.type === "math" ? segment.latex : "\n").join("");
}

export function checkLadder(hint: WriteHint, diagnose: Diagnose, rung: Rung): string[] {
  if (diagnose.status === "unreadable") return []; // reread overrides the ladder
  const errors: string[] = [];
  const text = hintText(hint).trim();
  const words = text ? text.split(/\s+/u).length : 0;
  const math = hint.segments.filter((segment) => segment.type === "math");
  if (rung === 1) {
    if (!["question", "nudge"].includes(hint.kind)) errors.push("Rung 1 kind must be question or nudge.");
    if (!text.endsWith("?")) errors.push("Rung 1 must end with a question mark (?).");
    if (words > 18) errors.push(`Rung 1 must use at most 18 words; you used ${words}. Ask a shorter question without the fix.`);
    if (math.length > 2) errors.push(`Rung 1 permits at most two short math segments; you used ${math.length}. Keep at most two and write every other symbol in words inside a text segment (for example "d theta").`);
    if (math.some((segment) => segment.latex.includes("="))) errors.push("Rung 1 must not contain = in a math segment: ask about the step, never write it. Refer to the student's own line by its row (R2) instead of copying an equation.");
  } else if (rung === 2) {
    if (hint.kind !== "next_step") errors.push("Rung 2 kind must be next_step: name the next step without performing it.");
    if (words > 24) errors.push(`Rung 2 must use at most 24 words; you used ${words}.`);
    if (math.some((segment) => segment.latex.includes("="))) errors.push("Rung 2 must not contain = in a math segment; name the step in words without carrying it out.");
  } else {
    if (hint.kind !== "worked_step") errors.push("Rung 3 kind must be worked_step.");
    if (math.length > 2) errors.push("Rung 3 permits at most two math segments: show only one worked step.");
  }
  return errors;
}

export function checkScope(hint: WriteHint, diagnose: Diagnose, scope: ScopeBundle): string[] {
  const errors: string[] = [];
  if (diagnose.subskillId !== undefined && !scope.card.subskills.some((skill) => skill.id === diagnose.subskillId)) {
    errors.push(`Unknown subskillId ${diagnose.subskillId}; use a subskill id from the scope bundle or omit it.`);
  }
  // Check each clause containing a name: a deferral elsewhere cannot license using it.
  const clauses = hintText(hint).toLowerCase().split(/[.!?;,\n]+|\b(?:but|then|so|and)\b/u);
  for (const method of scope.upcomingMethods) {
    if (clauses.some((clause) => clause.includes(method.name.toLowerCase()) && !(
      /\b(?:later|upcoming|not yet|will (?:learn|meet|cover)|(?:learn|meet|cover)\b.*\bunit|(?:comes|arrives|taught|covered)\b.*\bunit)/u.test(clause)
      && !/\b(?:use|apply|decompose|split|solve|calculate|compute)\b/u.test(clause)
    ))) errors.push(`${method.name} is upcoming (${method.unitId}); mention it only in a sentence deferring it to its unit, and guide with a covered method.`);
  }
  return errors;
}

export function checkUnreadable(hint: WriteHint, diagnose: Diagnose, marks: Mark[]): string[] {
  if (diagnose.status !== "unreadable") return [];
  return [
    ...(hint.kind === "reread" ? [] : ["Unreadable work requires hint kind reread."]),
    ...(marks.length === 0 ? [] : ["Unreadable work must have no marks."]),
  ];
}

export function checkPointing(reply: AlbertReply, rows: HintRequest["rows"]): string[] {
  const indexes = new Set(rows.map((row) => row.index));
  const referenced = [
    ...reply.reading.rows.map((row) => row.index),
    ...(reply.diagnosis.rowIndex === undefined ? [] : [reply.diagnosis.rowIndex]),
    ...reply.marks.map((mark) => mark.type === "arrow" ? mark.toRowIndex : mark.rowIndex),
  ];
  const marked = new Set(reply.marks.map((mark) => mark.type === "arrow" ? mark.toRowIndex : mark.rowIndex));
  return [
    ...[...new Set(referenced)].filter((index) => !indexes.has(index))
      .map((index) => `Unknown row R${index}; use only the row numbers supplied in the request.`),
    ...rows.filter((row) => marked.has(row.index) && row.clusterLabels.length === 0)
      .map((row) => `Row R${row.index} has no ink; point at existing ink or omit the mark.`),
  ];
}

/** Unknown cluster labels are deliberately repaired rather than retried (§4.4). */
export function targetClusterIds(row: HintRequest["rows"][number], labels: number[]): string[] {
  return [...new Set(labels)].filter((label) => row.clusterLabels.includes(label)).map((label) => `${row.rowId}/c${label}`);
}

export function mapMark(mark: Mark, rows: HintRequest["rows"]): AlbertMarkSpec {
  const row = rows.find((row) => row.index === (mark.type === "arrow" ? mark.toRowIndex : mark.rowIndex));
  if (!row) throw new Error("Validate row references before mapping marks.");
  return mark.type === "arrow"
    ? { type: "arrow", toRowId: row.rowId, toClusterIds: targetClusterIds(row, mark.toClusterLabels) }
    : { type: mark.type, rowId: row.rowId, clusterIds: targetClusterIds(row, mark.clusterLabels) };
}

export function checkReply(reply: AlbertReply, request: HintRequest, scope?: ScopeBundle): string[] {
  return [
    ...checkLadder(reply.hint, reply.diagnosis, request.rung),
    ...(request.problemSource === "handwriting" ? [
      ...(reply.diagnosis.subskillId === undefined ? [] : ["General handwriting has no course subskillId; omit it."]),
      ...(reply.diagnosis.easierOutOfScope === undefined ? [] : ["General handwriting has no upcoming course units; omit easierOutOfScope."]),
      ...(reply.hint.citation === undefined ? [] : ["No course notes were supplied; omit hint.citation."]),
    ] : scope ? checkScope(reply.hint, reply.diagnosis, scope) : ["Worksheet hints require course scope."]),
    ...checkUnreadable(reply.hint, reply.diagnosis, reply.marks),
    ...checkPointing(reply, request.rows),
  ];
}
