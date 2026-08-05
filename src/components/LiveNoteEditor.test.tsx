import "@testing-library/jest-dom/vitest";
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

const assets = vi.hoisted(() => ({
  storeImage: vi.fn(),
  readImage: vi.fn(),
}));

vi.mock("../services/assetRepository", () => ({
  assetRepository: assets,
  bytesToBase64: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
}));

import { LiveNoteEditor } from "./LiveNoteEditor";

beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [] as unknown as DOMRectList,
  });
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function viewFor(element: HTMLElement) {
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error("CodeMirror editor was not mounted");
  return view;
}

function replaceDocument(editor: HTMLElement, value: string) {
  const view = viewFor(editor);
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: value.length },
    });
  });
}

describe("LiveNoteEditor", () => {
  it("focuses a zero-length live-preview caret at the end for a just-created body", async () => {
    const onSave = vi.fn();
    render(
      <LiveNoteEditor
        noteId="notes/atlas-note-private.md"
        markdown={"Existing context\n\n"}
        onSave={onSave}
        debounceMs={60_000}
        initialEditAtEnd
      />,
    );

    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    await waitFor(() => expect(editor).toHaveFocus());
    replaceDocument(editor, "Follow-up with $x^2$.");
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      "Existing context\n\nFollow-up with $x^2$.",
    ));
  });

  it("reports disk-refresh safety only while clean and outside an edit session", async () => {
    const write = deferred();
    const onSafetyChange = vi.fn();
    render(
      <LiveNoteEditor
        noteId="safety.md"
        markdown="Original"
        onSave={() => write.promise}
        debounceMs={60_000}
        onRefreshSafetyChange={onSafetyChange}
      />,
    );

    await waitFor(() => expect(onSafetyChange).toHaveBeenLastCalledWith({
      noteId: "safety.md",
      canRefreshFromDisk: true,
      hasActiveEdit: false,
      saveStatus: "saved",
    }));

    fireEvent.click(screen.getByText("Original"));
    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    await waitFor(() => expect(onSafetyChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canRefreshFromDisk: false,
        hasActiveEdit: true,
        saveStatus: "saved",
      }),
    ));

    replaceDocument(editor, "Changed");
    await waitFor(() => expect(onSafetyChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canRefreshFromDisk: false,
        hasActiveEdit: true,
        saveStatus: "dirty",
      }),
    ));

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(onSafetyChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canRefreshFromDisk: false,
        hasActiveEdit: false,
        saveStatus: "saving",
      }),
    ));

    write.resolve();
    await waitFor(() => expect(onSafetyChange).toHaveBeenLastCalledWith({
      noteId: "safety.md",
      canRefreshFromDisk: true,
      hasActiveEdit: false,
      saveStatus: "saved",
    }));
  });

  it("stores pasted images and inserts a portable Markdown reference at the caret", async () => {
    const hash = "b".repeat(64);
    assets.storeImage.mockResolvedValue({
      path: `.assets/${hash}.png`,
      mediaType: "image/png",
      byteLength: 8,
      sha256: `sha256-${hash}`,
      deduplicated: false,
    });
    const file = {
      name: "decision boundary.png",
      type: "image/png",
      arrayBuffer: vi.fn(async () => Uint8Array.from([137, 80, 78, 71]).buffer),
    } as unknown as File;
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <LiveNoteEditor
        noteId="Synthetic Field/Models/Note.md"
        markdown="A useful diagram: "
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    fireEvent.click(screen.getByText("A useful diagram:"));
    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    const view = viewFor(editor);
    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    fireEvent.paste(editor, {
      clipboardData: { files: [file], getData: vi.fn(() => "") },
    });

    await waitFor(() => expect(assets.storeImage).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.state.doc.toString()).toContain(
      `![decision boundary](../../.assets/${hash}.png)`,
    ));
    expect(assets.storeImage).toHaveBeenCalledWith(expect.objectContaining({
      name: "decision boundary.png",
      mediaType: "image/png",
      bytes: expect.any(Uint8Array),
    }));
  });

  it("opens a real caret editor in the clicked block and returns to a typeset note", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <LiveNoteEditor
        noteId="empty.md"
        markdown=""
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(container.querySelector("textarea")).not.toBeInTheDocument();
    expect(container.querySelector(".live-edit-overlay")).not.toBeInTheDocument();

    replaceDocument(editor, "# Heading");
    expect(container.querySelector(".cm-live-heading--1")).toHaveTextContent("Heading");
    expect(container.querySelector(".cm-live-heading--1")).not.toHaveTextContent("#");

    replaceDocument(editor, "A paragraph");
    expect(editor).toHaveTextContent("A paragraph");

    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(container.querySelector(".markdown-view p")).toHaveTextContent("A paragraph");
  });

  it("keeps the selected formula compiled while its LaTeX body is edited", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const markdown = "Before $x+1$ after.";
    const { container } = render(
      <LiveNoteEditor
        noteId="formula.md"
        markdown={markdown}
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    const formulaHost = container.querySelector<HTMLElement>(".editable-math--inline")!;
    vi.spyOn(formulaHost, "getBoundingClientRect").mockReturnValue({
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
    fireEvent.click(container.querySelector(".katex")!, {
      clientX: 25,
      clientY: 10,
    });

    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    const view = viewFor(editor);
    expect(view.state.selection.main.head).toBe(markdown.indexOf("x+1") + 1);
    expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent("x+1");
    expect(Array.from(container.querySelectorAll(".cm-live-math-delimiter"))
      .map((delimiter) => delimiter.textContent)).toEqual(["$", "$"]);
    expect(screen.getByLabelText("Live formula preview")).toBeVisible();
    expect(screen.getByLabelText("Live formula preview").querySelector("annotation"))
      .toHaveTextContent("x+1");

    const formulaStart = markdown.indexOf("x+1");
    act(() => {
      view.dispatch({
        changes: { from: formulaStart, to: formulaStart + 3, insert: "y^2" },
        selection: { anchor: formulaStart + 3 },
      });
    });
    expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent("y^2");
    expect(screen.getByLabelText("Live formula preview").querySelector("annotation"))
      .toHaveTextContent("y^2");

    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith("Before $y^2$ after."),
    );

    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(container.querySelector(".markdown-view annotation")).toHaveTextContent("y^2");
  });

  it("finishes and commits the active block when the pointer leaves it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <LiveNoteEditor
        noteId="outside-click.md"
        markdown="Before $x$ after."
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    fireEvent.click(container.querySelector(".editable-math--inline .katex")!);
    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    const view = viewFor(editor);
    const formulaStart = "Before $".length;
    act(() => {
      view.dispatch({
        changes: { from: formulaStart, to: formulaStart + 1, insert: "x^2" },
        selection: { anchor: formulaStart + 3 },
      });
    });
    expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent("x^2");

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith("Before $x^2$ after."));
    expect(container.querySelector(".markdown-view annotation")).toHaveTextContent("x^2");
    expect(container.querySelector(".cm-live-latex-source")).not.toBeInTheDocument();
  });

  it("moves directly between formulae and keeps preview clicks in source editing", async () => {
    const { container } = render(
      <LiveNoteEditor
        noteId="formula-transition.md"
        markdown="First $x$, then $y^2$."
        onSave={vi.fn().mockResolvedValue(undefined)}
        debounceMs={60_000}
      />,
    );

    fireEvent.click(container.querySelector(".editable-math--inline .katex")!);
    await screen.findByRole("textbox", { name: "Edit paragraph" });
    expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent("x");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Edit formula" }));

    await waitFor(() =>
      expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent("y^2"),
    );
    expect(screen.getAllByLabelText("Edit formula")).toHaveLength(1);
    expect(screen.getByLabelText("Live formula preview").querySelector("annotation"))
      .toHaveTextContent("y^2");

    const preview = screen.getByRole("button", { name: "Live formula preview" });
    const previewInk = preview.querySelector<HTMLElement>(".katex-html")!;
    vi.spyOn(previewInk, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 20,
      top: 20,
      left: 100,
      right: 200,
      bottom: 40,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(preview, { clientX: 150, clientY: 30 });
    expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent("y^2");

    const editor = screen.getByRole("textbox", { name: "Edit paragraph" });
    const view = viewFor(editor);
    expect(view.state.selection.main.head).toBe("First $x$, then $".length + 2);
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    await waitFor(() =>
      expect(container.querySelector(".cm-live-latex-source")).not.toBeInTheDocument(),
    );
    expect(screen.getAllByRole("button", { name: "Edit formula" })).toHaveLength(2);
  });

  it("closes one block and enters a different block in a single click", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <LiveNoteEditor
        noteId="block-transition.md"
        markdown={"First paragraph.\n\nSecond paragraph."}
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    fireEvent.click(screen.getByText("First paragraph."));
    const firstEditor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    expect(firstEditor).toHaveTextContent("First paragraph.");

    const secondParagraph = screen.getByText("Second paragraph.");
    fireEvent.pointerDown(secondParagraph);
    fireEvent.click(secondParagraph);

    await waitFor(() => {
      const editor = screen.getByRole("textbox", { name: "Edit paragraph" });
      expect(editor).toHaveTextContent("Second paragraph.");
    });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("renders theorem callouts as an editable mathematical environment", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <LiveNoteEditor
        noteId="Public Fixture Note 023.md"
        markdown={"> [!theorem] Mercer\n> Every *positive kernel* has a representation $k(x,y)$."}
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    fireEvent.click(screen.getByText(/positive kernel/));
    const editor = await screen.findByRole("textbox", {
      name: "Edit mathematical environment",
    });
    expect(editor).toHaveTextContent(/Theorem\..*Mercer/);
    expect(editor).toHaveTextContent("positive kernel");
    expect(editor).not.toHaveTextContent("*positive kernel*");
    expect(container.querySelector(".cm-live-emphasis")).toHaveTextContent("positive kernel");
    expect(container.querySelector(".live-markdown-block.is-editing"))
      .toHaveAttribute("data-block-kind", "callout");
    expect(container.querySelector(".cm-compiled-math .katex")).toBeVisible();
  });

  it("keeps a multiline display formula in one live-preview editing session", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <LiveNoteEditor
        noteId="display.md"
        markdown={"$$\nx^2 + y^2\n$$"}
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit display LaTeX formula" }));
    await screen.findByRole("textbox", { name: "Edit math" });
    expect(container.querySelector(".cm-live-latex-source")).toHaveTextContent("x^2 + y^2");
    expect(screen.getByLabelText("Live formula preview").querySelector("annotation"))
      .toHaveTextContent("x^2 + y^2");
  });

  it("queues a reverted draft behind an older in-flight save, including on unmount", async () => {
    const firstWrite = deferred();
    const onSave = vi
      .fn<(markdown: string) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined);
    const rendered = render(
      <LiveNoteEditor
        noteId="race.md"
        markdown="Original"
        onSave={onSave}
        debounceMs={25}
      />,
    );

    fireEvent.click(screen.getByText("Original"));
    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });

    vi.useFakeTimers();
    replaceDocument(editor, "Intermediate");
    await act(async () => {
      vi.advanceTimersByTime(25);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenLastCalledWith("Intermediate");

    replaceDocument(editor, "Original");
    act(() => rendered.unmount());

    await act(async () => {
      firstWrite.resolve();
      await firstWrite.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave.mock.calls.map(([value]) => value)).toEqual([
      "Intermediate",
      "Original",
    ]);
  });

  it("shows a quiet retry control when persistence fails", async () => {
    const onSave = vi
      .fn<(markdown: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValue(undefined);
    render(
      <LiveNoteEditor
        noteId="retry.md"
        markdown="Original"
        onSave={onSave}
        debounceMs={60_000}
      />,
    );

    fireEvent.click(screen.getByText("Original"));
    const editor = await screen.findByRole("textbox", { name: "Edit paragraph" });
    replaceDocument(editor, "Changed");
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });

    const retry = await screen.findByRole("button", { name: "Save failed; retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(retry).not.toBeInTheDocument());
  });
});
