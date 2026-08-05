import { describe, expect, it } from "vitest";
import {
  findEditableMath,
  findUnmatchedMathDelimiters,
} from "./LivePreviewBlockEditor";
import { analyzeLatexSource } from "./latexDiagnostics";

describe("findEditableMath", () => {
  it("finds inline and multiline display formula bodies at exact source offsets", () => {
    const source = "Use $k(x,y)$, then\n$$\nx^2 + y^2\n$$";
    const ranges = findEditableMath(source);

    expect(ranges.map((range) => ({
      source: source.slice(range.from, range.to),
      body: source.slice(range.bodyFrom, range.bodyTo),
      display: range.display,
    }))).toEqual([
      { source: "$k(x,y)$", body: "k(x,y)", display: false },
      { source: "$$\nx^2 + y^2\n$$", body: "x^2 + y^2", display: true },
    ]);
  });

  it("ignores escaped dollars, code spans, prices, and non-conventional runs", () => {
    const source = "Pay \\$5, write `$notMath$`, reject $$$x$$$, keep $x$.";
    expect(findEditableMath(source).map((range) => range.latex)).toEqual(["x"]);
  });

  it("matches the renderer's soft-line inline-math range", () => {
    expect(findEditableMath("Broken $x\nvalid $y$")).toEqual([
      expect.objectContaining({ latex: "x\nvalid ", display: false }),
    ]);
  });

  it("matches renderer grammar for multiline display fences", () => {
    expect(findEditableMath("$$\nx^2 + y^2\n$$").map((range) => range.latex))
      .toEqual(["x^2 + y^2"]);
    expect(findEditableMath("Inline $$x^2 + y^2$$ remains valid.")
      .map((range) => range.latex)).toEqual(["x^2 + y^2"]);
  });

  it("exposes the exact malformed Vectorization tail instead of swallowing it", () => {
    const vectorizationTail = String.raw`$$\begin{aligned}a &= \text{ReLU}(W^{[1]}x + b^{[1]})\\
\bar{h}_{\theta}(x) &= W^{[2]}a + b^{[2]}.
\end{aligned}$$
$$`;

    const analysis = analyzeLatexSource(vectorizationTail);
    expect(analysis.ranges).toEqual([]);
    expect(analysis.diagnostics).toEqual([
      expect.objectContaining({
        code: "display-fence-layout",
        formulaFrom: 0,
        display: true,
      }),
      expect.objectContaining({
        code: "unclosed-display",
        display: true,
      }),
    ]);
    const [layout, trailing] = analysis.diagnostics;
    expect(vectorizationTail.slice(layout.formulaFrom, layout.formulaTo))
      .toContain(String.raw`\bar{h}_{\theta}`);
    expect(vectorizationTail.slice(trailing.from, trailing.to)).toBe("$$");
  });

  it("flags malformed delimiters without treating prices or code as formulae", () => {
    const source = "Broken $x and $$ display; price $5; code `$$`.";
    expect(findUnmatchedMathDelimiters(source).map((issue) => issue.delimiter))
      .toEqual(["$", "$$"]);
  });
});
