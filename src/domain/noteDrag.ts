export const NOTE_FILE_DRAG_MIME = "application/x-math-atlas-note";

/** A canonical note reference that can be copied onto the canvas. */
export interface NoteFileDragItem {
  /** Forward-slash path relative to the writable content directory. */
  path: string;
  /** Presentation label only; path or noteId remains the identity. */
  title: string;
  /** Stable frontmatter identity when the note already has one. */
  noteId?: string;
}

/** Legacy single-note payload. Keep this shape readable for existing drags. */
export interface NoteFileDragPayload extends NoteFileDragItem {
  kind: "math-atlas-note";
  version: 1;
}

/** Multi-note payload used for selections and recursively expanded folders. */
export interface NoteFileDragBatchPayload {
  kind: "math-atlas-note-batch";
  version: 2;
  notes: NoteFileDragItem[];
}

export type NoteFileDragTransferPayload =
  | NoteFileDragPayload
  | NoteFileDragBatchPayload;

/**
 * Minimal structural tree contract used by the drag layer. Keeping this
 * independent of the repository implementation makes the helper easy to use
 * with cached, filtered, or test trees.
 */
export type NoteFileDragTreeEntry =
  | {
      type: "directory";
      name: string;
      path: string;
      children: readonly NoteFileDragTreeEntry[];
    }
  | {
      type: "file";
      name: string;
      path: string;
      id?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeRelativeNotePath(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const path = value.replace(/\\/g, "/");
  return (
    path === value &&
    !path.startsWith("/") &&
    !/^[a-z]:/i.test(path) &&
    !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") &&
    path.toLocaleLowerCase().endsWith(".md")
  );
}

function isNoteFileDragItem(value: unknown): value is NoteFileDragItem {
  return (
    isRecord(value) &&
    isSafeRelativeNotePath(value.path) &&
    typeof value.title === "string" &&
    Boolean(value.title.trim()) &&
    (value.noteId === undefined ||
      (typeof value.noteId === "string" && Boolean(value.noteId.trim())))
  );
}

function notePathKey(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
}

function dedupeNoteFileDragItems(items: readonly NoteFileDragItem[]) {
  const result: NoteFileDragItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = notePathKey(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      path: item.path,
      title: item.title,
      ...(item.noteId ? { noteId: item.noteId } : {}),
    });
  }
  return result;
}

function parseNoteFileDragTransfer(raw: string): NoteFileDragTransferPayload | undefined {
  if (!raw) return undefined;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return undefined;

    if (
      value.kind === "math-atlas-note" &&
      value.version === 1 &&
      isNoteFileDragItem(value)
    ) {
      return value as unknown as NoteFileDragPayload;
    }

    if (
      value.kind === "math-atlas-note-batch" &&
      value.version === 2 &&
      Array.isArray(value.notes) &&
      value.notes.length > 0 &&
      value.notes.every(isNoteFileDragItem)
    ) {
      return {
        kind: "math-atlas-note-batch",
        version: 2,
        notes: dedupeNoteFileDragItems(value.notes),
      };
    }
  } catch {
    // Malformed external drag data is intentionally ignored.
  }

  return undefined;
}

export function serializeNoteFileDragPayload(
  payload: Omit<NoteFileDragPayload, "kind" | "version">,
): string {
  return JSON.stringify({
    kind: "math-atlas-note",
    version: 1,
    path: payload.path,
    title: payload.title,
    ...(payload.noteId ? { noteId: payload.noteId } : {}),
  } satisfies NoteFileDragPayload);
}

export function serializeNoteFileDragBatchPayload(
  notes: readonly NoteFileDragItem[],
): string {
  if (!notes.length || !notes.every(isNoteFileDragItem)) {
    throw new TypeError("A note drag batch requires at least one valid Markdown note.");
  }
  return JSON.stringify({
    kind: "math-atlas-note-batch",
    version: 2,
    notes: dedupeNoteFileDragItems(notes),
  } satisfies NoteFileDragBatchPayload);
}

export function readNoteFileDragPayload(
  dataTransfer: Pick<DataTransfer, "getData">,
): NoteFileDragPayload | undefined {
  const payload = parseNoteFileDragTransfer(dataTransfer.getData(NOTE_FILE_DRAG_MIME));
  return payload?.kind === "math-atlas-note" ? payload : undefined;
}

/** Reads both legacy single-note and current batch drags as one ordered list. */
export function readNoteFileDragItems(
  dataTransfer: Pick<DataTransfer, "getData">,
): NoteFileDragItem[] | undefined {
  const payload = parseNoteFileDragTransfer(dataTransfer.getData(NOTE_FILE_DRAG_MIME));
  if (!payload) return undefined;
  return payload.kind === "math-atlas-note"
    ? [{
        path: payload.path,
        title: payload.title,
        ...(payload.noteId ? { noteId: payload.noteId } : {}),
      }]
    : payload.notes;
}

export function writeNoteFileDragPayload(
  dataTransfer: Pick<DataTransfer, "setData"> & Partial<Pick<DataTransfer, "effectAllowed">>,
  payload: Omit<NoteFileDragPayload, "kind" | "version">,
) {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(NOTE_FILE_DRAG_MIME, serializeNoteFileDragPayload(payload));
  // A plain-text fallback makes the drag understandable to accessibility and
  // debugging tools without pretending the note is an external filesystem URL.
  dataTransfer.setData("text/plain", payload.path);
}

/**
 * Writes an ordered note selection. A one-item selection deliberately keeps
 * the legacy v1 wire shape so older single-note drop targets continue to work.
 */
export function writeNoteFileDragBatchPayload(
  dataTransfer: Pick<DataTransfer, "setData"> & Partial<Pick<DataTransfer, "effectAllowed">>,
  notes: readonly NoteFileDragItem[],
) {
  if (!notes.length || !notes.every(isNoteFileDragItem)) {
    throw new TypeError("A note drag batch requires at least one valid Markdown note.");
  }
  const unique = dedupeNoteFileDragItems(notes);
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(
    NOTE_FILE_DRAG_MIME,
    unique.length === 1
      ? serializeNoteFileDragPayload(unique[0])
      : serializeNoteFileDragBatchPayload(unique),
  );
  dataTransfer.setData("text/plain", unique.map(({ path }) => path).join("\n"));
}

/**
 * Expands selected files and folders into canonical note references. Selection
 * root order is retained, descendants use tree order, and overlapping folders
 * or explicitly selected children never create duplicates.
 */
export function collectNoteFileDragItems(
  tree: readonly NoteFileDragTreeEntry[],
  selectedPaths: readonly string[],
): NoteFileDragItem[] {
  const nodesByPath = new Map<string, NoteFileDragTreeEntry>();
  const index = (nodes: readonly NoteFileDragTreeEntry[]) => {
    for (const node of nodes) {
      nodesByPath.set(notePathKey(node.path), node);
      if (node.type === "directory") index(node.children);
    }
  };
  index(tree);

  const notes: NoteFileDragItem[] = [];
  const seen = new Set<string>();
  const collect = (node: NoteFileDragTreeEntry) => {
    if (node.type === "directory") {
      node.children.forEach(collect);
      return;
    }
    if (!isSafeRelativeNotePath(node.path)) return;
    const key = notePathKey(node.path);
    if (seen.has(key)) return;
    seen.add(key);
    const pathSegments = node.path.split("/");
    const fallbackTitle = (pathSegments[pathSegments.length - 1] ?? node.path).replace(/\.md$/i, "");
    const title = node.name.replace(/\.md$/i, "").trim() || fallbackTitle;
    notes.push({
      path: node.path,
      title,
      ...(node.id ? { noteId: node.id } : {}),
    });
  };

  for (const path of selectedPaths) {
    const node = nodesByPath.get(notePathKey(path));
    if (node) collect(node);
  }
  return notes;
}
