import "@testing-library/jest-dom/vitest";
import { startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWikiLinkIndex } from "../domain/wikiLinks";
import { LivePreviewBlockEditor } from "./LivePreviewBlockEditor";

beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [] as unknown as DOMRectList,
  });
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

afterEach(cleanup);

const wikiLinkIndex = buildWikiLinkIndex([
  "Subject Alpha/Topic One/Shared Concept.md",
  "Subject Alpha/Topic Two/Basics/Shared Concept.md",
  "Subject Beta/Standalone Concept.md",
]);

function renderEditor(value = "See [[") {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const onSave = vi.fn();
  render(
    <LivePreviewBlockEditor
      value={value}
      kind="paragraph"
      initialCursor={value.length}
      onChange={onChange}
      onSave={onSave}
      onClose={onClose}
      wikiLinkIndex={wikiLinkIndex}
      currentNotePath="Subject Alpha/Topic One/Sequence.md"
    />,
  );
  const editor = screen.getByRole("textbox", { name: "Edit paragraph" });
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error("CodeMirror editor was not mounted");
  return { editor, onChange, onClose, onSave, view };
}

async function openSharedConceptCompletion(view: EditorView) {
  act(() => {
    const position = view.state.selection.main.head;
    view.dispatch({
      changes: { from: position, insert: "Shar" },
      selection: { anchor: position + 4 },
      userEvent: "input.type",
    });
    startCompletion(view);
  });
  await waitFor(() => {
    expect(document.querySelector(".cm-tooltip-autocomplete")).toBeInTheDocument();
  });
}

describe("LivePreviewBlockEditor wikilink completion keyboard", () => {
  it.each([
    ["Enter", "Enter"],
    ["Tab", "Tab"],
  ])("accepts the selected note with %s before editor commands run", async (key, code) => {
    const { editor, onChange, view } = renderEditor();
    await openSharedConceptCompletion(view);

    fireEvent.keyDown(editor, { key, code });

    const expected =
      "See [[Subject Alpha/Topic One/Shared Concept|Shared Concept]]";
    await waitFor(() => expect(view.state.doc.toString()).toBe(expected));
    expect(view.state.doc.toString()).not.toContain("\n");
    expect(onChange).toHaveBeenLastCalledWith(expected);
    expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeInTheDocument();
  });

  it("dismisses the completion with Escape before closing the editor", async () => {
    const { editor, onClose, onSave, view } = renderEditor();
    await openSharedConceptCompletion(view);

    fireEvent.keyDown(editor, { key: "Escape", code: "Escape" });

    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeInTheDocument();
    });
    expect(view.state.doc.toString()).toBe("See [[Shar");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: "Escape", code: "Escape" });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("still inserts a newline with Enter when no completion is open", () => {
    const { editor, view } = renderEditor("Plain text");

    fireEvent.keyDown(editor, { key: "Enter", code: "Enter" });

    expect(view.state.doc.toString()).toBe("Plain text\n");
  });
});
