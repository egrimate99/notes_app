import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Landmark, LandmarkKind } from "../domain/types";

const repository = vi.hoisted(() => ({
  readNote: vi.fn(async (path: string) => ({
    path,
    markdown: "",
    revision: `revision:${path}`,
  })),
}));

vi.mock("../services/noteRepository", () => ({ noteRepository: repository }));
vi.mock("./MarkdownView", () => ({
  MarkdownView: ({ markdown }: { markdown: string }) => (
    <div data-testid="compiled-note">{markdown}</div>
  ),
}));

import { LandmarkPreviewContent } from "./LandmarkPreviewContent";

const mastery = { state: 0, explain: 0, derive: 0, apply: 0 };

function landmark(id: string, kind: LandmarkKind = "concept"): Landmark {
  return {
    id,
    title: kind === "concept" ? "Note" : "Formal result",
    kind,
    subjectIds: ["synthetic-field-02"],
    regionId: "foundations",
    summary: "",
    markdown: "",
    tags: [],
    status: "draft",
    mastery,
    contentPath: `content/Synthetic Field/${id}.md`,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("LandmarkPreviewContent direct Note editing", () => {
  it("turns the rendered paper into a controlled editor on a click gesture", () => {
    const note = landmark("click-edit");
    const onBeginNoteEdit = vi.fn();
    render(
      <LandmarkPreviewContent
        landmark={note}
        mode="note"
        previewMarkdown="Remember $x^2$."
        onBeginNoteEdit={onBeginNoteEdit}
        onSaveNote={vi.fn(async () => undefined)}
      />,
    );

    const paper = screen.getByRole("textbox", { name: "Edit note on canvas" });
    expect(paper).toHaveAttribute("aria-readonly", "true");
    expect(screen.getByTestId("compiled-note")).toHaveTextContent("Remember $x^2$.");
    fireEvent.pointerDown(paper, { button: 0 });

    const editor = screen.getByRole("textbox", { name: "Edit note on canvas" });
    expect(editor.tagName).toBe("TEXTAREA");
    expect(editor).toHaveValue("Remember $x^2$.");
    expect(onBeginNoteEdit).toHaveBeenCalledWith(note);

    fireEvent.change(editor, { target: { value: "Now $x^3$." } });
    expect(editor).toHaveValue("Now $x^3$.");
  });

  it("commits immediately when focus leaves and when Escape blurs the editor", async () => {
    const note = landmark("finish-edit");
    const onSaveNote = vi.fn(async () => undefined);
    render(
      <LandmarkPreviewContent
        landmark={note}
        mode="note"
        previewMarkdown="First"
        onSaveNote={onSaveNote}
      />,
    );
    await act(async () => Promise.resolve());

    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Edit note on canvas" }), { button: 0 });
    let editor = screen.getByRole("textbox", { name: "Edit note on canvas" });
    fireEvent.change(editor, { target: { value: "Saved on blur" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(onSaveNote).toHaveBeenCalledWith(note, "Saved on blur"));
    expect(screen.queryByRole("textbox", { name: "Edit note on canvas" })?.tagName).toBe("DIV");
    expect(screen.getByTestId("compiled-note")).toHaveTextContent("Saved on blur");

    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Edit note on canvas" }), { button: 0 });
    editor = screen.getByRole("textbox", { name: "Edit note on canvas" });
    fireEvent.change(editor, { target: { value: "Saved by Escape" } });
    editor.focus();
    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(onSaveNote).toHaveBeenLastCalledWith(note, "Saved by Escape"));
    expect(screen.getByRole("textbox", { name: "Edit note on canvas" }).tagName).toBe("DIV");
    expect(screen.getByTestId("compiled-note")).toHaveTextContent("Saved by Escape");
  });

  it("debounces background persistence while keeping every keystroke visible", async () => {
    vi.useFakeTimers();
    const note = landmark("debounced-edit");
    const onSaveNote = vi.fn(async () => undefined);
    render(
      <LandmarkPreviewContent
        landmark={note}
        mode="note"
        previewMarkdown=""
        onSaveNote={onSaveNote}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Edit note on canvas" }), { button: 0 });
    const editor = screen.getByRole("textbox", { name: "Edit note on canvas" });

    fireEvent.change(editor, { target: { value: "a" } });
    fireEvent.change(editor, { target: { value: "ab" } });
    expect(editor).toHaveValue("ab");
    act(() => vi.advanceTimersByTime(279));
    expect(onSaveNote).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(onSaveNote).toHaveBeenCalledOnce();
    expect(onSaveNote).toHaveBeenCalledWith(note, "ab");
  });

  it("auto-opens a newly created empty Note without placeholder copy", async () => {
    render(
      <LandmarkPreviewContent
        landmark={landmark("auto-edit")}
        mode="note"
        previewMarkdown=""
        autoEdit
        onSaveNote={vi.fn(async () => undefined)}
      />,
    );

    await waitFor(() => expect(
      screen.getByRole("textbox", { name: "Edit note on canvas" }).tagName,
    ).toBe("TEXTAREA"));
    const editor = screen.getByRole("textbox", { name: "Edit note on canvas" });
    expect(editor).toHaveValue("");
    expect(editor).not.toHaveAttribute("placeholder");
    expect(document.body).not.toHaveTextContent(/click here|start writing/i);
  });

  it("keeps hidden identity metadata out of the paper while preserving it on save", async () => {
    const note = landmark("metadata");
    const onSaveNote = vi.fn(async () => undefined);
    const source = "---\nid: metadata\nkind: concept\n---\nVisible body";
    render(
      <LandmarkPreviewContent
        landmark={note}
        mode="note"
        previewMarkdown={source}
        onSaveNote={onSaveNote}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Edit note on canvas" }), { button: 0 });
    const editor = screen.getByRole("textbox", { name: "Edit note on canvas" });
    expect(editor).toHaveValue("Visible body");
    expect(editor).not.toHaveValue(expect.stringContaining("id: metadata"));

    fireEvent.change(editor, { target: { value: "Rewritten directly" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(onSaveNote).toHaveBeenCalledWith(note, "Rewritten directly"));
  });

  it("flushes the final sub-debounce keystrokes if the paper unmounts", async () => {
    vi.useFakeTimers();
    const note = landmark("unmount-save");
    const onSaveNote = vi.fn(async () => undefined);
    const view = render(
      <LandmarkPreviewContent
        landmark={note}
        mode="note"
        previewMarkdown="Earlier"
        onSaveNote={onSaveNote}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Edit note on canvas" }), { button: 0 });
    fireEvent.change(screen.getByRole("textbox", { name: "Edit note on canvas" }), {
      target: { value: "Last instant" },
    });
    view.unmount();
    await act(async () => Promise.resolve());

    expect(onSaveNote).toHaveBeenCalledOnce();
    expect(onSaveNote).toHaveBeenCalledWith(note, "Last instant");
  });

  it("never turns formal landmarks into paper editors", () => {
    const onSaveNote = vi.fn(async () => undefined);
    render(
      <LandmarkPreviewContent
        landmark={landmark("formal", "theorem")}
        mode="note"
        previewMarkdown="> [!theorem]\n> A formal statement."
        autoEdit
        onSaveNote={onSaveNote}
      />,
    );

    expect(screen.getByTestId("compiled-note")).toHaveTextContent("A formal statement.");
    expect(screen.queryByRole("textbox", { name: "Edit note on canvas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onSaveNote).not.toHaveBeenCalled();
  });
});
