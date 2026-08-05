import { describe, expect, it } from "vitest";
import {
  analyzeLatexSource,
  applyLatexDiagnosticFix,
  findLatexDiagnostics,
  formatLatexDiagnostic,
  suggestLatexDiagnosticFix,
  type LatexDiagnostic,
} from "./latexDiagnostics";

describe("latexDiagnostics", () => {
  it("classifies conventional inline, one-line display, and fenced display math", () => {
    const source = "Use $x+1$ and $$y^2$$.\n\n$$\n\\sum_i x_i\n$$";
    const result = analyzeLatexSource(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.ranges.map((range) => ({
      source: source.slice(range.from, range.to),
      body: range.latex,
      syntax: range.syntax,
      display: range.display,
    }))).toEqual([
      { source: "$x+1$", body: "x+1", syntax: "inline", display: false },
      { source: "$$y^2$$", body: "y^2", syntax: "display-inline", display: true },
      {
        source: "$$\n\\sum_i x_i\n$$",
        body: "\\sum_i x_i",
        syntax: "display-fence",
        display: true,
      },
    ]);
  });

  it("reports exact unclosed delimiter offsets without consuming later paragraphs", () => {
    const source = "Broken $x + y\n\nValid $z$.\n\n$$\nx^2";
    const result = analyzeLatexSource(source);

    expect(result.ranges.map((range) => range.latex)).toEqual(["z"]);
    expect(result.diagnostics.map((item) => ({
      code: item.code,
      marked: source.slice(item.from, item.to),
      formula: source.slice(item.formulaFrom, item.formulaTo),
      line: item.line,
      column: item.column,
    }))).toEqual([
      {
        code: "unclosed-inline",
        marked: "$",
        formula: "$x + y",
        line: 1,
        column: 8,
      },
      {
        code: "unclosed-display",
        marked: "$$",
        formula: "$$\nx^2",
        line: 5,
        column: 1,
      },
    ]);
  });

  it("matches remark-math flow precedence when a fence-looking line follows prose math", () => {
    const source = "Text $$x\ny\n$$";
    const result = analyzeLatexSource(source);

    expect(result.ranges).toEqual([]);
    expect(result.diagnostics.map(({ code, formulaFrom }) => ({ code, formulaFrom }))).toEqual([
      { code: "unclosed-display", formulaFrom: source.indexOf("$$") },
      { code: "unclosed-display", formulaFrom: source.lastIndexOf("$$") },
    ]);
  });

  it("flags line-start display LaTeX that remark-math misreads as fence metadata", () => {
    const source = "$$\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}$$";
    const result = analyzeLatexSource(source);

    expect(result.ranges).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "display-fence-layout",
        from: 0,
        to: 2,
        formulaFrom: 0,
        formulaTo: source.length,
        line: 1,
        column: 1,
        display: true,
        message: "Put $$ on its own line before and after this display formula.",
      }),
    ]);

    expect(analyzeLatexSource("$$\\begin{aligned}x&=1\\end{aligned}$$").diagnostics)
      .toEqual([]);
  });

  it("normalizes blockquote callout prefixes while preserving parse-error offsets", () => {
    const valid = "> [!theorem]\n> $$\n> \\frac{1}{2}\n> $$";
    const validResult = analyzeLatexSource(valid);
    expect(validResult.diagnostics).toEqual([]);
    expect(validResult.ranges[0]).toMatchObject({
      latex: "\\frac{1}{2}",
      syntax: "display-fence",
    });

    const invalid = "> [!theorem]\n> $$\n> \\unknown{x}\n> $$";
    const [error] = findLatexDiagnostics(invalid);
    expect(error).toMatchObject({
      code: "parse-error",
      from: invalid.indexOf("\\unknown"),
      line: 3,
      column: 3,
      display: true,
    });
    expect(error.message).toBe("Undefined control sequence: \\unknown");
    expect(error.message).not.toContain("at position");
  });

  it("pinpoints malformed closed formulae and provides concise KaTeX messages", () => {
    const source = "First $\\frac{1}{2$; second $x_{$.";
    const diagnostics = findLatexDiagnostics(source);

    expect(diagnostics).toHaveLength(2);
    const firstOpening = source.indexOf("$");
    const firstClosing = source.indexOf("$", firstOpening + 1);
    expect(diagnostics[0]).toMatchObject({
      code: "parse-error",
      formulaFrom: firstOpening,
      formulaTo: firstClosing + 1,
      display: false,
    });
    expect(diagnostics[0].message).toContain("expected '}'");
    expect(diagnostics[1].message).toBe("Expected '}', got 'EOF'");
    diagnostics.forEach((item) => {
      expect(item.from).toBeGreaterThanOrEqual(item.formulaFrom + 1);
      expect(item.to).toBeGreaterThan(item.from);
      expect(item.to).toBeLessThanOrEqual(item.formulaTo);
    });
  });

  it("ignores code, escaped dollars, non-conventional runs, and unclosed currency", () => {
    const source = "Pay $5, keep `$not math$`, escape \\$x, ignore $$$z$$$, diagnose $y";
    const result = analyzeLatexSource(source);

    expect(result.ranges).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "unclosed-inline",
      from: source.lastIndexOf("$"),
      formulaTo: source.length,
    });
  });

  it("never uses a currency token as the closing delimiter of broken math", () => {
    const source = "Broken $x + y, then pay $5";
    const result = analyzeLatexSource(source);

    expect(result.ranges).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "unclosed-inline",
        from: source.indexOf("$"),
        to: source.indexOf("$") + 1,
        formulaFrom: source.indexOf("$"),
        formulaTo: source.length,
      }),
    ]);
  });

  it.each([
    ["unclosed-inline", "Unclosed inline formula", "Add the matching $"],
    ["unclosed-display", "Unclosed display formula", "Add the matching $$"],
    ["display-fence-layout", "Markdown display fence", "Put each $$ on its own line"],
  ] as const)("formats %s as a compact actionable presentation", (code, title, action) => {
    const diagnostic: LatexDiagnostic = {
      code,
      message: "Source needs attention.",
      from: 12,
      to: 13,
      formulaFrom: 12,
      formulaTo: 20,
      line: 4,
      column: 7,
      display: code !== "unclosed-inline",
    };

    expect(formatLatexDiagnostic(diagnostic)).toEqual({
      title,
      detail: code === "display-fence-layout"
        ? "Markdown treats LaTeX beside an opening $$ as fence metadata. In an aligned block this strips \\begin{aligned}, so KaTeX encounters & outside an alignment."
        : "Source needs attention.",
      action: expect.stringContaining(action),
      location: "Line 4, column 7",
      ariaLabel: expect.stringContaining(`${title}. Line 4, column 7.`),
    });
  });

  it("turns common KaTeX failures into specific repair guidance", () => {
    const cases = [
      ["$\\unknown{x}$", "Check the highlighted command spelling"],
      ["$x_{$", "Add the missing closing brace"],
      ["$\\begin{aligned}x$", "Close the environment"],
    ] as const;

    for (const [source, expected] of cases) {
      const [diagnostic] = findLatexDiagnostics(source);
      expect(diagnostic.code).toBe("parse-error");
      expect(formatLatexDiagnostic(diagnostic)).toMatchObject({
        title: "LaTeX syntax error",
        action: expect.stringContaining(expected),
      });
      expect(suggestLatexDiagnosticFix(source, diagnostic)).toBeUndefined();
    }
  });

  it.each([
    ["Broken $x", "Broken $x$", "Add closing $"],
    ["Use $$x", "Use $$x$$", "Add closing $$"],
    ["$$\nx^2", "$$\nx^2\n$$", "Add closing $$ line"],
    ["> $$\n> x^2", "> $$\n> x^2\n> $$", "Add closing $$ line"],
  ] as const)("offers a deterministic delimiter repair for %s", (source, expected, label) => {
    const [diagnostic] = findLatexDiagnostics(source);
    const fix = suggestLatexDiagnosticFix(source, diagnostic);
    expect(fix?.label).toBe(label);
    expect(fix && applyLatexDiagnosticFix(source, fix)).toBe(expected);
    expect(findLatexDiagnostics(expected)).toEqual([]);
  });

  it("repairs the remark-math display-fence layout trap without rewriting LaTeX", () => {
    const source = "$$\\begin{aligned}\nx&=1\n\\end{aligned}$$";
    const [diagnostic] = findLatexDiagnostics(source);
    const fix = suggestLatexDiagnosticFix(source, diagnostic);
    expect(fix).toEqual({
      label: "Put $$ on separate lines",
      edits: [
        { from: 2, to: 2, insert: "\n" },
        { from: source.length - 2, to: source.length - 2, insert: "\n" },
      ],
    });
    const repaired = applyLatexDiagnosticFix(source, fix!);
    expect(repaired).toBe("$$\n\\begin{aligned}\nx&=1\n\\end{aligned}\n$$");
    expect(findLatexDiagnostics(repaired)).toEqual([]);
  });

  it("preserves blockquote containers when repairing display-fence layout", () => {
    const source = "> $$\\begin{aligned}\n> x&=1\n> \\end{aligned}$$";
    const [diagnostic] = findLatexDiagnostics(source);
    const fix = suggestLatexDiagnosticFix(source, diagnostic);
    expect(fix && applyLatexDiagnosticFix(source, fix)).toBe(
      "> $$\n> \\begin{aligned}\n> x&=1\n> \\end{aligned}\n> $$",
    );
  });

  it("withholds unsafe delimiter guesses and rejects overlapping edit sets", () => {
    const source = "Broken $x $$";
    const [diagnostic] = findLatexDiagnostics(source);
    expect(suggestLatexDiagnosticFix(source, diagnostic)).toBeUndefined();
    expect(() => applyLatexDiagnosticFix("abcd", {
      label: "invalid",
      edits: [
        { from: 1, to: 3, insert: "x" },
        { from: 2, to: 4, insert: "y" },
      ],
    })).toThrow(RangeError);
  });
});
