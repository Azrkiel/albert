import { SessionEventSchema, type SessionEvent } from "../contracts";
import { createSessionState, reduceSessionEvent, type SessionState } from "./store";
import { assignRow } from "./rows";

/** Canonical schema order makes JSON identity independent of object key order at the API boundary. */
const eventKey = (event: SessionEvent) => JSON.stringify(SessionEventSchema.parse(event));

/** Restore uses the reducer directly. It never sends events to the live sync queue. */
export function mergeRestoredEvents(state: SessionState, events: SessionEvent[]): SessionState {
  const legacy = events.some(e => e.type === "stroke_end" && e.stroke.page === undefined)
    || (!events.some(e => e.type === "stroke_end" && e.stroke.page !== undefined)
      && !events.some(e => e.type === "hint_requested" && e.page !== undefined)
      && events.some(e => e.type === "stuck" || e.type === "hint_requested"));
  if (state.surface === "pdf" && !state.events.length && legacy) {
    // Older sessions did not persist a surface. Preserve their unpaged work on a legacy canvas;
    // never invent PDF page numbers. Ruled row associations are checked against their real geometry.
    let ruled = createSessionState(state.problems, state.worksheetId);
    let fitsRules = true;
    try {
      for (const event of events) {
        if (event.type === "stroke_end" && event.stroke.rowId !== null && assignRow(event.stroke, ruled.rows) !== event.stroke.rowId) fitsRules = false;
        ruled = reduceSessionEvent(ruled, event);
      }
      if (fitsRules) return ruled;
    } catch { /* Free-layout row ids need not exist in the ruled bands. */ }
    return events.reduce(reduceSessionEvent, createSessionState(state.problems, state.worksheetId, undefined, "free"));
  }
  const seen = new Set(state.events.map(eventKey));
  return events.reduce((next, event) => {
    const key = eventKey(event);
    if (seen.has(key)) return next;
    seen.add(key);
    return reduceSessionEvent(next, event);
  }, state);
}
