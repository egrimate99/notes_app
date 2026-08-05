import { describe, expect, it, vi } from "vitest";
import {
  compactContentSelection,
  ContentMoveTransactionError,
  ContentOperationHistory,
  ContentTrashBatch,
  ContentTrashTransactionError,
  executeContentMoveTransaction,
  planContentDrop,
  reverseContentMoves,
  type ContentMove,
} from "./contentOperationHistory";
import type { DeletedContentReceipt } from "./noteRepository";

describe("content move planning", () => {
  it("deduplicates paths and removes descendants of selected directories", () => {
    expect(compactContentSelection([
      { path: "Fixture Subject/Parent Folder/Child Note.md", type: "file" },
      { path: "Fixture Subject/Parent Folder", type: "directory" },
      { path: "fixture subject/parent folder", type: "directory" },
      { path: "Standalone Note.md", type: "file" },
    ])).toEqual([
      { path: "Fixture Subject/Parent Folder", type: "directory" },
      { path: "Standalone Note.md", type: "file" },
    ]);
  });

  it("plans exact destination paths, preserving file extensions", () => {
    expect(planContentDrop([
      { path: "Fixture Subject/Source Note.md", type: "file" },
      { path: "Alternate Subject/Source Folder", type: "directory" },
    ], "Destination")).toEqual([
      {
        sourcePath: "Fixture Subject/Source Note.md",
        destinationPath: "Destination/Source Note.md",
        type: "file",
      },
      {
        sourcePath: "Alternate Subject/Source Folder",
        destinationPath: "Destination/Source Folder",
        type: "directory",
      },
    ]);
  });

  it("omits drops into the current parent", () => {
    expect(planContentDrop([
      { path: "Fixture Subject/Source Note.md", type: "file" },
    ], "Fixture Subject")).toEqual([]);
  });

  it("rejects a folder dropped into itself or one of its descendants", () => {
    expect(() => planContentDrop([
      { path: "Fixture Subject/Parent Folder", type: "directory" },
    ], "Fixture Subject/Parent Folder/Child Folder")).toThrow("inside itself");
    expect(() => planContentDrop([
      { path: "Fixture Subject/Parent Folder", type: "directory" },
    ], "Fixture Subject/Parent Folder")).toThrow("inside itself");
  });

  it("rejects duplicate destinations before touching the repository", () => {
    expect(() => planContentDrop([
      { path: "Input A/Same Name.md", type: "file" },
      { path: "Input B/same name.md", type: "file" },
    ], "Destination")).toThrow("same destination");
  });

  it("reverses both direction and order for undo", () => {
    const moves: ContentMove[] = [
      { sourcePath: "A/One.md", destinationPath: "B/One.md", type: "file" },
      { sourcePath: "A/Two.md", destinationPath: "B/Two.md", type: "file" },
    ];
    expect(reverseContentMoves(moves)).toEqual([
      { sourcePath: "B/Two.md", destinationPath: "A/Two.md", type: "file" },
      { sourcePath: "B/One.md", destinationPath: "A/One.md", type: "file" },
    ]);
  });
});

describe("executeContentMoveTransaction", () => {
  const moves: ContentMove[] = [
    { sourcePath: "A/One.md", destinationPath: "B/One.md", type: "file" },
    { sourcePath: "A/Two.md", destinationPath: "B/Two.md", type: "file" },
    { sourcePath: "A/Three.md", destinationPath: "B/Three.md", type: "file" },
  ];

  it("moves entries sequentially and returns repository results", async () => {
    const moveEntry = vi.fn(async (_source: string, destination: string) => ({
      path: destination,
      type: "file" as const,
    }));

    await expect(executeContentMoveTransaction({ moveEntry }, moves)).resolves.toEqual([
      { path: "B/One.md", type: "file" },
      { path: "B/Two.md", type: "file" },
      { path: "B/Three.md", type: "file" },
    ]);
    expect(moveEntry.mock.calls).toEqual([
      ["A/One.md", "B/One.md"],
      ["A/Two.md", "B/Two.md"],
      ["A/Three.md", "B/Three.md"],
    ]);
  });

  it("rolls completed entries back in reverse order after a failure", async () => {
    const failure = new Error("destination collision");
    const moveEntry = vi.fn(async (source: string, destination: string) => {
      if (source === "A/Three.md") throw failure;
      return { path: destination, type: "file" as const };
    });

    await expect(executeContentMoveTransaction({ moveEntry }, moves)).rejects.toBe(failure);
    expect(moveEntry.mock.calls).toEqual([
      ["A/One.md", "B/One.md"],
      ["A/Two.md", "B/Two.md"],
      ["A/Three.md", "B/Three.md"],
      ["B/Two.md", "A/Two.md"],
      ["B/One.md", "A/One.md"],
    ]);
  });

  it("reports exact unrecovered moves if rollback also fails", async () => {
    const moveEntry = vi.fn(async (source: string, destination: string) => {
      if (source === "A/Three.md") throw new Error("move failed");
      if (source === "B/One.md") throw new Error("rollback failed");
      return { path: destination, type: "file" as const };
    });

    const error = await executeContentMoveTransaction({ moveEntry }, moves)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContentMoveTransactionError);
    expect(error).toMatchObject({
      rollbackFailures: [{ move: moves[0] }],
      unrecoveredMoves: [moves[0]],
    });
  });
});

describe("ContentTrashBatch", () => {
  const receipt = (path: string, token: string): DeletedContentReceipt => ({
    path,
    originalPath: path,
    type: path.endsWith(".md") ? "file" : "directory",
    token,
    deletedAt: "2026-08-04T00:00:00.000Z",
  });

  it("soft-deletes compacted selections and restores them as one batch", async () => {
    let token = 0;
    const trashEntry = vi.fn(async (path: string) => receipt(path, `token-${++token}`));
    const restoreEntry = vi.fn(async (restoreToken: string) => ({
      path: restoreToken === "token-1" ? "Fixture Subject" : "Standalone Note.md",
      type: restoreToken === "token-1" ? "directory" as const : "file" as const,
    }));
    const batch = await ContentTrashBatch.fromLiveEntries(
      { trashEntry, restoreEntry },
      [
        { path: "Fixture Subject/Child Note.md", type: "file" },
        { path: "Fixture Subject", type: "directory" },
        { path: "Standalone Note.md", type: "file" },
      ],
    );

    expect(trashEntry.mock.calls).toEqual([["Fixture Subject"], ["Standalone Note.md"]]);
    await expect(batch.restore()).resolves.toHaveLength(2);
    expect(restoreEntry.mock.calls).toEqual([["token-1"], ["token-2"]]);
    expect(batch.state.every((item) => item.location === "live")).toBe(true);
  });

  it("rolls earlier trash operations back when a later one fails", async () => {
    const failure = new Error("file is locked");
    const trashEntry = vi.fn(async (path: string) => {
      if (path === "Two.md") throw failure;
      return receipt(path, "first-token");
    });
    const restoreEntry = vi.fn(async () => ({ path: "One.md", type: "file" as const }));

    await expect(ContentTrashBatch.fromLiveEntries(
      { trashEntry, restoreEntry },
      [
        { path: "One.md", type: "file" },
        { path: "Two.md", type: "file" },
      ],
    )).rejects.toBe(failure);
    expect(restoreEntry).toHaveBeenCalledWith("first-token");
  });

  it("refreshes tokens when a partial restore is compensated", async () => {
    const receipts = [receipt("One.md", "old-one"), receipt("Two.md", "old-two")];
    let secondRestoreFails = true;
    const restoreEntry = vi.fn(async (token: string) => {
      if (token === "old-two" && secondRestoreFails) throw new Error("path occupied");
      return {
        path: token.includes("one") ? "One.md" : "Two.md",
        type: "file" as const,
      };
    });
    const trashEntry = vi.fn(async (path: string) => receipt(path, "new-one"));
    const batch = ContentTrashBatch.fromReceipts({ trashEntry, restoreEntry }, receipts);

    await expect(batch.restore()).rejects.toThrow("path occupied");
    expect(batch.state).toEqual([
      expect.objectContaining({ path: "One.md", location: "trash", receipt: expect.objectContaining({ token: "new-one" }) }),
      expect.objectContaining({ path: "Two.md", location: "trash", receipt: expect.objectContaining({ token: "old-two" }) }),
    ]);

    secondRestoreFails = false;
    await expect(batch.restore()).resolves.toHaveLength(2);
    expect(restoreEntry.mock.calls.map(([token]) => token)).toEqual([
      "old-one",
      "old-two",
      "new-one",
      "old-two",
    ]);
  });

  it("exposes a retryable mixed state if compensation also fails", async () => {
    const receipts = [receipt("One.md", "one"), receipt("Two.md", "two")];
    const restoreEntry = vi.fn(async (token: string) => {
      if (token === "two") throw new Error("restore collision");
      return { path: "One.md", type: "file" as const };
    });
    const trashEntry = vi.fn(async () => { throw new Error("re-trash locked"); });
    const batch = ContentTrashBatch.fromReceipts({ trashEntry, restoreEntry }, receipts);

    const error = await batch.restore().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContentTrashTransactionError);
    expect(error).toMatchObject({ target: "live", batch });
    expect(batch.state).toEqual([
      expect.objectContaining({ path: "One.md", location: "live" }),
      expect.objectContaining({ path: "Two.md", location: "trash" }),
    ]);
  });
});

describe("ContentOperationHistory", () => {
  it("moves successful commands between undo and redo stacks", async () => {
    const history = new ContentOperationHistory();
    const undo = vi.fn(async () => undefined);
    const redo = vi.fn(async () => undefined);
    history.record({ label: "Rename note", undo, redo });

    expect(history.state).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: "Rename note",
    });
    await expect(history.undo()).resolves.toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(history.state).toMatchObject({
      canUndo: false,
      canRedo: true,
      redoLabel: "Rename note",
    });
    await expect(history.redo()).resolves.toBe(true);
    expect(redo).toHaveBeenCalledOnce();
    expect(history.state.canUndo).toBe(true);
  });

  it("keeps a command available when undo fails", async () => {
    const history = new ContentOperationHistory();
    const conflict = new Error("path occupied");
    history.record({
      label: "Move note",
      undo: vi.fn(async () => { throw conflict; }),
      redo: vi.fn(async () => undefined),
    });

    await expect(history.undo()).rejects.toBe(conflict);
    expect(history.state).toMatchObject({
      busy: false,
      canUndo: true,
      canRedo: false,
    });
  });

  it("ignores a second history request while the first is in flight", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const history = new ContentOperationHistory();
    history.record({
      label: "Move note",
      undo: () => pending,
      redo: vi.fn(async () => undefined),
    });

    const first = history.undo();
    expect(history.state.busy).toBe(true);
    await expect(history.undo()).resolves.toBe(false);
    release?.();
    await expect(first).resolves.toBe(true);
  });

  it("clears redo on a new operation and respects the history limit", async () => {
    const history = new ContentOperationHistory(2);
    const command = (label: string) => ({
      label,
      undo: vi.fn(async () => undefined),
      redo: vi.fn(async () => undefined),
    });
    const first = command("First");
    const second = command("Second");
    const third = command("Third");
    history.record(first);
    history.record(second);
    history.record(third);

    await history.undo();
    expect(history.state.redoLabel).toBe("Third");
    history.record(command("Replacement"));
    expect(history.state).toMatchObject({ canRedo: false, undoLabel: "Replacement" });

    await history.undo();
    await history.undo();
    await expect(history.undo()).resolves.toBe(false);
    expect(first.undo).not.toHaveBeenCalled();
    expect(second.undo).toHaveBeenCalledOnce();
  });

  it("publishes busy and stack changes to subscribers", async () => {
    const history = new ContentOperationHistory();
    const states: string[] = [];
    const unsubscribe = history.subscribe((state) => {
      states.push(`${state.busy}:${state.canUndo}:${state.canRedo}`);
    });
    history.record({
      label: "Create folder",
      undo: vi.fn(async () => undefined),
      redo: vi.fn(async () => undefined),
    });
    await history.undo();
    unsubscribe();

    expect(states).toEqual([
      "false:false:false",
      "false:true:false",
      "true:true:false",
      "false:false:true",
    ]);
  });
});
