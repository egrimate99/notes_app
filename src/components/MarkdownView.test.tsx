import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";
import { buildWikiLinkIndex } from "../domain/wikiLinks";

describe("MarkdownView", () => {
  it("normalizes Obsidian wikilinks and renders mathematical notation", () => {
    const { container } = render(
      <MarkdownView markdown={"Use [[Sample Topic|the sample idea]] with $k(x,y)$"} />,
    );

    expect(screen.getByText(/the sample idea/)).toBeInTheDocument();
    expect(container.querySelector(".katex")).toBeInTheDocument();
    expect(container.textContent).not.toContain("[[");
  });

  it("opens resolved wikilinks while keeping disambiguating folders out of the note", () => {
    const onNavigateWikiLink = vi.fn();
    const wikiLinkIndex = buildWikiLinkIndex([
      "Subject Alpha/Topic One/Shared Concept.md",
      "Subject Alpha/Topic Two/Shared Concept.md",
    ]);
    render(
      <MarkdownView
        markdown="See [[Subject Alpha/Topic One/Shared Concept|the shared idea]]."
        contentPath="Subject Alpha/Topic One/Sequence.md"
        wikiLinkIndex={wikiLinkIndex}
        onNavigateWikiLink={onNavigateWikiLink}
      />,
    );

    const link = screen.getByRole("link", { name: "the shared idea" });
    expect(link).toHaveAttribute(
      "data-wiki-path",
      "Subject Alpha/Topic One/Shared Concept.md",
    );
    expect(link).not.toHaveTextContent("Subject Alpha/Topic One");
    fireEvent.click(link);
    expect(onNavigateWikiLink).toHaveBeenCalledWith(
      "Subject Alpha/Topic One/Shared Concept.md",
    );
  });

  it("renders Obsidian theorem callouts as framed math environments", () => {
    const { container } = render(
      <MarkdownView
        markdown={"> [!theorem] Fixture Result\n> Every sample relation has a representation."}
      />,
    );

    expect(screen.getByText(/theorem \(Fixture Result\)/i)).toBeInTheDocument();
    expect(container.querySelector(".math-environment--theorem")).toBeInTheDocument();
    expect(container.querySelector("blockquote")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("[!theorem]");
  });

  it("hides Obsidian HTML comments without disturbing surrounding prose", () => {
    const { container } = render(
      <MarkdownView
        markdown={[
          "Before <!-- PDF page 17; printed page 16 --> after.",
          "",
          "<!-- Running header in source: Example -->",
          "Still visible.",
        ].join("\n")}
      />,
    );

    expect(container).toHaveTextContent("Before after.");
    expect(container).toHaveTextContent("Still visible.");
    expect(container.textContent).not.toContain("PDF page");
    expect(container.textContent).not.toContain("Running header");
    expect(container.innerHTML).not.toContain("<!--");
  });

  it("unwraps imported formatting tags while preserving their readable content", () => {
    const { container } = render(
      <MarkdownView
        markdown={[
          "<u>Theorem</u> and <s>obsolete wording</s>.",
          "",
          "A property <span style=\"float: right;\" onclick=\"danger()\">(symmetry)</span>.",
        ].join("\n")}
      />,
    );

    expect(container).toHaveTextContent("Theorem and obsolete wording.");
    expect(container).toHaveTextContent("A property (symmetry).");
    expect(container.querySelector("u")).toHaveTextContent("Theorem");
    expect(container.querySelector("del")).toHaveTextContent("obsolete wording");
    expect(container.querySelector("s")).not.toBeInTheDocument();
    expect(container.querySelector(".math-property-label")).toHaveTextContent("(symmetry)");
    expect(container.querySelector(".math-property-label")).not.toHaveAttribute("style");
    expect(container.innerHTML).not.toContain("onclick");
    expect(container.innerHTML).not.toContain("float: right");
  });

  it("never mounts arbitrary raw HTML", () => {
    const { container } = render(
      <MarkdownView
        markdown={[
          "Safe before.",
          "",
          "<script>globalThis.compromised = true</script>",
          "<iframe src=\"https://example.invalid\">fallback</iframe>",
          "",
          "Safe after <img src=x onerror=\"danger()\">.",
        ].join("\n")}
      />,
    );

    expect(container).toHaveTextContent("Safe before.");
    expect(container).toHaveTextContent("Safe after .");
    expect(container.querySelector("script, iframe, img")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.innerHTML).not.toContain("example.invalid");
  });

  it("preserves formula source offsets when an earlier comment is hidden", () => {
    const markdown = "Lead <!-- PDF page 2 --> into $x+y$ now.";
    const onActivateTarget = vi.fn();
    const { container } = render(
      <MarkdownView
        markdown={markdown}
        editable
        onActivateTarget={onActivateTarget}
      />,
    );

    fireEvent.click(container.querySelector(".katex")!);
    const formulaStart = markdown.indexOf("x+y");
    expect(onActivateTarget).toHaveBeenCalledWith({
      kind: "inline-math",
      from: formulaStart,
      to: formulaStart + "x+y".length,
      delimiter: "$",
      cursorRatio: 1,
    });
  });

  it("renders imported tables, task lists, and footnotes as structured notes", () => {
    const { container } = render(
      <MarkdownView markdown={[
        "| Symbol | Meaning |",
        "| --- | --- |",
        "| $X$ | Variable |",
        "",
        "- [x] Verified",
        "",
        "A claim.[^proof]",
        "",
        "[^proof]: Supporting argument.",
      ].join("\n")} />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(container.querySelector(".math-footnote-definition"))
      .toHaveTextContent("Supporting argument");
    expect(within(container).getByRole("link", { name: "Footnote proof" }))
      .toHaveAttribute("href", "#math-atlas-footnote-proof");
  });

  it("keeps footnotes usable when a large note is rendered in separate chunks", () => {
    const { container } = render(
      <>
        <MarkdownView markdown="A claim.[^proof]" />
        <MarkdownView markdown="[^proof]: Supporting argument." />
      </>,
    );

    expect(within(container).getByRole("link", { name: "Footnote proof" }))
      .toHaveAttribute("href", "#math-atlas-footnote-proof");
    expect(within(container).getByRole("complementary"))
      .toHaveAttribute("id", "math-atlas-footnote-proof");
    expect(within(container).getByRole("complementary"))
      .toHaveTextContent("Supporting argument");
  });

  it("keeps adjacent definition and theorem callouts separate", () => {
    const { container } = render(
      <MarkdownView
        markdown={
          "> [!definition]\n> A sample object has a property.\n\n> [!theorem]\n> Every sample object has a representation."
        }
      />,
    );

    expect(container.querySelectorAll(".math-environment")).toHaveLength(2);
    expect(container.querySelector(".math-environment--definition")).toBeInTheDocument();
    expect(container.querySelector(".math-environment--theorem")).toBeInTheDocument();
  });

  it("turns one-line Obsidian double-dollar expressions into display math", () => {
    const { container } = render(
      <MarkdownView
        markdown={"> [!definition]\n> The loss is $$J(\\theta)=\\sum_i e_i^2.$$"}
      />,
    );

    expect(container.querySelector(".math-environment--definition")).toBeInTheDocument();
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(container.querySelector("p > div.editable-math")).not.toBeInTheDocument();
  });

  it("maps a clicked compiled formula to its exact raw LaTeX body", () => {
    const markdown = "Use [[Sample Topic|the sample idea]] with $k(x,y)$ now.";
    const onActivateTarget = vi.fn();
    const { container } = render(
      <MarkdownView
        markdown={markdown}
        editable
        onActivateTarget={onActivateTarget}
      />,
    );

    fireEvent.click(container.querySelector(".katex")!);
    const formulaStart = markdown.indexOf("k(x,y)");
    expect(onActivateTarget).toHaveBeenCalledWith({
      kind: "inline-math",
      from: formulaStart,
      to: formulaStart + "k(x,y)".length,
      delimiter: "$",
      cursorRatio: 1,
    });
    expect(container.textContent).toContain("the sample idea");
    expect(markdown.slice(formulaStart, formulaStart + 6)).toBe("k(x,y)");
  });

  it("positions formula and block carets from the visual click point", () => {
    const onActivateTarget = vi.fn();
    const { container } = render(
      <MarkdownView
        markdown={"Alpha $abcd$ omega"}
        editable
        onActivateTarget={onActivateTarget}
      />,
    );
    const formula = container.querySelector<HTMLElement>(
      ".editable-math--inline",
    )!;
    const document = container.querySelector<HTMLElement>(".markdown-view")!;
    vi.spyOn(formula, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });
    vi.spyOn(document, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 40,
      width: 200,
      height: 40,
      toJSON: () => ({}),
    });

    fireEvent.click(container.querySelector(".katex")!, {
      clientX: 25,
      clientY: 10,
    });
    expect(onActivateTarget).toHaveBeenLastCalledWith({
      kind: "inline-math",
      from: 7,
      to: 11,
      delimiter: "$",
      cursorRatio: 0.25,
    });

    fireEvent.click(container.querySelector("p")!, {
      clientX: 100,
      clientY: 30,
    });
    expect(onActivateTarget).toHaveBeenLastCalledWith({
      kind: "block",
      from: 0,
      to: 18,
      cursorRatio: 0.75,
    });
  });

  it("maps display clicks from the rendered ink instead of its full-width wrapper", () => {
    const markdown = "$$abcdefgh$$";
    const onActivateTarget = vi.fn();
    const { container } = render(
      <MarkdownView
        markdown={markdown}
        editable
        onActivateTarget={onActivateTarget}
      />,
    );
    const formula = container.querySelector<HTMLElement>(".editable-math")!;
    const ink = formula.querySelector<HTMLElement>(".katex-html")!;
    vi.spyOn(formula, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 80,
      width: 800,
      height: 80,
      toJSON: () => ({}),
    });
    vi.spyOn(ink, "getBoundingClientRect").mockReturnValue({
      x: 300,
      y: 20,
      top: 20,
      left: 300,
      right: 500,
      bottom: 60,
      width: 200,
      height: 40,
      toJSON: () => ({}),
    });

    fireEvent.click(ink, { clientX: 400, clientY: 40 });
    expect(onActivateTarget).toHaveBeenCalledWith({
      kind: "display-math",
      from: 2,
      to: 10,
      delimiter: "$$",
      cursorRatio: 0.5,
    });
  });

  it("keeps rich Markdown containers neutral and makes formulas keyboard accessible", () => {
    const onActivateTarget = vi.fn();
    const { container } = render(
      <MarkdownView
        markdown={"Use $x+y$ here."}
        editable
        onActivateTarget={onActivateTarget}
      />,
    );

    const document = container.querySelector(".markdown-view")!;
    expect(document).not.toHaveAttribute("role");
    expect(document).not.toHaveAttribute("tabindex");

    const formula = within(container).getByRole("button", {
      name: "Edit inline LaTeX formula",
    });
    expect(formula).toHaveAttribute("tabindex", "0");
    formula.focus();
    fireEvent.keyDown(formula, { key: "Enter" });
    expect(onActivateTarget).toHaveBeenLastCalledWith({
      kind: "inline-math",
      from: 5,
      to: 8,
      delimiter: "$",
    });

    fireEvent.keyDown(formula, { key: " " });
    expect(onActivateTarget).toHaveBeenCalledTimes(2);
  });

  it("does not expose interactive formula semantics in a read-only note", () => {
    const { container } = render(<MarkdownView markdown={"Read $x$ only."} />);

    expect(
      within(container).queryByRole("button", { name: /LaTeX formula/i }),
    ).not.toBeInTheDocument();
  });

  it("maps a top-level CRLF display formula to its exact contiguous body", () => {
    const markdown = "$$\r\nx^2 + y^2\r\n$$";
    const onActivateTarget = vi.fn();
    const { container } = render(
      <MarkdownView
        markdown={markdown}
        editable
        onActivateTarget={onActivateTarget}
      />,
    );

    fireEvent.click(
      within(container).getByRole("button", {
        name: "Edit display LaTeX formula",
      }),
    );
    const formulaStart = markdown.indexOf("x^2");
    expect(onActivateTarget).toHaveBeenCalledWith({
      kind: "display-math",
      from: formulaStart,
      to: formulaStart + "x^2 + y^2".length,
      delimiter: "$$",
      cursorRatio: 1,
    });
  });

  it.each([
    ["blockquote", "> $$\n> x^2 + y^2\n> $$"],
    ["list", "- Derivation:\n\n  $$\n  x^2 + y^2\n  $$"],
  ])(
    "falls back to whole-block editing for non-contiguous display math in a %s",
    (_containerName, markdown) => {
      const onActivateTarget = vi.fn();
      const { container } = render(
        <MarkdownView
          markdown={markdown}
          editable
          onActivateTarget={onActivateTarget}
        />,
      );

      const formula = within(container).getByRole("button", {
        name: "Edit containing Markdown block",
      });
      expect(formula).toHaveAttribute("data-source-kind", "block");
      expect(formula).not.toHaveAttribute("data-source-delimiter");
      fireEvent.click(formula);
      expect(onActivateTarget).toHaveBeenCalledWith({
        kind: "block",
        from: 0,
        to: markdown.length,
        cursorRatio: 1,
      });
    },
  );

  it.each([
    ["inline", "Use $$$x+1$$$ carefully."],
    ["display", "$$$$\nx+1\n$$$$"],
  ])(
    "rejects longer %s dollar runs instead of trimming a partial delimiter",
    (_formulaType, markdown) => {
      const onActivateTarget = vi.fn();
      const { container } = render(
        <MarkdownView
          markdown={markdown}
          editable
          onActivateTarget={onActivateTarget}
        />,
      );

      const formula = within(container).getByRole("button", {
        name: "Edit containing Markdown block",
      });
      fireEvent.keyDown(formula, { key: "Enter" });
      expect(onActivateTarget).toHaveBeenCalledWith({
        kind: "block",
        from: 0,
        to: markdown.length,
      });
    },
  );
});
