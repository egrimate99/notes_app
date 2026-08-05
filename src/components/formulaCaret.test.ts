import { describe, expect, it } from "vitest";
import { formulaSourceOffsetAtPoint } from "./formulaCaret";

const bounds = { left: 100, top: 40, width: 200, height: 80 };

describe("formulaSourceOffsetAtPoint", () => {
  it("maps horizontal points to exact source boundaries", () => {
    expect(formulaSourceOffsetAtPoint("abcd", bounds, 100, 60)).toBe(0);
    expect(formulaSourceOffsetAtPoint("abcd", bounds, 200, 60)).toBe(2);
    expect(formulaSourceOffsetAtPoint("abcd", bounds, 300, 60)).toBe(4);
  });

  it("maps aligned rows vertically and ignores invisible environment wrappers", () => {
    const latex = String.raw`\begin{aligned}a&=x\\b&=y\end{aligned}`;
    const firstRowBody = latex.indexOf("a&=x");
    const secondRowBody = latex.indexOf("b&=y");

    expect(formulaSourceOffsetAtPoint(latex, bounds, 100, 50))
      .toBe(firstRowBody);
    expect(formulaSourceOffsetAtPoint(latex, bounds, 100, 110))
      .toBe(secondRowBody);
    expect(formulaSourceOffsetAtPoint(latex, bounds, 300, 110))
      .toBe(secondRowBody + "b&=y".length);
  });
});
