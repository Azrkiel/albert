import { describe, expect, it } from "vitest";
import { decodeRouteId } from "../../src/lib/route-id";

const id = "github:Azrkiel/albert:seed%2Fcalc2%2Fmanifest.json~calc2:abc:2026-11-14/f/pdf%2Funit-3%2Fworksheet-3.pdf/worksheet";

describe("decodeRouteId", () => {
  it("decodes the URL segment exactly once, keeping the id's own escapes", () => {
    expect(decodeRouteId(encodeURIComponent(id))).toBe(id);
    expect(decodeRouteId(encodeURIComponent(id))).toContain("%2F");
  });
  it("round-trips a store lookup keyed by the snapshot-qualified id", () => {
    const store = new Map([[id, "Worksheet 3"]]);
    const segment = encodeURIComponent(id);
    expect(store.get(segment)).toBeUndefined();
    expect(store.get(decodeRouteId(segment))).toBe("Worksheet 3");
  });
  it("leaves plain ids alone", () => expect(decodeRouteId("calc2-ws3")).toBe("calc2-ws3"));
  it("falls back to the raw segment when it is malformed", () => expect(decodeRouteId("bad%E0%A4%A")).toBe("bad%E0%A4%A"));
});
