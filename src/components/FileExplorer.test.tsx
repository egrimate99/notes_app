import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILE_EXPLORER_DRAG_MIME,
  FileExplorer,
  normalizedContentPath,
  selectionMoveRoots,
  type ContentTreeNode,
} from "./FileExplorer";
import {
  NOTE_FILE_DRAG_MIME,
  readNoteFileDragItems,
  readNoteFileDragPayload,
} from "../domain/noteDrag";

function fileActions() {
  return {
    createNote: vi.fn(async (parentPath: string, name: string) =>
      `${parentPath ? `${parentPath}/` : ""}${name}.md`),
    createFolder: vi.fn(async (parentPath: string, name: string) =>
      `${parentPath ? `${parentPath}/` : ""}${name}`),
    rename: vi.fn(async (path: string, name: string) =>
      `${path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : ""}${name}${path.toLocaleLowerCase().endsWith(".md") ? ".md" : ""}`),
    move: vi.fn(async (entries: readonly { path: string; destinationPath: string }[]) =>
      entries.map(({ destinationPath }) => destinationPath)),
    trash: vi.fn(async (path: string) => ({
      token: "4e38c477-b3c8-4dd8-a488-b049ad6b2952",
      deletedAt: "2026-08-04T00:00:00.000Z",
      originalPath: path,
      path,
      type: path.toLocaleLowerCase().endsWith(".md") ? "file" as const : "directory" as const,
    })),
    restore: vi.fn(async (receipt: { originalPath: string }) => receipt.originalPath),
    undo: vi.fn(async () => true),
    redo: vi.fn(async () => true),
    canUndo: true,
    canRedo: true,
  };
}

function mockDataTransfer() {
  const values = new Map<string, string>();
  const setDragImage = vi.fn();
  const dataTransfer = {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    get types() {
      return [...values.keys()];
    },
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    setDragImage,
  } as unknown as DataTransfer;
  return { dataTransfer, setDragImage, values };
}

const nodes: ContentTreeNode[] = [
  { name: "Empty Shelf", path: "Empty Shelf", type: "directory", children: [] },
  {
    name: "Demo Subject",
    path: "Demo Subject",
    type: "directory",
    children: [
      {
        name: "Sample Topic",
        path: "Demo Subject/Sample Topic",
        type: "directory",
        children: [
          {
            name: "Example Note.md",
            path: "Demo Subject/Sample Topic/Example Note.md",
            type: "file",
          },
        ],
      },
    ],
  },
  { name: "Archive Shelf", path: "Archive Shelf", type: "directory", children: [] },
  { name: "Reading Queue.MD", path: "Reading Queue.MD", type: "file" },
];

function SelectionDrivenExplorer({
  initialPath,
  onClear,
  withActions = false,
}: {
  initialPath: string;
  onClear: () => void;
  withActions?: boolean;
}) {
  const [selectedPath, setSelectedPath] = useState<string | undefined>(initialPath);
  const [actions] = useState(() => withActions ? fileActions() : undefined);
  return (
    <>
      <output data-testid="active-file">{selectedPath ?? "none"}</output>
      <button type="button" data-testid="external-file-clear" onClick={() => setSelectedPath(undefined)}>
        Clear active file externally
      </button>
      <FileExplorer
        nodes={nodes}
        selectedContentPath={selectedPath}
        onSelectFile={setSelectedPath}
        onClearActiveSelection={() => {
          onClear();
          setSelectedPath(undefined);
        }}
        actions={actions}
      />
    </>
  );
}

afterEach(cleanup);

describe("FileExplorer", () => {
  it("normalizes snapshot and Windows content paths", () => {
    expect(
      normalizedContentPath(
        "content\\Demo Subject\\Sample Topic\\Example Note.md",
      ),
    ).toBe(
      normalizedContentPath(
        "Demo Subject/Sample Topic/Example Note.md",
      ),
    );
  });

  it("shows real empty folders and reveals every ancestor of the selected file", () => {
    render(
      <FileExplorer
        nodes={nodes}
        selectedContentPath={
          "content\\Demo Subject\\Sample Topic\\Example Note.md"
        }
        onSelectFile={() => undefined}
      />,
    );

    expect(screen.getByRole("treeitem", { name: "Empty Shelf" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "Archive Shelf" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "Reading Queue" })).toBeVisible();
    expect(
      screen.getByRole("treeitem", { name: "Demo Subject" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: "Sample Topic" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: "Example Note" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.queryByRole("treeitem", { name: "Example Note.md" }),
    ).not.toBeInTheDocument();
  });

  it("collapses folders and selects files by their canonical relative path", async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    render(
      <FileExplorer
        nodes={nodes}
        selectedContentPath="Demo Subject/Sample Topic/Example Note.md"
        onSelectFile={onSelectFile}
      />,
    );

    await user.click(screen.getByRole("treeitem", { name: "Demo Subject" }));
    expect(
      screen.queryByRole("treeitem", { name: "Sample Topic" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("treeitem", { name: "Demo Subject" }));
    await user.click(
      screen.getByRole("treeitem", { name: "Example Note" }),
    );
    expect(onSelectFile).toHaveBeenCalledWith(
      "Demo Subject/Sample Topic/Example Note.md",
    );
  });

  it("publishes a repeatable copy payload when a note is dragged", () => {
    const onSelectFile = vi.fn();
    const { dataTransfer, setDragImage, values } = mockDataTransfer();

    render(
      <FileExplorer
        nodes={[
          {
            name: "Payload Note.md",
            path: "Fixture Subject/Payload Note.md",
            type: "file",
            id: "payload-note",
          },
        ]}
        onSelectFile={onSelectFile}
      />,
    );

    const row = screen.getByRole("treeitem", { name: "Payload Note" });
    expect(row).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(row, { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe("copyMove");
    expect(values.get("text/plain")).toBe("Fixture Subject/Payload Note.md");
    expect(values.has(NOTE_FILE_DRAG_MIME)).toBe(true);
    expect(values.has(FILE_EXPLORER_DRAG_MIME)).toBe(true);
    expect(readNoteFileDragPayload(dataTransfer)).toEqual({
      kind: "math-atlas-note",
      version: 1,
      path: "Fixture Subject/Payload Note.md",
      title: "Payload Note",
      noteId: "payload-note",
    });
    expect(setDragImage).toHaveBeenCalledOnce();
    expect(row).toHaveClass("is-dragging");

    fireEvent.dragEnd(row, { dataTransfer });
    expect(row).not.toHaveClass("is-dragging");
    fireEvent.click(row);
    expect(onSelectFile).toHaveBeenCalledWith("Fixture Subject/Payload Note.md");
  });

  it("expands a dragged folder into every descendant note for the canvas", () => {
    const { dataTransfer, setDragImage, values } = mockDataTransfer();
    const folderNodes: ContentTreeNode[] = [{
      name: "Topic Folder",
      path: "Fixture Subject/Topic Folder",
      type: "directory",
      children: [
        {
          name: "First Note.md",
          path: "Fixture Subject/Topic Folder/First Note.md",
          type: "file",
          id: "first-note",
        },
        {
          name: "Nested Topic",
          path: "Fixture Subject/Topic Folder/Nested Topic",
          type: "directory",
          children: [{
            name: "Second Note.md",
            path: "Fixture Subject/Topic Folder/Nested Topic/Second Note.md",
            type: "file",
          }],
        },
      ],
    }];

    render(
      <FileExplorer
        nodes={folderNodes}
        onSelectFile={() => undefined}
        actions={fileActions()}
      />,
    );

    fireEvent.dragStart(screen.getByRole("treeitem", { name: "Topic Folder" }), {
      dataTransfer,
    });

    expect(values.has(NOTE_FILE_DRAG_MIME)).toBe(true);
    expect(readNoteFileDragItems(dataTransfer)).toEqual([
      {
        path: "Fixture Subject/Topic Folder/First Note.md",
        title: "First Note",
        noteId: "first-note",
      },
      {
        path: "Fixture Subject/Topic Folder/Nested Topic/Second Note.md",
        title: "Second Note",
      },
    ]);
    expect(values.get("text/plain")).toBe([
      "Fixture Subject/Topic Folder/First Note.md",
      "Fixture Subject/Topic Folder/Nested Topic/Second Note.md",
    ].join("\n"));
    expect(dataTransfer.effectAllowed).toBe("copyMove");
    expect(setDragImage).toHaveBeenCalledOnce();
  });

  it("carries every selected note when one selected row is dragged", () => {
    const { dataTransfer, setDragImage } = mockDataTransfer();
    const noteNodes: ContentTreeNode[] = [
      { name: "Alpha Note.md", path: "Fixture Subject/Alpha Note.md", type: "file", id: "alpha-note" },
      { name: "Beta Note.md", path: "Fixture Subject/Beta Note.md", type: "file", id: "beta-note" },
      { name: "Gamma Note.md", path: "Fixture Subject/Gamma Note.md", type: "file", id: "gamma-note" },
    ];
    render(<FileExplorer nodes={noteNodes} onSelectFile={() => undefined} />);
    const alphaNote = screen.getByRole("treeitem", { name: "Alpha Note" });
    const betaNote = screen.getByRole("treeitem", { name: "Beta Note" });

    fireEvent.click(alphaNote);
    fireEvent.click(betaNote, { ctrlKey: true });
    fireEvent.dragStart(alphaNote, { dataTransfer });

    expect(readNoteFileDragItems(dataTransfer)).toEqual([
      { path: "Fixture Subject/Alpha Note.md", title: "Alpha Note", noteId: "alpha-note" },
      { path: "Fixture Subject/Beta Note.md", title: "Beta Note", noteId: "beta-note" },
    ]);
    expect(setDragImage).toHaveBeenCalledOnce();
    expect(alphaNote).toHaveClass("is-dragging");
    expect(betaNote).toHaveClass("is-dragging");
  });

  it("makes folders draggable only when filesystem moves are available", () => {
    const { rerender } = render(
      <FileExplorer nodes={nodes} onSelectFile={() => undefined} />,
    );

    expect(screen.getByRole("treeitem", { name: "Empty Shelf" })).toHaveAttribute(
      "draggable",
      "false",
    );

    rerender(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={fileActions()}
      />,
    );
    expect(screen.getByRole("treeitem", { name: "Empty Shelf" })).toHaveAttribute(
      "draggable",
      "true",
    );
  });

  it("supports replace, toggle, range, additive range, and background clearing", () => {
    render(<FileExplorer nodes={nodes} onSelectFile={() => undefined} />);
    const emptyShelf = screen.getByRole("treeitem", { name: "Empty Shelf" });
    const demoSubject = screen.getByRole("treeitem", { name: "Demo Subject" });
    const archiveShelf = screen.getByRole("treeitem", { name: "Archive Shelf" });
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });

    fireEvent.click(emptyShelf);
    expect(emptyShelf).toHaveAttribute("aria-selected", "true");

    fireEvent.click(archiveShelf, { ctrlKey: true });
    expect(emptyShelf).toHaveAttribute("aria-selected", "true");
    expect(archiveShelf).toHaveAttribute("aria-selected", "true");

    fireEvent.click(readingQueue, { shiftKey: true });
    expect(emptyShelf).toHaveAttribute("aria-selected", "false");
    expect(archiveShelf).toHaveAttribute("aria-selected", "true");
    expect(readingQueue).toHaveAttribute("aria-selected", "true");

    fireEvent.click(emptyShelf);
    fireEvent.click(readingQueue, { ctrlKey: true, shiftKey: true });
    for (const row of [emptyShelf, demoSubject, archiveShelf, readingQueue]) {
      expect(row).toHaveAttribute("aria-selected", "true");
    }

    fireEvent.click(screen.getByRole("tree", { name: "Files" }));
    for (const row of [emptyShelf, demoSubject, archiveShelf, readingQueue]) {
      expect(row).toHaveAttribute("aria-selected", "false");
    }
  });

  it("supports keyboard range selection, select all, toggling, and clearing", () => {
    render(<FileExplorer nodes={nodes} onSelectFile={() => undefined} />);
    const emptyShelf = screen.getByRole("treeitem", { name: "Empty Shelf" });
    fireEvent.click(emptyShelf);

    fireEvent.keyDown(emptyShelf, { key: "ArrowDown", shiftKey: true });
    const demoSubject = screen.getByRole("treeitem", { name: "Demo Subject" });
    expect(demoSubject).toHaveFocus();
    expect(emptyShelf).toHaveAttribute("aria-selected", "true");
    expect(demoSubject).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(demoSubject, { key: "a", ctrlKey: true });
    expect(screen.getAllByRole("treeitem").every((row) => row.getAttribute("aria-selected") === "true")).toBe(true);

    fireEvent.keyDown(demoSubject, { key: " ", ctrlKey: true });
    expect(demoSubject).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(demoSubject, { key: "Escape" });
    expect(screen.getAllByRole("treeitem").every((row) => row.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("clears the active note when blank explorer space or Escape removes its selection", () => {
    const onClear = vi.fn();
    const { unmount } = render(
      <SelectionDrivenExplorer initialPath="Reading Queue.MD" onClear={onClear} />,
    );
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    expect(readingQueue).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tree", { name: "Files" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-file")).toHaveTextContent("none");
    expect(readingQueue).toHaveAttribute("aria-selected", "false");

    unmount();
    onClear.mockClear();
    render(<SelectionDrivenExplorer initialPath="Reading Queue.MD" onClear={onClear} />);
    const reopenedQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    fireEvent.keyDown(reopenedQueue, { key: "Escape" });
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-file")).toHaveTextContent("none");
    expect(reopenedQueue).toHaveAttribute("aria-selected", "false");
  });

  it("clears an active note even while its path is absent from the current tree", () => {
    const onClear = vi.fn();
    render(<SelectionDrivenExplorer initialPath="Pending Shelf/Not Loaded Yet.md" onClear={onClear} />);

    fireEvent.click(screen.getByRole("tree", { name: "Files" }));

    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-file")).toHaveTextContent("none");
  });

  it("clears the active note while preserving a replacement directory selection", () => {
    const onClear = vi.fn();
    render(<SelectionDrivenExplorer initialPath="Reading Queue.MD" onClear={onClear} />);

    const directory = screen.getByRole("treeitem", { name: "Archive Shelf" });
    fireEvent.click(directory);

    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-file")).toHaveTextContent("none");
    expect(directory).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("treeitem", { name: "Reading Queue" }))
      .toHaveAttribute("aria-selected", "false");
  });

  it("clears the active note when its row is additively toggled off", () => {
    const onClear = vi.fn();
    render(<SelectionDrivenExplorer initialPath="Reading Queue.MD" onClear={onClear} />);
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });

    fireEvent.click(readingQueue, { ctrlKey: true });

    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-file")).toHaveTextContent("none");
    expect(readingQueue).toHaveAttribute("aria-selected", "false");
  });

  it("clears the old note when a context click selects a different directory", () => {
    const onClear = vi.fn();
    render(
      <SelectionDrivenExplorer
        initialPath="Reading Queue.MD"
        onClear={onClear}
        withActions
      />,
    );

    const directory = screen.getByRole("treeitem", { name: "Archive Shelf" });
    fireEvent.contextMenu(directory, { clientX: 120, clientY: 90 });

    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-file")).toHaveTextContent("none");
    expect(directory).toHaveAttribute("aria-selected", "true");
  });

  it("does not leak a local clear across a batched direct note switch", () => {
    const onClear = vi.fn();
    render(
      <SelectionDrivenExplorer
        initialPath="Demo Subject/Sample Topic/Example Note.md"
        onClear={onClear}
      />,
    );
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    const emptyShelf = screen.getByRole("treeitem", { name: "Empty Shelf" });
    const exampleNote = screen.getByRole("treeitem", { name: "Example Note" });
    fireEvent.click(readingQueue);
    fireEvent.click(emptyShelf, { ctrlKey: true });

    fireEvent.click(exampleNote, { shiftKey: true });
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-file")).toHaveTextContent(
      "Demo Subject/Sample Topic/Example Note.md",
    );

    fireEvent.click(screen.getByTestId("external-file-clear"));
    expect(screen.getAllByRole("treeitem").every(
      (row) => row.getAttribute("aria-selected") === "false",
    )).toBe(true);
  });

  it("moves a compacted file and folder selection onto folders", async () => {
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );

    const demoSubject = screen.getByRole("treeitem", { name: "Demo Subject" });
    fireEvent.click(demoSubject);
    const sampleTopic = screen.getByRole("treeitem", { name: "Sample Topic" });
    fireEvent.click(sampleTopic, { ctrlKey: true });

    const { dataTransfer, values } = mockDataTransfer();
    fireEvent.dragStart(demoSubject, { dataTransfer });
    expect(values.has(FILE_EXPLORER_DRAG_MIME)).toBe(true);
    fireEvent.dragOver(screen.getByRole("treeitem", { name: "Empty Shelf" }), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(screen.getByRole("treeitem", { name: "Empty Shelf" }), { dataTransfer });

    await waitFor(() => {
      expect(actions.move).toHaveBeenCalledWith([
        {
          path: "Demo Subject",
          destinationPath: "Empty Shelf/Demo Subject",
        },
      ]);
    });
  });

  it("keeps same-window drags working while DataTransfer contents are protected", async () => {
    const actions = fileActions();
    render(<FileExplorer nodes={nodes} onSelectFile={() => undefined} actions={actions} />);
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    const emptyShelf = screen.getByRole("treeitem", { name: "Empty Shelf" });
    const { dataTransfer } = mockDataTransfer();
    fireEvent.dragStart(readingQueue, { dataTransfer });
    dataTransfer.getData = vi.fn(() => {
      throw new Error("Protected until drop");
    });

    fireEvent.dragOver(emptyShelf, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(emptyShelf, { dataTransfer });
    await waitFor(() => expect(actions.move).toHaveBeenCalledWith([{
      path: "Reading Queue.MD",
      destinationPath: "Empty Shelf/Reading Queue.MD",
    }]));
  });

  it("rejects drops of a folder into itself or one of its descendants", () => {
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );
    const demoSubject = screen.getByRole("treeitem", { name: "Demo Subject" });
    fireEvent.click(demoSubject);
    const sampleTopic = screen.getByRole("treeitem", { name: "Sample Topic" });
    const { dataTransfer } = mockDataTransfer();
    fireEvent.dragStart(demoSubject, { dataTransfer });
    fireEvent.dragOver(sampleTopic, { dataTransfer });
    fireEvent.drop(sampleTopic, { dataTransfer });
    expect(actions.move).not.toHaveBeenCalled();
  });

  it("drops a file row into its parent folder with an exact proxy highlight", async () => {
    const actions = fileActions();
    const proxyNodes: ContentTreeNode[] = [
      { name: "Source.md", path: "Source.md", type: "file" },
      {
        name: "Target",
        path: "Target",
        type: "directory",
        children: [{ name: "Pin.md", path: "Target/Pin.md", type: "file" }],
      },
    ];
    render(<FileExplorer nodes={proxyNodes} onSelectFile={() => undefined} actions={actions} />);
    fireEvent.click(screen.getByRole("treeitem", { name: "Target" }));
    const source = screen.getByRole("treeitem", { name: "Source" });
    const pin = screen.getByRole("treeitem", { name: "Pin" });
    const { dataTransfer } = mockDataTransfer();

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnter(pin, { dataTransfer });
    expect(pin).toHaveClass("is-drop-target", "is-parent-drop-target");
    expect(screen.getByRole("status")).toHaveTextContent("Move → Target");
    fireEvent.drop(pin, { dataTransfer });

    await waitFor(() => expect(actions.move).toHaveBeenCalledWith([
      { path: "Source.md", destinationPath: "Target/Source.md" },
    ]));
  });

  it("opens a collapsed destination while hovering and keeps the folder as the destination", () => {
    vi.useFakeTimers();
    try {
      const actions = fileActions();
      const hoverNodes: ContentTreeNode[] = [
        { name: "Source.md", path: "Source.md", type: "file" },
        {
          name: "Archive",
          path: "Archive",
          type: "directory",
          children: [{ name: "Existing.md", path: "Archive/Existing.md", type: "file" }],
        },
      ];
      render(<FileExplorer nodes={hoverNodes} onSelectFile={() => undefined} actions={actions} />);
      const source = screen.getByRole("treeitem", { name: "Source" });
      const archive = screen.getByRole("treeitem", { name: "Archive" });
      const { dataTransfer } = mockDataTransfer();
      expect(archive).toHaveAttribute("aria-expanded", "false");

      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(archive, { dataTransfer });
      act(() => vi.advanceTimersByTime(520));

      expect(archive).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("treeitem", { name: "Existing" })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves nested items to the Files root through the transient root target", async () => {
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        selectedContentPath="Demo Subject/Sample Topic/Example Note.md"
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );
    const exampleNote = screen.getByRole("treeitem", { name: "Example Note" });
    const { dataTransfer } = mockDataTransfer();
    fireEvent.dragStart(exampleNote, { dataTransfer });
    const rootTarget = screen.getByLabelText("Move selection to Files root");
    fireEvent.dragOver(rootTarget, { dataTransfer });
    expect(rootTarget).toHaveClass("is-active");
    fireEvent.drop(rootTarget, { dataTransfer });

    await waitFor(() => expect(actions.move).toHaveBeenCalledWith([{
      path: "Demo Subject/Sample Topic/Example Note.md",
      destinationPath: "Example Note.md",
    }]));
  });

  it("clears every drag affordance on cancellation without moving anything", () => {
    const actions = fileActions();
    render(<FileExplorer nodes={nodes} onSelectFile={() => undefined} actions={actions} />);
    const emptyShelf = screen.getByRole("treeitem", { name: "Empty Shelf" });
    const archiveShelf = screen.getByRole("treeitem", { name: "Archive Shelf" });
    const { dataTransfer } = mockDataTransfer();
    fireEvent.dragStart(emptyShelf, { dataTransfer });
    fireEvent.dragOver(archiveShelf, { dataTransfer });
    expect(emptyShelf).toHaveClass("is-dragging");
    expect(archiveShelf).toHaveClass("is-drop-target");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(emptyShelf).not.toHaveClass("is-dragging");
    expect(archiveShelf).not.toHaveClass("is-drop-target");
    expect(screen.queryByLabelText("Move selection to Files root")).not.toBeInTheDocument();
    expect(actions.move).not.toHaveBeenCalled();
  });

  it("rejects destination collisions before invoking the repository", () => {
    const actions = fileActions();
    const collisionNodes: ContentTreeNode[] = [
      { name: "Result.md", path: "Result.md", type: "file" },
      {
        name: "Archive",
        path: "Archive",
        type: "directory",
        children: [{ name: "Result.md", path: "Archive/Result.md", type: "file" }],
      },
    ];
    render(<FileExplorer nodes={collisionNodes} onSelectFile={() => undefined} actions={actions} />);
    const result = screen.getByRole("treeitem", { name: "Result" });
    const archive = screen.getByRole("treeitem", { name: "Archive" });
    const { dataTransfer } = mockDataTransfer();
    fireEvent.dragStart(result, { dataTransfer });
    fireEvent.dragOver(archive, { dataTransfer });
    expect(archive).toHaveClass("is-invalid-drop-target");
    expect(screen.getByRole("status")).toHaveTextContent("already exists there");
    fireEvent.drop(archive, { dataTransfer });
    expect(actions.move).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("already exists there");
  });

  it("routes explorer undo and redo shortcuts without hijacking text input undo", async () => {
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    const explorer = readingQueue.closest<HTMLElement>(".file-explorer")!;
    readingQueue.focus();
    fireEvent.keyDown(readingQueue, { key: "z", ctrlKey: true });
    await waitFor(() => expect(actions.undo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(explorer).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
    });
    await waitFor(() => expect(actions.redo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(explorer).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "y", ctrlKey: true });
    await waitFor(() => expect(actions.redo).toHaveBeenCalledTimes(2));

    readingQueue.focus();
    fireEvent.keyDown(readingQueue, { key: "F2" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename" }), {
      key: "z",
      ctrlKey: true,
    });
    expect(actions.undo).toHaveBeenCalledTimes(1);
  });

  it("restores real DOM focus after an unchanged inline rename so Ctrl Z stays in file history", async () => {
    const actions = fileActions();
    const stableNodes: ContentTreeNode[] = [{
      name: "Draft.md",
      path: "Draft.md",
      type: "file",
    }];
    render(
      <FileExplorer
        nodes={stableNodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );

    const draft = screen.getByRole("treeitem", { name: "Draft" });
    draft.focus();
    fireEvent.keyDown(draft, { key: "F2" });
    const rename = screen.getByRole("textbox", { name: "Rename" });
    await waitFor(() => expect(rename).toHaveFocus());
    fireEvent.submit(rename.closest("form")!);

    await waitFor(() => expect(
      screen.getByRole("treeitem", { name: "Draft" }),
    ).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "z",
      ctrlKey: true,
    });
    await waitFor(() => expect(actions.undo).toHaveBeenCalledOnce());
  });

  it("returns focus to the originating explorer control when inline editing is cancelled", async () => {
    const user = userEvent.setup();
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );

    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    readingQueue.focus();
    fireEvent.keyDown(readingQueue, { key: "F2" });
    const rename = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.keyDown(rename, { key: "Escape" });
    await waitFor(() => expect(
      screen.getByRole("treeitem", { name: "Reading Queue" }),
    ).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "New note" }));
    const create = screen.getByRole("textbox", { name: "New note name" });
    fireEvent.keyDown(create, { key: "Escape" });
    await waitFor(() => expect(
      screen.getByRole("tree", { name: "Files" }).closest(".file-explorer"),
    ).toHaveFocus());
  });

  it("removes descendants when a selected folder already contains them", () => {
    expect(selectionMoveRoots([
      "Demo Subject/Sample Topic/Example Note.md",
      "Demo Subject",
      "Archive Shelf",
      "Archive Shelf",
    ])).toEqual(["Demo Subject", "Archive Shelf"]);
  });

  it("supports explorer-style arrow navigation", () => {
    render(<FileExplorer nodes={nodes} onSelectFile={() => undefined} />);
    const demoSubject = screen.getByRole("treeitem", {
      name: "Demo Subject",
    });
    demoSubject.focus();

    fireEvent.keyDown(demoSubject, { key: "ArrowRight" });
    expect(demoSubject).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(demoSubject, { key: "ArrowRight" });
    expect(
      screen.getByRole("treeitem", { name: "Sample Topic" }),
    ).toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowRight",
    });
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowRight",
    });
    expect(
      screen.getByRole("treeitem", { name: "Example Note" }),
    ).toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowLeft",
    });
    expect(
      screen.getByRole("treeitem", { name: "Sample Topic" }),
    ).toHaveFocus();
  });

  it("creates notes and folders inline without exposing the Markdown suffix", async () => {
    const user = userEvent.setup();
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New note" }));
    const noteName = screen.getByRole("textbox", { name: "New note name" });
    await user.clear(noteName);
    await user.type(noteName, "Created Note.md{Enter}");
    expect(actions.createNote).toHaveBeenCalledWith("", "Created Note");

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Demo Subject" }), {
      clientX: 120,
      clientY: 90,
    });
    await user.click(screen.getByRole("menuitem", { name: /New folder/ }));
    const folderName = screen.getByRole("textbox", { name: "New folder name" });
    await user.clear(folderName);
    await user.type(folderName, "Created Folder{Enter}");
    expect(actions.createFolder).toHaveBeenCalledWith("Demo Subject", "Created Folder");
  });

  it("supports F2 rename and validates names before calling the repository", async () => {
    const user = userEvent.setup();
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    readingQueue.focus();
    fireEvent.keyDown(readingQueue, { key: "F2" });

    const rename = screen.getByRole("textbox", { name: "Rename" });
    await user.clear(rename);
    await user.type(rename, "Bad/name{Enter}");
    expect(actions.rename).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("reserved character");

    await user.clear(rename);
    await user.type(rename, "Research queue.md{Enter}");
    expect(actions.rename).toHaveBeenCalledWith("Reading Queue.MD", "Research queue");
  });

  it("requires confirmation before soft-delete and offers an immediate undo", async () => {
    const user = userEvent.setup();
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );
    const readingQueue = screen.getByRole("treeitem", { name: "Reading Queue" });
    readingQueue.focus();
    fireEvent.keyDown(readingQueue, { key: "Delete" });

    const dialog = screen.getByRole("alertdialog", {
      name: "Move “Reading Queue” to Trash?",
    });
    expect(dialog).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
    expect(actions.trash).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(actions.trash).toHaveBeenCalledWith("Reading Queue.MD");
    expect(screen.getByRole("status")).toHaveTextContent("Reading Queue moved to Trash");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(actions.undo).toHaveBeenCalledOnce();
    expect(actions.restore).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("confirms and trashes the compacted multi-selection", async () => {
    const user = userEvent.setup();
    const actions = fileActions();
    render(
      <FileExplorer
        nodes={nodes}
        onSelectFile={() => undefined}
        actions={actions}
      />,
    );
    const emptyShelf = screen.getByRole("treeitem", { name: "Empty Shelf" });
    const archiveShelf = screen.getByRole("treeitem", { name: "Archive Shelf" });
    fireEvent.click(emptyShelf);
    fireEvent.click(archiveShelf, { ctrlKey: true });
    fireEvent.keyDown(archiveShelf, { key: "Delete" });

    expect(screen.getByRole("alertdialog", {
      name: "Move 2 items to Trash?",
    })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(actions.trash).toHaveBeenNthCalledWith(1, "Empty Shelf");
    expect(actions.trash).toHaveBeenNthCalledWith(2, "Archive Shelf");
    expect(screen.getByRole("status")).toHaveTextContent("2 items moved to Trash");
  });
});
