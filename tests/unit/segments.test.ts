import { describe, expect, it } from "vitest";
import { breakLongWords, mathAsText, spaceSegments, wrapLines } from "../../src/lib/ink/segments";

const text = (t: string) => ({ type: "text", text: t }) as const;
const math = (l: string) => ({ type: "math", latex: l }) as const;
const joined = (segs: ReturnType<typeof spaceSegments>) => segs.map((s) => s.type === "text" ? s.text : s.type === "math" ? `$${s.latex}$` : "|").join("");

describe("spaceSegments", () => {
  it("separates text and math that touch", () => {
    expect(joined(spaceSegments([text("find"), math("dx"), text("— what is it?")]))).toBe("find $dx$— what is it?");
  });
  it("keeps existing whitespace and punctuation joins", () => {
    expect(joined(spaceSegments([text("find "), math("dx"), text(", then")]))).toBe("find $dx$, then");
    expect(joined(spaceSegments([text("f("), math("x"), text(")")]))).toBe("f($x$)");
  });
  it("spaces two math segments, and leaves text-to-text and breaks alone", () => {
    expect(joined(spaceSegments([math("a"), math("b")]))).toBe("$a$ $b$");
    expect(joined(spaceSegments([text("don"), text("'t")]))).toBe("don't");
    expect(joined(spaceSegments([text("x"), { type: "break" }, math("y")]))).toBe("x|$y$");
  });
});
describe("fallbacks", () => {
  const w = (s: string) => s.length * 10;
  it("mathAsText keeps the LaTeX source", () => { expect(mathAsText([math("\frac{1}{2}")])).toEqual([text("\frac{1}{2}")]); });
  it("breakLongWords splits only words wider than the column", () => {
    expect(breakLongWords("ab abcdefgh", 50, w)).toBe("ab abcde fgh");
  });
  it("wrapLines wraps greedily", () => { expect(wrapLines("one two three", 70, w)).toEqual(["one two", "three"]); });
});
