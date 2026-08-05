import { describe, expect, it } from "vitest";
import { createEditorInsertion } from "./editorTransforms";

describe("createEditorInsertion", () => {
  it("wraps selected inline mathematics and preserves its selection", () => {
    expect(createEditorInsertion("Use x+y here", 4, 7, "inline-math")).toEqual({
      from: 4,
      to: 7,
      insert: "$x+y$",
      anchor: 5,
      head: 8,
    });
  });

  it("inserts an empty display block with the caret inside", () => {
    expect(createEditorInsertion("", 0, 0, "display-math")).toEqual({
      from: 0,
      to: 0,
      insert: "$$\n\n$$",
      anchor: 3,
      head: 3,
    });
  });

  it("turns multiline selections into an Obsidian theorem callout", () => {
    expect(createEditorInsertion("A\nB", 0, 3, "theorem")).toEqual({
      from: 0,
      to: 3,
      insert: "> [!theorem]\n> A\n> B",
      anchor: 15,
      head: 20,
    });
  });

  it.each(["definition", "example", "theorem", "proposition", "lemma"] as const)(
    "inserts a minimal %s environment with the caret in its body",
    (environment) => {
      const insertion = createEditorInsertion("", 0, 0, environment);
      expect(insertion.insert).toBe(`> [!${environment}]\n> `);
      expect(insertion.anchor).toBe(insertion.insert.length);
      expect(insertion.head).toBe(insertion.insert.length);
    },
  );

  it("creates standalone block boundaries when invoked in the middle of text", () => {
    const insertion = createEditorInsertion("BeforeAfter", 6, 6, "definition");
    expect(insertion.insert).toBe("\n\n> [!definition]\n> \n\n");
    expect(insertion.anchor).toBe("Before\n\n> [!definition]\n> ".length);
    expect(insertion.head).toBe(insertion.anchor);
  });

  it("reuses existing block-boundary whitespace instead of adding blank lines", () => {
    const document = "Before\n\nAfter";
    const insertion = createEditorInsertion(document, 8, 8, "lemma");
    expect(insertion.insert).toBe("> [!lemma]\n> \n\n");
  });

  it("preserves CRLF and selects wrapped content", () => {
    const insertion = createEditorInsertion("A\r\nB", 0, 4, "proposition");
    expect(insertion.insert).toBe("> [!proposition]\r\n> A\r\n> B");
    expect(insertion.insert.slice(insertion.anchor, insertion.head)).toBe("A\r\n> B");
  });
});
