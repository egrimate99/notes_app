import { describe, expect, it } from "vitest";
import { landmarkFileTemplate, noteBodyTemplate } from "./noteTemplates";

describe("note templates", () => {
  it.each([
    "definition",
    "theorem",
    "proposition",
    "lemma",
    "corollary",
    "example",
  ] as const)("creates a minimal %s environment", (kind) => {
    expect(noteBodyTemplate(kind)).toBe(`> [!${kind}]\n> `);
  });

  it("keeps ordinary notes and non-environment kinds empty", () => {
    expect(noteBodyTemplate("concept")).toBe("");
    expect(noteBodyTemplate("method")).toBe("");
  });

  it("uses structural metadata without generating a duplicate heading", () => {
    const markdown = landmarkFileTemplate({
      id: "landmark-1",
      kind: "definition",
      subjectId: "synthetic-field-02",
    });

    expect(markdown).toBe(
      "---\nid: landmark-1\nkind: definition\nsubject: synthetic-field-02\n---\n\n> [!definition]\n> ",
    );
    expect(markdown).not.toContain("# Untitled");
    expect(markdown).not.toMatch(/click here|start writing/i);
  });
});
