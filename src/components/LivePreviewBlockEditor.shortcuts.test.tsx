import "@testing-library/jest-dom/vitest";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LivePreviewBlockEditor } from "./LivePreviewBlockEditor";

beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [] as unknown as DOMRectList,
  });
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

afterEach(cleanup);

function renderEditor(value = "", initialCursor = value.length) {
  const onChange = vi.fn();
  render(
    <LivePreviewBlockEditor
      value={value}
      kind="paragraph"
      initialCursor={initialCursor}
      onChange={onChange}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const editor = screen.getByRole("textbox", { name: "Edit paragraph" });
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error("CodeMirror editor was not mounted");
  return { editor, onChange, view };
}

describe("LivePreviewBlockEditor environment shortcuts", () => {
  it.each([
    ["d", "definition"],
    ["e", "example"],
    ["t", "theorem"],
    ["p", "proposition"],
    ["l", "lemma"],
  ] as const)("maps Alt+%s to a minimal %s block", (key, environment) => {
    const { editor, onChange, view } = renderEditor();

    const allowedToBubble = fireEvent.keyDown(editor, {
      key,
      code: `Key${key.toUpperCase()}`,
      altKey: true,
    });

    const expected = `> [!${environment}]\n> `;
    expect(allowedToBubble).toBe(false);
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.anchor).toBe(expected.length);
    expect(view.state.selection.main.head).toBe(expected.length);
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("inserts a valid standalone block at a caret inside prose", () => {
    const { editor, view } = renderEditor("BeforeAfter", 6);

    fireEvent.keyDown(editor, { key: "d", code: "KeyD", altKey: true });

    const expected = "Before\n\n> [!definition]\n> \n\nAfter";
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(
      "Before\n\n> [!definition]\n> ".length,
    );
  });

  it("wraps the current selection and keeps its content selected", () => {
    const { editor, view } = renderEditor("Before chosen after");
    const from = "Before ".length;
    const to = from + "chosen".length;
    act(() => {
      view.dispatch({ selection: { anchor: from, head: to } });
    });

    fireEvent.keyDown(editor, { key: "t", code: "KeyT", altKey: true });

    expect(view.state.doc.toString()).toBe(
      "Before \n\n> [!theorem]\n> chosen\n\n after",
    );
    const selection = view.state.selection.main;
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe("chosen");
  });

  it("keeps the insertion as one undoable editor transaction", () => {
    const { editor, view } = renderEditor("Text", 4);
    fireEvent.keyDown(editor, { key: "l", code: "KeyL", altKey: true });
    expect(view.state.doc.toString()).toContain("[!lemma]");

    fireEvent.keyDown(editor, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(view.state.doc.toString()).toBe("Text");
    expect(view.state.selection.main.head).toBe(4);
  });
});

describe("LivePreviewBlockEditor formula source", () => {
  it("keeps exact delimiters visible and marks a misplaced display fence", () => {
    const malformed = String.raw`$$\begin{aligned}a&=x\\
b&=y\end{aligned}$$
$$`;
    const { view } = renderEditor(malformed, malformed.length);

    expect(view.state.doc.toString()).toBe(malformed);
    expect(document.querySelectorAll(".cm-live-latex-diagnostic"))
      .toHaveLength(2);
    const explanation = screen.getByRole("button", {
      name: /Markdown display fence.*fence metadata.*outside an alignment.*Press Enter to edit the highlighted source/i,
    });
    expect(explanation).toHaveTextContent("Markdown display fence");
    expect(explanation).toHaveTextContent("Line 1 · column 1");
    expect(explanation).toHaveTextContent(
      "Markdown treats LaTeX beside an opening $$ as fence metadata. In an aligned block this strips \\begin{aligned}, so KaTeX encounters & outside an alignment.",
    );
    expect(explanation).toHaveTextContent(
      "Put each $$ on its own line, with all LaTeX between them.",
    );
    expect(explanation.querySelector(".cm-live-latex-diagnostic-note__title"))
      .toBeInTheDocument();
    expect(explanation.querySelector(".cm-live-latex-diagnostic-note__action"))
      .toBeInTheDocument();

    fireEvent.pointerDown(explanation);
    expect(view.state.selection.main.head).toBe(0);
    expect(screen.queryByLabelText("Live formula preview")).not.toBeInTheDocument();
  });

  it("removes the inline explanation immediately after the formula is corrected", () => {
    const malformed = "$$x^2 + y^2\n$$";
    const { view } = renderEditor(malformed);
    expect(screen.getByText("Markdown display fence")).toBeVisible();

    const corrected = "$$\nx^2 + y^2\n$$";
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: corrected },
        selection: { anchor: corrected.indexOf("x^2") },
      });
    });

    expect(screen.queryByText("Markdown display fence")).not.toBeInTheDocument();
    expect(view.state.doc.toString()).toBe(corrected);
  });

  it("presents KaTeX parse failures with a concise repair action", () => {
    const malformed = String.raw`$\unknown{x}$`;
    const { view } = renderEditor(malformed, malformed.length);
    const explanation = screen.getByRole("button", {
      name: /LaTeX syntax error.*Undefined control sequence.*Check the highlighted command spelling.*Press Enter/i,
    });

    expect(explanation).toHaveTextContent("LaTeX syntax error");
    expect(explanation).toHaveTextContent("Undefined control sequence: \\unknown");
    expect(explanation).toHaveTextContent(
      "Check the highlighted command spelling or replace it with a KaTeX-supported command.",
    );
    fireEvent.keyDown(explanation, { key: "Enter" });
    expect(view.state.selection.main.head).toBe(1);
  });
});
