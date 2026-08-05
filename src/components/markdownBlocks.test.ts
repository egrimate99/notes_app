import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "./markdownBlocks";

describe("splitMarkdownBlocks", () => {
  it("returns nonblank top-level blocks and leaves separators outside ranges", () => {
    const markdown =
      "\n# Foundations\n\nA paragraph on one line\ncontinued on another.\n\n---\n\nLast paragraph.\n";
    const blocks = splitMarkdownBlocks(markdown);

    expect(blocks.map(({ kind, markdown: source }) => [kind, source])).toEqual([
      ["heading", "# Foundations"],
      ["paragraph", "A paragraph on one line\ncontinued on another."],
      ["thematic-break", "---"],
      ["paragraph", "Last paragraph."],
    ]);
    expect(markdown.slice(blocks[0].end, blocks[1].start)).toBe("\n\n");
    expect(markdown.slice(blocks[1].end, blocks[2].start)).toBe("\n\n");
    for (const block of blocks) {
      expect(markdown.slice(block.start, block.end)).toBe(block.markdown);
    }
  });

  it("keeps fenced code and display mathematics coherent, including blank lines", () => {
    const markdown = [
      "```ts",
      "const x = 1;",
      "",
      "const y = 2;",
      "```",
      "",
      "$$",
      "\\begin{aligned}",
      "x &= 1, \\\\",
      "y &= 2",
      "\\end{aligned}",
      "$$",
    ].join("\n");

    const blocks = splitMarkdownBlocks(markdown);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "code" });
    expect(blocks[0].markdown).toContain("const x = 1;\n\nconst y = 2;");
    expect(blocks[1]).toMatchObject({ kind: "math" });
    expect(blocks[1].markdown).toBe(markdown.slice(blocks[1].start));
  });

  it("keeps Obsidian callouts and nested or loose lists in single visual blocks", () => {
    const markdown = [
      "> [!theorem] Pythagoras",
      "> For a right triangle:",
      ">",
      "> $$a^2+b^2=c^2$$",
      "",
      "- First item",
      "  - Nested item",
      "",
      "- Second item",
      "  continued detail",
      "",
      "After the list.",
    ].join("\n");

    const blocks = splitMarkdownBlocks(markdown);
    expect(blocks.map((block) => block.kind)).toEqual([
      "callout",
      "list",
      "paragraph",
    ]);
    expect(blocks[0].markdown).toContain("> $$a^2+b^2=c^2$$");
    expect(blocks[1].markdown).toContain("\n\n- Second item");
    expect(blocks[1].markdown).toContain("  continued detail");
  });

  it("recognises setext headings without mistaking standalone rules", () => {
    const markdown = "A setext heading\n===\n\n---\n\nBody";
    expect(
      splitMarkdownBlocks(markdown).map(({ kind, markdown: source }) => [
        kind,
        source,
      ]),
    ).toEqual([
      ["heading", "A setext heading\n==="],
      ["thematic-break", "---"],
      ["paragraph", "Body"],
    ]);
  });

  it("uses exact UTF-16 offsets without normalising CRLF separators", () => {
    const markdown =
      "\r\n# Title\r\n\r\nFirst $x$.\r\nStill first.\r\n\r\n$$\r\nx^2\r\n$$\r\n";
    const blocks = splitMarkdownBlocks(markdown);

    expect(blocks.map(({ start, end }) => [start, end])).toEqual([
      [2, 9],
      [13, 37],
      [41, 52],
    ]);
    expect(markdown.slice(blocks[0].end, blocks[1].start)).toBe("\r\n\r\n");
    expect(markdown.slice(blocks[1].end, blocks[2].start)).toBe("\r\n\r\n");
    expect(blocks[2].markdown).toBe("$$\r\nx^2\r\n$$");
  });

  it("supports exact block replacement without touching any surrounding bytes", () => {
    const markdown =
      "# Topic\r\n\r\nOld text with $x$.\r\n\r\n> [!definition]\r\n> Existing.\r\n";
    const [, target] = splitMarkdownBlocks(markdown);
    const replacement = "New text with $x^2$.";
    const updated =
      markdown.slice(0, target.start) +
      replacement +
      markdown.slice(target.end);

    expect(updated).toBe(
      "# Topic\r\n\r\nNew text with $x^2$.\r\n\r\n> [!definition]\r\n> Existing.\r\n",
    );
    expect(updated.slice(0, target.start)).toBe(
      markdown.slice(0, target.start),
    );
    expect(updated.slice(target.start + replacement.length)).toBe(
      markdown.slice(target.end),
    );
  });
});
