import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NoteEditor,
  type NoteEditorHandle,
  type NoteEditorSaveStatus,
} from "./NoteEditor";

describe("NoteEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps document edits inside CodeMirror and debounces persistence", async () => {
    const ref = createRef<NoteEditorHandle>();
    const onSave = vi.fn();
    const statuses: NoteEditorSaveStatus[] = [];
    render(
      <NoteEditor
        ref={ref}
        noteId="definition"
        initialMarkdown="A definition"
        onSave={onSave}
        onSaveStatusChange={(status) => statuses.push(status)}
      />,
    );

    act(() => ref.current?.replaceSelection("New: "));
    expect(ref.current?.getMarkdown()).toBe("New: A definition");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved");

    act(() => vi.advanceTimersByTime(649));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    await act(async () => Promise.resolve());

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith("New: A definition", "debounce");
    expect(statuses).toContain("dirty");
    expect(statuses).toContain("saving");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("inserts practical Markdown and LaTeX templates from the toolbar", () => {
    const ref = createRef<NoteEditorHandle>();
    render(
      <NoteEditor
        ref={ref}
        noteId="empty"
        initialMarkdown=""
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Definition" }));
    expect(ref.current?.getMarkdown()).toBe("> [!definition]\n> ");

    act(() => ref.current?.applyTemplate("display-math"));
    expect(ref.current?.getMarkdown()).toContain("$$\n\n$$");
  });

  it("saves immediately with Mod-S and only finishes after a successful Mod-E save", async () => {
    const ref = createRef<NoteEditorHandle>();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    const { container } = render(
      <NoteEditor
        ref={ref}
        noteId="shortcuts"
        initialMarkdown="x"
        onSave={onSave}
        onDone={onDone}
      />,
    );
    const content = container.querySelector<HTMLElement>(".cm-content");
    expect(content).not.toBeNull();

    act(() => ref.current?.replaceSelection("$y$"));
    fireEvent.keyDown(content!, { key: "s", ctrlKey: true });
    await act(async () => Promise.resolve());
    expect(onSave).toHaveBeenCalledWith("$y$x", "shortcut");

    act(() => ref.current?.replaceSelection("!"));
    fireEvent.keyDown(content!, { key: "e", ctrlKey: true });
    await act(async () => Promise.resolve());
    expect(onSave).toHaveBeenLastCalledWith("$y$!x", "done");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("flushes an unsaved document on unmount", async () => {
    const ref = createRef<NoteEditorHandle>();
    const onSave = vi.fn();
    const rendered = render(
      <NoteEditor
        ref={ref}
        noteId="unmount"
        initialMarkdown="before"
        onSave={onSave}
      />,
    );

    act(() => ref.current?.replaceSelection("after "));
    rendered.unmount();
    await act(async () => Promise.resolve());

    expect(onSave).toHaveBeenCalledWith("after before", "unmount");
  });

  it("flushes on blur and leaves a failed save visible for retry", async () => {
    const ref = createRef<NoteEditorHandle>();
    const onSave = vi.fn().mockRejectedValue(new Error("disk unavailable"));
    render(
      <NoteEditor
        ref={ref}
        noteId="blur"
        initialMarkdown="draft"
        onSave={onSave}
      />,
    );

    act(() => ref.current?.replaceSelection("edited "));
    fireEvent.blur(
      screen.getByRole("textbox", {
        name: "Markdown and LaTeX note editor",
      }),
    );
    await act(async () => Promise.resolve());

    expect(onSave).toHaveBeenCalledWith("edited draft", "blur");
    expect(screen.getByRole("status")).toHaveTextContent("Save failed");
  });
});
