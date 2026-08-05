import { describe, expect, it } from "vitest";
import type { Landmark } from "../domain/types";
import { landmarkFormulaCandidates } from "./landmarkFormulaPreview";
import { landmarkPreviewMarkdown } from "./LandmarkPreviewContent";

const landmark: Landmark = {
  id: "normal-equations",
  title: "Normal equations",
  kind: "theorem",
  subjectIds: ["synthetic-field-05"],
  regionId: "linear-models",
  summary: "The stationary condition for least squares.",
  statement: "A minimiser satisfies $X^T X\\beta=X^T y$.",
  markdown: "",
  tags: [],
  status: "draft",
  mastery: { state: 0, explain: 0, derive: 0, apply: 0 },
};

describe("landmark compiled preview", () => {
  it("extracts the first display formula without exposing surrounding Markdown", () => {
    expect(landmarkPreviewMarkdown(
      landmark,
      "formula",
      "Some context.\n\n$$\n\\hat{\\beta}=(X^TX)^{-1}X^Ty\n$$\n\nMore.",
    )).toBe("$$\n\\hat{\\beta}=(X^TX)^{-1}X^Ty\n$$");
  });

  it("selects any substantive display formula by its source-order index", () => {
    const markdown = [
      "Inline notation $a$, $b$, and $c$ must not crowd the picker.",
      "",
      "$$",
      "\\hat{\\theta}=\\arg\\min_\\theta L(\\theta)",
      "$$",
      "",
      "$$R(f)=\\mathbb E[\\ell(f(X),Y)]$$",
      "",
      "$$S_n=\\sum_{i=1}^n X_i$$",
    ].join("\n");

    expect(landmarkPreviewMarkdown(landmark, "formula", markdown, 1)).toBe(
      "$$\nR(f)=\\mathbb E[\\ell(f(X),Y)]\n$$",
    );
    expect(landmarkPreviewMarkdown(landmark, "formula", markdown, 2)).toBe(
      "$$\nS_n=\\sum_{i=1}^n X_i\n$$",
    );
  });

  it("falls back to inline formulae only when no display formula exists", () => {
    const markdown = "`$ignored$` then $x_0$ and $x_1$.";

    expect(landmarkPreviewMarkdown(landmark, "formula", markdown)).toBe("$x_0$");
    expect(landmarkPreviewMarkdown(landmark, "formula", markdown, 1)).toBe("$x_1$");
    expect(landmarkPreviewMarkdown(landmark, "formula", markdown, 99)).toBe("$x_0$");
  });

  it("ignores document metadata, comments, code, and escaped dollar signs", () => {
    const markdown = [
      "---",
      "alias: $metadata$",
      "---",
      "<!-- $$hidden = 1$$ -->",
      "`$code$` and \\$escaped$",
      "",
      "$$visible = 2$$",
    ].join("\n");

    expect(landmarkFormulaCandidates(markdown)).toEqual(["$$\nvisible = 2\n$$"]);
  });

  it("prefers the mathematical statement for statement mode", () => {
    expect(landmarkPreviewMarkdown(landmark, "statement", "Unrelated body"))
      .toBe(landmark.statement);
  });

  it("removes frontmatter and the repeated document heading from note mode", () => {
    expect(landmarkPreviewMarkdown(
      { ...landmark, statement: undefined, summary: "" },
      "note",
      "---\nid: normal-equations\n---\n\n# Normal equations\n\nFirst paragraph.\n\nSecond paragraph.",
    )).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("never substitutes an informal Note's backing title for an empty body", () => {
    expect(landmarkPreviewMarkdown(
      {
        ...landmark,
        title: "atlas-note-landmark-private-id",
        kind: "concept",
        statement: undefined,
        summary: "",
      },
      "note",
      "",
    )).toBe("");
  });
});
