import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { InlineSourceEditor } from "./InlineSourceEditor";

beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
});

afterEach(cleanup);

function editorView(label: string) {
  const textbox = screen.getByRole("textbox", { name: label });
  const view = EditorView.findFromDOM(textbox);
  if (!view) throw new Error("CodeMirror view was not mounted.");
  return view;
}

describe("InlineSourceEditor", () => {
  it("uses Markdown parsing for blocks but keeps formula source language-neutral", () => {
    const callbacks = {
      onChange: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
    };
    const latex = render(
      <InlineSourceEditor
        value="\\alpha_1"
        mode="latex"
        autoFocus={false}
        {...callbacks}
      />,
    );

    expect(
      syntaxTree(editorView("Edit LaTeX source").state).topNode.name,
    ).toBe("");

    latex.unmount();
    render(
      <InlineSourceEditor
        value="# Heading"
        mode="markdown"
        autoFocus={false}
        {...callbacks}
      />,
    );

    expect(
      syntaxTree(editorView("Edit Markdown block").state).topNode.name,
    ).toBe("Document");
  });
});
