import type {
  ContentEntryKind,
  ContentMutationResult,
  DeletedContentReceipt,
  NoteRepository,
} from "./noteRepository";

/** A filesystem item selected in the explorer. */
export interface ContentSelectionEntry {
  path: string;
  type: ContentEntryKind;
}

/** One exact, reversible filesystem move. */
export interface ContentMove {
  sourcePath: string;
  destinationPath: string;
  type: ContentEntryKind;
}

export interface ContentMoveRollbackFailure {
  move: ContentMove;
  error: unknown;
}

/**
 * Thrown only when a multi-item move failed and at least one already-applied
 * move could not be rolled back. Callers should refresh the content tree; the
 * paths in `unrecoveredMoves` describe the entries that remain at their
 * destination paths.
 */
export class ContentMoveTransactionError extends Error {
  constructor(
    message: string,
    public readonly operationError: unknown,
    public readonly rollbackFailures: readonly ContentMoveRollbackFailure[],
    public readonly unrecoveredMoves: readonly ContentMove[],
  ) {
    super(message);
    this.name = "ContentMoveTransactionError";
  }
}

function comparisonPath(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .toLocaleLowerCase();
}

function isDescendantPath(candidate: string, ancestor: string) {
  const candidateKey = comparisonPath(candidate);
  const ancestorKey = comparisonPath(ancestor);
  return candidateKey.startsWith(`${ancestorKey}/`);
}

function leafName(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function childPath(parent: string, leaf: string) {
  const normalizedParent = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedParent ? `${normalizedParent}/${leaf}` : leaf;
}

/**
 * Removes duplicates and descendants of selected directories. This prevents a
 * folder and one of its children from being moved twice by the same gesture.
 * Input order is preserved so keyboard/tree selection order remains stable.
 */
export function compactContentSelection(
  entries: readonly ContentSelectionEntry[],
): ContentSelectionEntry[] {
  const unique: ContentSelectionEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = comparisonPath(entry.path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  return unique.filter((entry) => !unique.some((possibleAncestor) => (
    possibleAncestor !== entry &&
    possibleAncestor.type === "directory" &&
    isDescendantPath(entry.path, possibleAncestor.path)
  )));
}

/**
 * Builds exact source/destination pairs for dropping selected items into a
 * folder. No-op moves are omitted. Disk collisions remain the repository's
 * responsibility, but duplicate destinations inside the batch are rejected
 * before the first filesystem mutation.
 */
export function planContentDrop(
  entries: readonly ContentSelectionEntry[],
  destinationDirectory: string,
): ContentMove[] {
  const destinationKey = comparisonPath(destinationDirectory);
  const moves = compactContentSelection(entries).flatMap((entry): ContentMove[] => {
    if (
      entry.type === "directory" &&
      (comparisonPath(entry.path) === destinationKey ||
        isDescendantPath(destinationDirectory, entry.path))
    ) {
      throw new Error("A folder cannot be moved inside itself.");
    }

    const destinationPath = childPath(destinationDirectory, leafName(entry.path));
    if (comparisonPath(destinationPath) === comparisonPath(entry.path)) return [];
    return [{ sourcePath: entry.path, destinationPath, type: entry.type }];
  });

  const destinations = new Set<string>();
  for (const move of moves) {
    const key = comparisonPath(move.destinationPath);
    if (destinations.has(key)) {
      throw new Error(
        `Two selected items would have the same destination: ${move.destinationPath}`,
      );
    }
    destinations.add(key);
  }

  return moves;
}

/** Returns the inverse transaction, ordered to undo the original safely. */
export function reverseContentMoves(moves: readonly ContentMove[]): ContentMove[] {
  return [...moves].reverse().map((move) => ({
    sourcePath: move.destinationPath,
    destinationPath: move.sourcePath,
    type: move.type,
  }));
}

/**
 * Executes per-entry repository moves as one best-effort transaction. If a
 * later move fails, completed moves are rolled back in reverse order. The
 * helper works unchanged with both the HTTP and Tauri repositories.
 */
export async function executeContentMoveTransaction(
  repository: Pick<NoteRepository, "moveEntry">,
  moves: readonly ContentMove[],
): Promise<ContentMutationResult[]> {
  const completed: ContentMove[] = [];
  const results: ContentMutationResult[] = [];

  try {
    for (const move of moves) {
      const result = await repository.moveEntry(
        move.sourcePath,
        move.destinationPath,
      );
      completed.push(move);
      results.push(result);
    }
    return results;
  } catch (operationError) {
    const rollbackFailures: ContentMoveRollbackFailure[] = [];
    const unrecovered = new Set(completed);

    for (const move of [...completed].reverse()) {
      try {
        await repository.moveEntry(move.destinationPath, move.sourcePath);
        unrecovered.delete(move);
      } catch (error) {
        rollbackFailures.push({ move, error });
      }
    }

    if (rollbackFailures.length) {
      throw new ContentMoveTransactionError(
        "The move failed and some items could not be returned to their original locations.",
        operationError,
        rollbackFailures,
        completed.filter((move) => unrecovered.has(move)),
      );
    }
    throw operationError;
  }
}

export type ContentTrashLocation = "live" | "trash";

export interface ContentTrashItemState extends ContentSelectionEntry {
  location: ContentTrashLocation;
  receipt?: DeletedContentReceipt;
}

export interface ContentTrashRollbackFailure {
  path: string;
  error: unknown;
}

/**
 * A soft-delete transition failed and its compensating operations were also
 * incomplete. `batch` retains the exact mixed live/trash state and can safely
 * retry the requested transition after the collision or I/O issue is fixed.
 */
export class ContentTrashTransactionError extends Error {
  constructor(
    message: string,
    public readonly target: ContentTrashLocation,
    public readonly operationError: unknown,
    public readonly rollbackFailures: readonly ContentTrashRollbackFailure[],
    public readonly batch: ContentTrashBatch,
  ) {
    super(message);
    this.name = "ContentTrashTransactionError";
  }
}

/**
 * Stateful, retry-safe soft deletion for one or many explorer entries. It
 * keeps refreshed restore tokens when a compensating re-trash is necessary.
 */
export class ContentTrashBatch {
  private readonly items: ContentTrashItemState[];

  private constructor(
    private readonly repository: Pick<NoteRepository, "trashEntry" | "restoreEntry">,
    items: readonly ContentTrashItemState[],
  ) {
    this.items = items.map((item) => ({ ...item }));
  }

  /** Soft-deletes the supplied live entries, collapsing selected descendants. */
  static async fromLiveEntries(
    repository: Pick<NoteRepository, "trashEntry" | "restoreEntry">,
    entries: readonly ContentSelectionEntry[],
  ) {
    const batch = new ContentTrashBatch(
      repository,
      compactContentSelection(entries).map((entry) => ({
        ...entry,
        location: "live" as const,
      })),
    );
    await batch.moveToTrash();
    return batch;
  }

  /** Rehydrates a durable deletion batch, for example after UI recreation. */
  static fromReceipts(
    repository: Pick<NoteRepository, "trashEntry" | "restoreEntry">,
    receipts: readonly DeletedContentReceipt[],
  ) {
    return new ContentTrashBatch(repository, receipts.map((receipt) => ({
      path: receipt.originalPath,
      type: receipt.type,
      location: "trash" as const,
      receipt,
    })));
  }

  get state(): readonly ContentTrashItemState[] {
    return this.items.map((item) => ({ ...item }));
  }

  /** Moves every currently-live member to Trash. Safe to retry after failure. */
  async moveToTrash(): Promise<readonly DeletedContentReceipt[]> {
    const changed: ContentTrashItemState[] = [];
    try {
      for (const item of this.items) {
        if (item.location === "trash") continue;
        item.receipt = await this.repository.trashEntry(item.path);
        item.location = "trash";
        changed.push(item);
      }
      return this.items.flatMap((item) => item.receipt ? [item.receipt] : []);
    } catch (operationError) {
      const rollbackFailures: ContentTrashRollbackFailure[] = [];
      for (const item of [...changed].reverse()) {
        try {
          await this.repository.restoreEntry(item.receipt!.token);
          item.location = "live";
          item.receipt = undefined;
        } catch (error) {
          rollbackFailures.push({ path: item.path, error });
        }
      }
      if (rollbackFailures.length) {
        throw new ContentTrashTransactionError(
          "Moving items to Trash failed and some items could not be restored.",
          "trash",
          operationError,
          rollbackFailures,
          this,
        );
      }
      throw operationError;
    }
  }

  /** Restores every currently-trashed member. Safe to retry after failure. */
  async restore(): Promise<readonly ContentMutationResult[]> {
    const changed: ContentTrashItemState[] = [];
    const results: ContentMutationResult[] = [];
    try {
      for (const item of this.items) {
        if (item.location === "live") continue;
        const result = await this.repository.restoreEntry(item.receipt!.token);
        item.location = "live";
        item.receipt = undefined;
        changed.push(item);
        results.push(result);
      }
      return results;
    } catch (operationError) {
      const rollbackFailures: ContentTrashRollbackFailure[] = [];
      for (const item of [...changed].reverse()) {
        try {
          item.receipt = await this.repository.trashEntry(item.path);
          item.location = "trash";
        } catch (error) {
          rollbackFailures.push({ path: item.path, error });
        }
      }
      if (rollbackFailures.length) {
        throw new ContentTrashTransactionError(
          "Restoring items failed and some restored items could not be returned to Trash.",
          "live",
          operationError,
          rollbackFailures,
          this,
        );
      }
      throw operationError;
    }
  }
}

export interface ContentHistoryCommand {
  /** Short user-facing description, such as \"Move 3 items\". */
  label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export interface ContentHistoryState {
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

type ContentHistoryListener = (state: ContentHistoryState) => void;

/**
 * A small asynchronous command history for durable file operations. Commands
 * stay on their current stack when undo/redo fails, so a collision can be
 * resolved and the action retried without losing history.
 */
export class ContentOperationHistory {
  private readonly undoStack: ContentHistoryCommand[] = [];
  private readonly redoStack: ContentHistoryCommand[] = [];
  private readonly listeners = new Set<ContentHistoryListener>();
  private busy = false;
  private currentState: ContentHistoryState = {
    busy: false,
    canUndo: false,
    canRedo: false,
  };

  constructor(private readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Content history limit must be a positive integer.");
    }
  }

  get state(): ContentHistoryState {
    return this.currentState;
  }

  subscribe(listener: ContentHistoryListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  record(command: ContentHistoryCommand) {
    if (this.busy) {
      throw new Error("A content history operation is already in progress.");
    }
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  clear() {
    if (this.busy) return false;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
    return true;
  }

  undo() {
    return this.run(this.undoStack, this.redoStack, "undo");
  }

  redo() {
    return this.run(this.redoStack, this.undoStack, "redo");
  }

  private async run(
    source: ContentHistoryCommand[],
    destination: ContentHistoryCommand[],
    direction: "undo" | "redo",
  ) {
    if (this.busy) return false;
    const command = source[source.length - 1];
    if (!command) return false;

    this.busy = true;
    this.emit();
    try {
      await command[direction]();
      source.pop();
      destination.push(command);
      return true;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private emit() {
    this.currentState = {
      busy: this.busy,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label,
    };
    for (const listener of this.listeners) listener(this.currentState);
  }
}
