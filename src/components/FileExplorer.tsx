import {
  Check,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  DeletedContentReceipt,
  NoteTreeEntry,
} from "../services/noteRepository";
import { collectNoteFileDragItems } from "../domain/noteDrag";
import { beginNoteFileDrag } from "./noteFileDragInteractions";
import "./FileExplorer.css";

export type ContentTreeNode = NoteTreeEntry;

export interface FileExplorerMoveEntry {
  path: string;
  destinationPath: string;
}

export interface FileExplorerActions {
  createNote(parentPath: string, name: string): Promise<string>;
  createFolder(parentPath: string, name: string): Promise<string>;
  rename(path: string, name: string): Promise<string>;
  /** Move one selection as one history transaction. Returned paths align with entries. */
  move?(entries: readonly FileExplorerMoveEntry[]): Promise<readonly string[]>;
  trash(path: string): Promise<DeletedContentReceipt>;
  trashMany?(paths: readonly string[]): Promise<readonly DeletedContentReceipt[]>;
  restore(receipt: DeletedContentReceipt): Promise<string>;
  /** File-history commands are owned by the application so every path cache is remapped. */
  undo?(): Promise<boolean | void>;
  redo?(): Promise<boolean | void>;
  canUndo?: boolean;
  canRedo?: boolean;
}

interface FileExplorerProps {
  nodes: readonly ContentTreeNode[];
  selectedContentPath?: string;
  onSelectFile: (contentPath: string) => void;
  onClearActiveSelection?: () => void;
  actions?: FileExplorerActions;
  label?: string;
  className?: string;
  headerActions?: ReactNode;
}

interface VisibleTreeNode {
  node: ContentTreeNode;
  depth: number;
  parentPath?: string;
}

type EditState =
  | { mode: "create-note"; parentPath: string; depth: number }
  | { mode: "create-folder"; parentPath: string; depth: number }
  | { mode: "rename"; node: ContentTreeNode; depth: number };

interface ContextMenuState {
  x: number;
  y: number;
  node?: ContentTreeNode;
  depth: number;
}

interface ContentDragPayload {
  kind: "math-atlas-content-selection";
  version: 1;
  paths: string[];
}

interface ContentDropTarget {
  destinationPath: string;
  /** The exact row underneath the pointer, even when a file proxies its parent folder. */
  rowPath?: string;
  kind: "directory" | "parent" | "root";
  invalidReason?: string;
}

interface ContentDropPlan {
  entries: FileExplorerMoveEntry[];
  invalidReason?: string;
}

export const FILE_EXPLORER_DRAG_MIME = "application/x-math-atlas-content-selection";

export function normalizedContentPath(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^content\//i, "")
    .replace(/\/+$/, "")
    .toLocaleLowerCase();
}

function matchingPath(
  nodes: readonly ContentTreeNode[],
  candidatePath: string | undefined,
) {
  if (!candidatePath) return undefined;
  const candidate = normalizedContentPath(candidatePath);

  const visit = (entries: readonly ContentTreeNode[]): string | undefined => {
    for (const entry of entries) {
      if (normalizedContentPath(entry.path) === candidate) return entry.path;
      const nested = entry.type === "directory" ? visit(entry.children) : undefined;
      if (nested) return nested;
    }
    return undefined;
  };

  return visit(nodes);
}

function contentAncestorPaths(
  nodes: readonly ContentTreeNode[],
  selectedPath: string | undefined,
) {
  if (!selectedPath) return [];
  const selected = normalizedContentPath(selectedPath);

  const visit = (
    entries: readonly ContentTreeNode[],
    ancestors: readonly string[],
  ): string[] | undefined => {
    for (const entry of entries) {
      if (normalizedContentPath(entry.path) === selected) return [...ancestors];
      const found = entry.type === "directory"
        ? visit(entry.children, [...ancestors, entry.path])
        : undefined;
      if (found) return found;
    }
    return undefined;
  };

  return visit(nodes, []) ?? [];
}

function flattenVisibleNodes(
  nodes: readonly ContentTreeNode[],
  expandedPaths: ReadonlySet<string>,
  depth = 0,
  parentPath?: string,
): VisibleTreeNode[] {
  const result: VisibleTreeNode[] = [];

  for (const node of nodes) {
    result.push({ node, depth, parentPath });
    if (
      node.type === "directory" &&
      expandedPaths.has(node.path) &&
      node.children?.length
    ) {
      result.push(
        ...flattenVisibleNodes(node.children, expandedPaths, depth + 1, node.path),
      );
    }
  }

  return result;
}

function visibleNodeName(node: ContentTreeNode) {
  return node.type === "file" ? node.name.replace(/\.md$/i, "") : node.name;
}

function visiblePathName(path: string) {
  const segments = path.split("/");
  return (segments[segments.length - 1] ?? path).replace(/\.md$/i, "");
}

function parentDirectory(path: string) {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function leafName(path: string) {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? path : path.slice(separator + 1);
}

function joinContentPath(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function isSameOrDescendant(path: string, ancestor: string) {
  const normalizedPath = normalizedContentPath(path);
  const normalizedAncestor = normalizedContentPath(ancestor);
  return normalizedPath === normalizedAncestor || normalizedPath.startsWith(`${normalizedAncestor}/`);
}

/** Removes children whose selected ancestor already carries them during a folder move. */
export function selectionMoveRoots(paths: readonly string[]) {
  const unique = [...new Map(paths.map((path) => [normalizedContentPath(path), path])).values()];
  return unique.filter((path) => !unique.some((candidate) => (
    candidate !== path && isSameOrDescendant(path, candidate)
  )));
}

function writeContentDragPayload(dataTransfer: DataTransfer, paths: readonly string[]) {
  const payload: ContentDragPayload = {
    kind: "math-atlas-content-selection",
    version: 1,
    paths: [...paths],
  };
  dataTransfer.setData(FILE_EXPLORER_DRAG_MIME, JSON.stringify(payload));
}

function readContentDragPayload(dataTransfer: DataTransfer): readonly string[] | undefined {
  const raw = dataTransfer.getData(FILE_EXPLORER_DRAG_MIME);
  if (!raw) return undefined;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("kind" in candidate) ||
      candidate.kind !== "math-atlas-content-selection" ||
      !("version" in candidate) ||
      candidate.version !== 1 ||
      !("paths" in candidate) ||
      !Array.isArray(candidate.paths) ||
      !candidate.paths.every((path) => typeof path === "string" && path.length > 0)
    ) return undefined;
    return candidate.paths;
  } catch {
    return undefined;
  }
}

function cleanName(value: string) {
  return value.trim().replace(/\.md$/i, "");
}

function validateName(value: string) {
  const name = cleanName(value);
  if (!name) return "Enter a name.";
  if (name === "." || name === ".." || name.startsWith(".")) {
    return "Names cannot begin with a dot.";
  }
  if (/[<>:"/\\|?*]/.test(name) || /[\u0000-\u001f]/.test(name)) {
    return "That name contains a reserved character.";
  }
  if (/[. ]$/.test(name)) return "Names cannot end with a dot or space.";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    return "That name is reserved by Windows.";
  }
  return undefined;
}

function renamedExpandedPaths(
  paths: ReadonlySet<string>,
  from: string,
  to: string,
) {
  const next = new Set<string>();
  for (const path of paths) {
    if (path === from) next.add(to);
    else if (path.startsWith(`${from}/`)) next.add(`${to}${path.slice(from.length)}`);
    else next.add(path);
  }
  return next;
}

function movedSelectionPath(path: string, from: string, to: string) {
  if (normalizedContentPath(path) === normalizedContentPath(from)) return to;
  if (normalizedContentPath(path).startsWith(`${normalizedContentPath(from)}/`)) {
    return `${to}${path.slice(from.length)}`;
  }
  return path;
}

export const FileExplorer = memo(function FileExplorer({
  nodes,
  selectedContentPath,
  onSelectFile,
  onClearActiveSelection,
  actions,
  label = "Files",
  className = "",
  headerActions,
}: FileExplorerProps) {
  const selectedPath = useMemo(
    () => matchingPath(nodes, selectedContentPath),
    [nodes, selectedContentPath],
  );
  const selectedAncestors = useMemo(
    () => contentAncestorPaths(nodes, selectedContentPath),
    [nodes, selectedContentPath],
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(selectedAncestors),
  );
  const [focusedPath, setFocusedPath] = useState<string | undefined>(
    selectedPath ?? nodes[0]?.path,
  );
  const [activePath, setActivePath] = useState<string | undefined>(selectedPath);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(selectedPath ? [selectedPath] : []),
  );
  const [editState, setEditState] = useState<EditState>();
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [deleteTargets, setDeleteTargets] = useState<ContentTreeNode[]>([]);
  const [undoReceipt, setUndoReceipt] = useState<DeletedContentReceipt>();
  const [undoCount, setUndoCount] = useState(1);
  const [operationError, setOperationError] = useState<string>();
  const [draggingPaths, setDraggingPaths] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<ContentDropTarget>();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedPathsRef = useRef(selectedPaths);
  const selectionAnchorRef = useRef<string | undefined>(selectedPath);
  const locallyOpenedPathRef = useRef<string | undefined>(undefined);
  const draggingPathsRef = useRef<readonly string[]>([]);
  const dragExpandTimerRef = useRef<number | undefined>(undefined);
  const dragExpandTargetRef = useRef<string | undefined>(undefined);
  const editInputRef = useRef<HTMLInputElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const explorerRef = useRef<HTMLElement>(null);
  const pendingRowFocusRef = useRef<string | null | undefined>(undefined);
  const locallyClearedActiveSelectionRef = useRef(false);

  useEffect(() => {
    if (!selectedAncestors.length) return;
    setExpandedPaths((current) => {
      const next = new Set(current);
      let changed = false;
      for (const path of selectedAncestors) {
        if (!next.has(path)) {
          next.add(path);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selectedAncestors]);

  const replaceSelection = useCallback((next: ReadonlySet<string>) => {
    const stable = next instanceof Set ? next : new Set(next);
    selectedPathsRef.current = stable;
    setSelectedPaths(stable);
  }, []);

  const clearActiveSelectionFromExplorer = useCallback(() => {
    if (!selectedContentPath || !onClearActiveSelection) return;
    // App will clear selectedContentPath in response. Preserve the explorer's
    // newly authored local selection (for example, a selected directory)
    // instead of treating that parent update as an external reset.
    locallyClearedActiveSelectionRef.current = true;
    onClearActiveSelection();
  }, [onClearActiveSelection, selectedContentPath]);

  const reconcileActiveDocumentSelection = useCallback((next: ReadonlySet<string>) => {
    if (!selectedContentPath) return;
    if (!selectedPath || !next.has(selectedPath)) clearActiveSelectionFromExplorer();
  }, [clearActiveSelectionFromExplorer, selectedContentPath, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      if (!selectedContentPath && locallyClearedActiveSelectionRef.current) {
        locallyClearedActiveSelectionRef.current = false;
        return;
      }
      setActivePath(undefined);
      if (selectedPathsRef.current.size) replaceSelection(new Set());
      selectionAnchorRef.current = undefined;
      return;
    }
    // A clear followed by a direct note switch can be batched into one parent
    // render. Never let that old clear suppress a later genuine deselection.
    locallyClearedActiveSelectionRef.current = false;
    setFocusedPath(selectedPath);
    setActivePath(selectedPath);
    const locallyOpened = locallyOpenedPathRef.current === selectedPath;
    locallyOpenedPathRef.current = undefined;
    if (locallyOpened) return;
    selectionAnchorRef.current = selectedPath;
    replaceSelection(new Set([selectedPath]));
  }, [replaceSelection, selectedContentPath, selectedPath]);

  useEffect(() => {
    if (!editState) return;
    const frame = requestAnimationFrame(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editState]);

  useEffect(() => {
    if (!deleteTargets.length) return;
    const frame = requestAnimationFrame(() => cancelDeleteRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [deleteTargets.length]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof globalThis.KeyboardEvent) {
        const returnPath = contextMenu.node?.path;
        setFocusedPath(returnPath);
        pendingRowFocusRef.current = returnPath ?? null;
      }
      setContextMenu(undefined);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const visibleNodes = useMemo(
    () => flattenVisibleNodes(nodes, expandedPaths),
    [expandedPaths, nodes],
  );
  const visibleIndexByPath = useMemo(
    () => new Map(visibleNodes.map((entry, index) => [entry.node.path, index])),
    [visibleNodes],
  );
  const visibleEntryByPath = useMemo(
    () => new Map(visibleNodes.map((entry) => [entry.node.path, entry])),
    [visibleNodes],
  );
  const nodeByNormalizedPath = useMemo(() => {
    const result = new Map<string, ContentTreeNode>();
    const visit = (entries: readonly ContentTreeNode[]) => {
      for (const entry of entries) {
        result.set(normalizedContentPath(entry.path), entry);
        if (entry.type === "directory") visit(entry.children);
      }
    };
    visit(nodes);
    return result;
  }, [nodes]);
  const activeParentPath = useMemo(() => {
    const focused = activePath ? visibleEntryByPath.get(activePath) : undefined;
    if (!focused) return "";
    return focused.node.type === "directory"
      ? focused.node.path
      : focused.parentPath ?? "";
  }, [activePath, visibleEntryByPath]);

  useEffect(() => {
    const current = selectedPathsRef.current;
    const next = new Set(
      [...current].filter((path) => nodeByNormalizedPath.has(normalizedContentPath(path))),
    );
    if (next.size === current.size) return;
    replaceSelection(next);
    if (selectionAnchorRef.current && !next.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current = next.values().next().value;
    }
  }, [nodeByNormalizedPath, replaceSelection]);

  useEffect(() => () => {
    if (dragExpandTimerRef.current !== undefined) {
      window.clearTimeout(dragExpandTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const frame = requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [contextMenu]);

  useEffect(() => {
    if (!visibleNodes.length) {
      if (!editState) setFocusedPath(undefined);
      return;
    }
    if (!focusedPath || !visibleIndexByPath.has(focusedPath)) {
      setFocusedPath(selectedPath ?? visibleNodes[0].node.path);
    }
  }, [editState, focusedPath, selectedPath, visibleIndexByPath, visibleNodes]);

  useEffect(() => {
    const pendingPath = pendingRowFocusRef.current;
    if (pendingPath === undefined) return;
    if (pendingPath && !visibleIndexByPath.has(pendingPath)) return;
    const frame = requestAnimationFrame(() => {
      const target = pendingPath ? rowRefs.current.get(pendingPath) : explorerRef.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      pendingRowFocusRef.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    if (!selectedPath || !visibleIndexByPath.has(selectedPath)) return;
    rowRefs.current.get(selectedPath)?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedPath, visibleIndexByPath]);

  const focusRow = useCallback((path: string) => {
    setFocusedPath(path);
    rowRefs.current.get(path)?.focus();
  }, []);

  const toggleDirectory = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const beginCreate = useCallback((mode: "create-note" | "create-folder", parentPath = "") => {
    if (!actions || busy) return;
    const parentEntry = visibleNodes.find(({ node }) => node.path === parentPath);
    if (parentPath) {
      setExpandedPaths((current) => new Set(current).add(parentPath));
    }
    setContextMenu(undefined);
    setEditError(undefined);
    setEditValue(mode === "create-note" ? "Untitled note" : "Untitled folder");
    setEditState({
      mode,
      parentPath,
      depth: parentEntry ? parentEntry.depth + 1 : 0,
    });
  }, [actions, busy, visibleNodes]);

  const beginRename = useCallback((node: ContentTreeNode) => {
    if (!actions || busy) return;
    const entry = visibleNodes.find(({ node: candidate }) => candidate.path === node.path);
    setContextMenu(undefined);
    setEditError(undefined);
    setEditValue(visibleNodeName(node));
    setEditState({ mode: "rename", node, depth: entry?.depth ?? 0 });
  }, [actions, busy, visibleNodes]);

  const cancelEdit = useCallback(() => {
    if (!editState) return;
    const returnPath = editState.mode === "rename"
      ? editState.node.path
      : editState.parentPath || undefined;
    setEditState(undefined);
    setEditError(undefined);
    setFocusedPath(returnPath);
    pendingRowFocusRef.current = returnPath ?? null;
  }, [editState]);

  const dismissDeleteConfirmation = useCallback(() => {
    if (busy) return;
    const returnPath = deleteTargets[0]?.path;
    setDeleteTargets([]);
    setFocusedPath(returnPath);
    pendingRowFocusRef.current = returnPath ?? null;
  }, [busy, deleteTargets]);

  const submitEdit = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    if (!editState || !actions || busy) return;
    const name = cleanName(editValue);
    const error = validateName(name);
    if (error) {
      setEditError(error);
      editInputRef.current?.focus();
      return;
    }
    setBusy(true);
    setEditError(undefined);
    setOperationError(undefined);
    setUndoReceipt(undefined);
    setUndoCount(1);
    try {
      if (editState.mode === "create-note") {
        locallyOpenedPathRef.current = joinContentPath(editState.parentPath, `${name}.md`);
        const path = await actions.createNote(editState.parentPath, name);
        setFocusedPath(path);
        pendingRowFocusRef.current = path;
        setActivePath(path);
        selectionAnchorRef.current = path;
        replaceSelection(new Set([path]));
      } else if (editState.mode === "create-folder") {
        const path = await actions.createFolder(editState.parentPath, name);
        setExpandedPaths((current) => new Set(current).add(path));
        setFocusedPath(path);
        pendingRowFocusRef.current = path;
        setActivePath(path);
        selectionAnchorRef.current = path;
        const next = new Set([path]);
        replaceSelection(next);
        reconcileActiveDocumentSelection(next);
      } else {
        const from = editState.node.path;
        const expectedPath = joinContentPath(
          parentDirectory(from),
          editState.node.type === "file" ? `${name}.md` : name,
        );
        if (selectedPath && isSameOrDescendant(selectedPath, from)) {
          locallyOpenedPathRef.current = movedSelectionPath(selectedPath, from, expectedPath);
        }
        const path = await actions.rename(from, name);
        setExpandedPaths((current) => renamedExpandedPaths(current, from, path));
        replaceSelection(renamedExpandedPaths(selectedPathsRef.current, from, path));
        if (selectionAnchorRef.current) {
          selectionAnchorRef.current = movedSelectionPath(selectionAnchorRef.current, from, path);
        }
        setFocusedPath(path);
        pendingRowFocusRef.current = path;
        setActivePath(path);
      }
      setEditState(undefined);
      setEditValue("");
    } catch (error) {
      locallyOpenedPathRef.current = undefined;
      setEditError(error instanceof Error ? error.message : "The item could not be changed.");
      requestAnimationFrame(() => editInputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }, [actions, busy, editState, editValue, reconcileActiveDocumentSelection, replaceSelection, selectedPath]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTargets.length || !actions || busy) return;
    setBusy(true);
    setOperationError(undefined);
    try {
      const paths = deleteTargets.map((target) => target.path);
      const receipts = actions.trashMany
        ? await actions.trashMany(paths)
        : await (async () => {
          const completed: DeletedContentReceipt[] = [];
          try {
            for (const path of paths) completed.push(await actions.trash(path));
            return completed;
          } catch (error) {
            for (const receipt of completed.reverse()) {
              try {
                await actions.restore(receipt);
              } catch {
                // Keep the original failure visible; App refresh reconciles partial rollback.
              }
            }
            throw error;
          }
        })();
      const receipt = receipts[receipts.length - 1];
      if (receipt) setUndoReceipt(receipt);
      setUndoCount(receipts.length || 1);
      replaceSelection(new Set(
        [...selectedPathsRef.current].filter((selected) => (
          !paths.some((deleted) => isSameOrDescendant(selected, deleted))
        )),
      ));
      const remainingFocusPath = parentDirectory(paths[0] ?? "") ||
        visibleNodes.find(({ node }) => (
          !paths.some((deleted) => isSameOrDescendant(node.path, deleted))
        ))?.node.path;
      setFocusedPath(remainingFocusPath);
      pendingRowFocusRef.current = remainingFocusPath ?? null;
      setDeleteTargets([]);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "The item could not be moved to Trash.");
      setDeleteTargets([]);
    } finally {
      setBusy(false);
    }
  }, [actions, busy, deleteTargets, replaceSelection, visibleNodes]);

  const restoreDeleted = useCallback(async () => {
    if (!undoReceipt || !actions || busy) return;
    setBusy(true);
    setOperationError(undefined);
    try {
      let restoredPath: string;
      if (actions.undo) {
        const completed = await actions.undo();
        if (completed === false) return;
        restoredPath = undoReceipt.originalPath;
      } else {
        restoredPath = await actions.restore(undoReceipt);
      }
      setUndoReceipt(undefined);
      setUndoCount(1);
      setFocusedPath(restoredPath);
      pendingRowFocusRef.current = restoredPath;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "The item could not be restored.");
    } finally {
      setBusy(false);
    }
  }, [actions, busy, undoReceipt]);

  const targetsForSelection = useCallback((node: ContentTreeNode) => {
    const paths = selectedPathsRef.current.has(node.path)
      ? selectionMoveRoots([...selectedPathsRef.current])
      : [node.path];
    return paths.flatMap((path) => {
      const target = nodeByNormalizedPath.get(normalizedContentPath(path));
      return target ? [target] : [];
    });
  }, [nodeByNormalizedPath]);

  const openContextMenu = useCallback((
    event: MouseEvent<HTMLElement>,
    node?: ContentTreeNode,
    depth = 0,
  ) => {
    if (!actions) return;
    event.preventDefault();
    event.stopPropagation();
    let x = event.clientX;
    let y = event.clientY;
    if (x === 0 && y === 0) {
      const bounds = event.currentTarget.getBoundingClientRect();
      x = bounds.left + Math.min(bounds.width - 12, 40);
      y = bounds.top + Math.min(bounds.height, 24);
    }
    if (node) {
      setFocusedPath(node.path);
      setActivePath(node.path);
      const nextSelection = selectedPathsRef.current.has(node.path)
        ? selectedPathsRef.current
        : new Set([node.path]);
      if (nextSelection !== selectedPathsRef.current) {
        selectionAnchorRef.current = node.path;
        replaceSelection(nextSelection);
      }
      reconcileActiveDocumentSelection(nextSelection);
    }
    setContextMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - 226)),
      node,
      depth,
    });
  }, [actions, reconcileActiveDocumentSelection, replaceSelection]);

  const activateFile = useCallback((node: ContentTreeNode) => {
    if (node.type !== "file") return;
    locallyOpenedPathRef.current = node.path;
    onSelectFile(node.path);
  }, [onSelectFile]);

  const selectVisibleRange = useCallback((targetPath: string, additive: boolean) => {
    const targetIndex = visibleIndexByPath.get(targetPath);
    if (targetIndex === undefined) return new Set<string>();
    const anchorPath = selectionAnchorRef.current;
    const anchorIndex = anchorPath ? visibleIndexByPath.get(anchorPath) : undefined;
    const resolvedAnchorIndex = anchorIndex ?? targetIndex;
    if (anchorIndex === undefined) selectionAnchorRef.current = targetPath;
    const from = Math.min(resolvedAnchorIndex, targetIndex);
    const to = Math.max(resolvedAnchorIndex, targetIndex);
    const next = additive ? new Set(selectedPathsRef.current) : new Set<string>();
    for (let index = from; index <= to; index += 1) {
      const entry = visibleNodes[index];
      if (entry) next.add(entry.node.path);
    }
    replaceSelection(next);
    return next;
  }, [replaceSelection, visibleIndexByPath, visibleNodes]);

  const selectEntry = useCallback((
    entry: VisibleTreeNode,
    options: { additive: boolean; range: boolean; activate?: boolean },
  ) => {
    const { node } = entry;
    let remainsSelected = true;
    if (options.range) {
      const next = selectVisibleRange(node.path, options.additive);
      reconcileActiveDocumentSelection(next);
    } else if (options.additive) {
      const next = new Set(selectedPathsRef.current);
      if (next.has(node.path)) {
        next.delete(node.path);
        remainsSelected = false;
      } else {
        next.add(node.path);
      }
      selectionAnchorRef.current = node.path;
      replaceSelection(next);
      reconcileActiveDocumentSelection(next);
    } else {
      selectionAnchorRef.current = node.path;
      const next = new Set([node.path]);
      replaceSelection(next);
      if (node.type === "directory" || options.activate === false) {
        reconcileActiveDocumentSelection(next);
      }
    }
    setFocusedPath(node.path);
    setActivePath(node.path);
    if (options.activate !== false && remainsSelected) activateFile(node);
  }, [activateFile, reconcileActiveDocumentSelection, replaceSelection, selectVisibleRange]);

  const beginContentDrag = useCallback((
    event: DragEvent<HTMLButtonElement>,
    node: ContentTreeNode,
  ) => {
    const currentSelection = selectedPathsRef.current;
    const selectedForDrag = currentSelection.has(node.path)
      ? [...currentSelection]
      : [node.path];
    const nextSelection = new Set(selectedForDrag);
    if (!currentSelection.has(node.path)) {
      selectionAnchorRef.current = node.path;
      replaceSelection(nextSelection);
    }
    reconcileActiveDocumentSelection(nextSelection);
    const roots = selectionMoveRoots(selectedForDrag);
    const draggedNotes = collectNoteFileDragItems(nodes, roots);
    draggingPathsRef.current = roots;
    setDraggingPaths(new Set(roots));
    writeContentDragPayload(event.dataTransfer, roots);

    if (draggedNotes.length) {
      beginNoteFileDrag(event, draggedNotes);
      event.dataTransfer.effectAllowed = "copyMove";
    } else {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.path);
    }

    if (
      !draggedNotes.length &&
      roots.length > 1 &&
      typeof event.dataTransfer.setDragImage === "function"
    ) {
      const preview = document.createElement("div");
      preview.className = "file-tree__drag-preview";
      preview.textContent = `${roots.length} items`;
      document.body.append(preview);
      event.dataTransfer.setDragImage(preview, 14, 14);
      window.setTimeout(() => preview.remove(), 0);
    }
  }, [nodes, reconcileActiveDocumentSelection, replaceSelection]);

  const dragPaths = useCallback((dataTransfer: DataTransfer) => {
    // The in-memory session is authoritative for same-window explorer drags.
    // Besides avoiding JSON work on every dragover frame, this also respects
    // browsers that protect DataTransfer contents until the final drop event.
    const payloadPaths = draggingPathsRef.current.length
      ? draggingPathsRef.current
      : readContentDragPayload(dataTransfer) ?? [];
    const canonical: string[] = [];
    for (const path of payloadPaths) {
      const node = nodeByNormalizedPath.get(normalizedContentPath(path));
      if (node) canonical.push(node.path);
    }
    return selectionMoveRoots(canonical);
  }, [nodeByNormalizedPath]);

  const movePlanForDrop = useCallback((
    dataTransfer: DataTransfer,
    destinationDirectory: string,
  ): ContentDropPlan => {
    const sourcePaths = dragPaths(dataTransfer);
    const entries: FileExplorerMoveEntry[] = [];
    const destinationKeys = new Set<string>();

    for (const path of sourcePaths) {
      const node = nodeByNormalizedPath.get(normalizedContentPath(path));
      if (!node) {
        return { entries: [], invalidReason: "That item is no longer available." };
      }
      if (normalizedContentPath(parentDirectory(path)) === normalizedContentPath(destinationDirectory)) {
        continue;
      }
      if (
        node.type === "directory" &&
        (normalizedContentPath(path) === normalizedContentPath(destinationDirectory) ||
          isSameOrDescendant(destinationDirectory, path))
      ) {
        return { entries: [], invalidReason: "A folder cannot contain itself." };
      }

      const destinationPath = joinContentPath(destinationDirectory, leafName(path));
      const destinationKey = normalizedContentPath(destinationPath);
      if (destinationKeys.has(destinationKey)) {
        return { entries: [], invalidReason: "Two selected items have the same name." };
      }
      const existing = nodeByNormalizedPath.get(destinationKey);
      if (existing && normalizedContentPath(existing.path) !== normalizedContentPath(path)) {
        return { entries: [], invalidReason: `“${visibleNodeName(existing)}” already exists there.` };
      }
      destinationKeys.add(destinationKey);
      entries.push({ path, destinationPath });
    }

    return {
      entries,
      ...(!entries.length ? { invalidReason: "Already in this folder." } : {}),
    };
  }, [dragPaths, nodeByNormalizedPath]);

  const isContentDrag = useCallback((dataTransfer: DataTransfer) => (
    draggingPathsRef.current.length > 0 ||
    Array.from(dataTransfer.types ?? []).includes(FILE_EXPLORER_DRAG_MIME)
  ), []);

  const clearDragExpansionTimer = useCallback(() => {
    if (dragExpandTimerRef.current === undefined) return;
    window.clearTimeout(dragExpandTimerRef.current);
    dragExpandTimerRef.current = undefined;
    dragExpandTargetRef.current = undefined;
  }, []);

  const handleDragOverDestination = useCallback((
    event: DragEvent<HTMLElement>,
    destinationDirectory: string,
    target: Omit<ContentDropTarget, "destinationPath" | "invalidReason">,
  ) => {
    if (!actions?.move || busy || !isContentDrag(event.dataTransfer)) {
      return;
    }
    const plan = movePlanForDrop(event.dataTransfer, destinationDirectory);
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = plan.entries.length ? "move" : "none";
    const nextTarget: ContentDropTarget = {
      destinationPath: destinationDirectory,
      ...target,
      invalidReason: plan.invalidReason,
    };
    setDropTarget((current) => (
      current?.destinationPath === nextTarget.destinationPath &&
      current.rowPath === nextTarget.rowPath &&
      current.kind === nextTarget.kind &&
      current.invalidReason === nextTarget.invalidReason
        ? current
        : nextTarget
    ));
    if (!plan.entries.length) {
      clearDragExpansionTimer();
      return;
    }
    if (dragExpandTargetRef.current !== destinationDirectory) {
      clearDragExpansionTimer();
    }
    if (
      destinationDirectory &&
      !expandedPaths.has(destinationDirectory) &&
      dragExpandTimerRef.current === undefined
    ) {
      dragExpandTargetRef.current = destinationDirectory;
      dragExpandTimerRef.current = window.setTimeout(() => {
        setExpandedPaths((current) => new Set(current).add(destinationDirectory));
        dragExpandTimerRef.current = undefined;
        dragExpandTargetRef.current = undefined;
      }, 520);
    }
  }, [actions?.move, busy, clearDragExpansionTimer, expandedPaths, isContentDrag, movePlanForDrop]);

  const handleDrop = useCallback(async (
    event: DragEvent<HTMLElement>,
    destinationDirectory: string,
  ) => {
    const move = actions?.move;
    if (!isContentDrag(event.dataTransfer)) return;
    const plan = movePlanForDrop(event.dataTransfer, destinationDirectory);
    const entries = plan.entries;
    event.preventDefault();
    event.stopPropagation();
    clearDragExpansionTimer();
    setDropTarget(undefined);
    if (!move || busy || !entries.length) {
      if (plan.invalidReason && plan.invalidReason !== "Already in this folder.") {
        setOperationError(plan.invalidReason);
      }
      return;
    }
    if (selectedPath) {
      const selectionMove = entries.find(({ path }) => isSameOrDescendant(selectedPath, path));
      if (selectionMove) {
        locallyOpenedPathRef.current = movedSelectionPath(
          selectedPath,
          selectionMove.path,
          selectionMove.destinationPath,
        );
      }
    }
    setBusy(true);
    setOperationError(undefined);
    setUndoReceipt(undefined);
    setUndoCount(1);
    try {
      const movedPaths = await move(entries);
      const nextSelection = new Set(movedPaths);
      replaceSelection(nextSelection);
      selectionAnchorRef.current = movedPaths[0];
      setFocusedPath(movedPaths[0]);
      pendingRowFocusRef.current = movedPaths[0] ?? null;
      setActivePath(movedPaths[0]);
      if (destinationDirectory) {
        setExpandedPaths((current) => new Set(current).add(destinationDirectory));
      }
    } catch (error) {
      locallyOpenedPathRef.current = undefined;
      setOperationError(error instanceof Error ? error.message : "The selection could not be moved.");
    } finally {
      draggingPathsRef.current = [];
      setDraggingPaths(new Set());
      setBusy(false);
    }
  }, [actions?.move, busy, clearDragExpansionTimer, isContentDrag, movePlanForDrop, replaceSelection, selectedPath]);

  const endContentDrag = useCallback(() => {
    clearDragExpansionTimer();
    draggingPathsRef.current = [];
    setDraggingPaths(new Set());
    setDropTarget(undefined);
  }, [clearDragExpansionTimer]);

  useEffect(() => {
    if (!draggingPaths.size) return;
    const finish = () => endContentDrag();
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") endContentDrag();
    };
    window.addEventListener("dragend", finish, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("dragend", finish, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, [draggingPaths.size, endContentDrag]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, entry: VisibleTreeNode) => {
      const index = visibleIndexByPath.get(entry.node.path);
      if (index === undefined) return;
      const additive = event.ctrlKey || event.metaKey;

      if (additive && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        const parent = entry.node.type === "directory"
          ? entry.node.path
          : entry.parentPath ?? "";
        beginCreate(event.shiftKey ? "create-folder" : "create-note", parent);
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        beginRename(entry.node);
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        if (actions) setDeleteTargets(targetsForSelection(entry.node));
        return;
      }
      if (additive && event.key.toLocaleLowerCase() === "a") {
        event.preventDefault();
        const next = new Set(visibleNodes.map(({ node }) => node.path));
        replaceSelection(next);
        reconcileActiveDocumentSelection(next);
        selectionAnchorRef.current = entry.node.path;
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        selectEntry(entry, {
          additive,
          range: event.shiftKey,
          activate: false,
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (entry.node.type === "directory") toggleDirectory(entry.node.path);
        else activateFile(entry.node);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        replaceSelection(new Set());
        selectionAnchorRef.current = undefined;
        setActivePath(undefined);
        clearActiveSelectionFromExplorer();
        return;
      }

      const moveFocus = (nextIndex: number) => {
        const next = visibleNodes[nextIndex];
        if (!next) return;
        event.preventDefault();
        focusRow(next.node.path);
        if (!additive || event.shiftKey) {
          selectEntry(next, {
            additive: additive && event.shiftKey,
            range: event.shiftKey,
          });
        }
      };

      switch (event.key) {
        case "ArrowDown":
          moveFocus(Math.min(index + 1, visibleNodes.length - 1));
          break;
        case "ArrowUp":
          moveFocus(Math.max(index - 1, 0));
          break;
        case "Home":
          moveFocus(0);
          break;
        case "End":
          moveFocus(visibleNodes.length - 1);
          break;
        case "ArrowRight": {
          if (entry.node.type !== "directory") break;
          event.preventDefault();
          if (!expandedPaths.has(entry.node.path)) {
            setExpandedPaths((current) => new Set(current).add(entry.node.path));
          } else if (entry.node.children[0]) {
            focusRow(entry.node.children[0].path);
          }
          break;
        }
        case "ArrowLeft":
          if (entry.node.type === "directory" && expandedPaths.has(entry.node.path)) {
            event.preventDefault();
            setExpandedPaths((current) => {
              const next = new Set(current);
              next.delete(entry.node.path);
              return next;
            });
          } else if (entry.parentPath) {
            event.preventDefault();
            focusRow(entry.parentPath);
          }
          break;
      }
    },
    [
      actions,
      activateFile,
      beginCreate,
      beginRename,
      clearActiveSelectionFromExplorer,
      expandedPaths,
      focusRow,
      replaceSelection,
      reconcileActiveDocumentSelection,
      selectEntry,
      toggleDirectory,
      targetsForSelection,
      visibleIndexByPath,
      visibleNodes,
    ],
  );

  const runHistoryCommand = useCallback(async (direction: "undo" | "redo") => {
    const command = direction === "undo" ? actions?.undo : actions?.redo;
    const permitted = direction === "undo" ? actions?.canUndo : actions?.canRedo;
    if (!command || permitted === false || busy) return false;
    setBusy(true);
    setOperationError(undefined);
    try {
      const completed = await command();
      if (completed === false) return false;
      if (direction === "undo") setUndoReceipt(undefined);
      // The command can replace or remove the focused row. Keep focus inside
      // the explorer so an immediate inverse shortcut reaches file history,
      // never the independent canvas history.
      setFocusedPath(undefined);
      pendingRowFocusRef.current = null;
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : `The file action could not be ${direction === "undo" ? "undone" : "redone"}.`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [actions?.canRedo, actions?.canUndo, actions?.redo, actions?.undo, busy]);

  const draftRow = editState && editState.mode !== "rename" ? (
    <form
      className="file-tree__draft"
      style={{ "--tree-depth": editState.depth } as CSSProperties}
      onSubmit={(event) => void submitEdit(event)}
      role="treeitem"
      aria-level={editState.depth + 1}
    >
      <span className="file-tree__draft-spacer" />
      {editState.mode === "create-note" ? (
        <FileText size={14} aria-hidden="true" />
      ) : (
        <Folder size={14} aria-hidden="true" />
      )}
      <input
        ref={editInputRef}
        value={editValue}
        aria-label={editState.mode === "create-note" ? "New note name" : "New folder name"}
        aria-invalid={Boolean(editError)}
        disabled={busy}
        onChange={(event) => {
          setEditValue(event.target.value);
          setEditError(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEdit();
          }
        }}
      />
      <button type="submit" aria-label="Create" title="Create" disabled={busy}>
        <Check size={13} aria-hidden="true" />
      </button>
    </form>
  ) : null;

  const dragDestinationLabel = dropTarget?.destinationPath
    ? visiblePathName(dropTarget.destinationPath)
    : "Files";

  return (
    <section
      ref={explorerRef}
      className={`file-explorer ${className}`.trim()}
      tabIndex={-1}
      onKeyDownCapture={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.matches("input, textarea") || target.isContentEditable)
        ) return;
        const key = event.key.toLocaleLowerCase();
        const direction = key === "y" || (key === "z" && event.shiftKey)
          ? "redo"
          : key === "z"
            ? "undo"
            : undefined;
        if (!direction) return;
        const command = direction === "undo" ? actions?.undo : actions?.redo;
        const permitted = direction === "undo" ? actions?.canUndo : actions?.canRedo;
        if (!command || permitted === false) return;
        event.preventDefault();
        event.stopPropagation();
        void runHistoryCommand(direction);
      }}
    >
      <header className="file-explorer__header">
        <h2 className="file-explorer__heading">{label}</h2>
        <div className="file-explorer__actions">
          {actions && (
            <>
              <button type="button" aria-label="New note" title="New note · Ctrl+N" onClick={() => beginCreate("create-note", activeParentPath)}>
                <FilePlus2 size={14} aria-hidden="true" />
              </button>
              <button type="button" aria-label="New folder" title="New folder · Ctrl+Shift+N" onClick={() => beginCreate("create-folder", activeParentPath)}>
                <FolderPlus size={14} aria-hidden="true" />
              </button>
            </>
          )}
          {headerActions}
        </div>
      </header>

      {editError && (
        <div className="file-explorer__inline-error" role="alert">{editError}</div>
      )}

      {draggingPaths.size > 0 && actions?.move && (
        <div
          className={`file-tree__root-target ${dropTarget?.kind === "root" ? "is-active" : ""}`}
          aria-label="Move selection to Files root"
          title="Move to Files root"
          onDragEnter={(event) => handleDragOverDestination(event, "", { kind: "root" })}
          onDragOver={(event) => handleDragOverDestination(event, "", { kind: "root" })}
          onDragLeave={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) return;
            setDropTarget((current) => current?.kind === "root" ? undefined : current);
          }}
          onDrop={(event) => void handleDrop(event, "")}
        >
          <FolderInput size={14} aria-hidden="true" />
          <span>Files</span>
        </div>
      )}

      <div
        className={`file-tree ${dropTarget?.kind === "root" ? "is-root-drop-target" : ""}`}
        role="tree"
        aria-label={label}
        aria-busy={busy}
        aria-multiselectable="true"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          replaceSelection(new Set());
          selectionAnchorRef.current = undefined;
          setActivePath(undefined);
          clearActiveSelectionFromExplorer();
        }}
        onDragOver={(event) => {
          if (event.target === event.currentTarget) {
            handleDragOverDestination(event, "", { kind: "root" });
          }
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          clearDragExpansionTimer();
          setDropTarget(undefined);
        }}
        onDrop={(event) => {
          if (event.target === event.currentTarget) void handleDrop(event, "");
        }}
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) openContextMenu(event);
        }}
      >
        {editState?.mode !== "rename" && editState?.parentPath === "" && draftRow}
        {!visibleNodes.length && !editState && (
          <div className="file-tree__empty">No notes</div>
        )}
        {visibleNodes.map((entry) => {
          const { node, depth } = entry;
          const directory = node.type === "directory";
          const expandable = directory && node.children.length > 0;
          const expanded = directory && expandedPaths.has(node.path);
          const selected = selectedPaths.has(node.path);
          const primary = node.path === activePath;
          const dropDestination = directory ? node.path : entry.parentPath ?? "";
          const renaming = editState?.mode === "rename" && editState.node.path === node.path;

          return (
            <div className="file-tree__entry" key={node.path}>
              {renaming ? (
                <form
                  className="file-tree__draft is-renaming"
                  style={{ "--tree-depth": depth } as CSSProperties}
                  onSubmit={(event) => void submitEdit(event)}
                  role="treeitem"
                  aria-level={depth + 1}
                >
                  <span className="file-tree__draft-spacer" />
                  {directory ? <FolderOpen size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                  <input
                    ref={editInputRef}
                    value={editValue}
                    aria-label="Rename"
                    aria-invalid={Boolean(editError)}
                    disabled={busy}
                    onChange={(event) => {
                      setEditValue(event.target.value);
                      setEditError(undefined);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                  />
                  <button type="submit" aria-label="Rename" title="Rename" disabled={busy}>
                    <Check size={13} aria-hidden="true" />
                  </button>
                </form>
              ) : (
                <button
                  ref={(element) => {
                    if (element) rowRefs.current.set(node.path, element);
                    else rowRefs.current.delete(node.path);
                  }}
                  type="button"
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-expanded={directory ? expanded : undefined}
                  aria-selected={selected}
                  className={`file-tree__row ${selected ? "is-selected" : ""} ${primary ? "is-primary" : ""} ${draggingPaths.has(node.path) ? "is-dragging" : ""} ${dropTarget?.rowPath === node.path ? "is-drop-target" : ""} ${dropTarget?.rowPath === node.path && dropTarget.kind === "parent" ? "is-parent-drop-target" : ""} ${dropTarget?.rowPath === node.path && dropTarget.invalidReason ? "is-invalid-drop-target" : ""}`}
                  data-node-type={node.type}
                  data-has-children={expandable}
                  data-content-path={node.path}
                  style={{ "--tree-depth": depth } as CSSProperties}
                  title={node.path}
                  tabIndex={node.path === focusedPath ? 0 : -1}
                  draggable={!directory || Boolean(actions?.move)}
                  onFocus={() => {
                    setFocusedPath(node.path);
                    setActivePath(node.path);
                  }}
                  onContextMenu={(event) => openContextMenu(event, node, depth)}
                  onClick={(event) => {
                    const additive = event.ctrlKey || event.metaKey;
                    selectEntry(entry, {
                      additive,
                      range: event.shiftKey,
                    });
                    if (directory && !additive && !event.shiftKey) toggleDirectory(node.path);
                  }}
                  onDragStart={(event) => {
                    beginContentDrag(event, node);
                  }}
                  onDragEnter={(event) => handleDragOverDestination(event, dropDestination, {
                    kind: directory ? "directory" : "parent",
                    rowPath: node.path,
                  })}
                  onDragOver={(event) => handleDragOverDestination(event, dropDestination, {
                    kind: directory ? "directory" : "parent",
                    rowPath: node.path,
                  })}
                  onDragLeave={(event) => {
                    const next = event.relatedTarget;
                    if (next instanceof Node && event.currentTarget.contains(next)) return;
                    clearDragExpansionTimer();
                    setDropTarget((current) => current?.rowPath === node.path ? undefined : current);
                  }}
                  onDrop={(event) => {
                    void handleDrop(event, dropDestination);
                  }}
                  onDragEnd={endContentDrag}
                  onKeyDown={(event) => handleKeyDown(event, entry)}
                >
                  <ChevronRight
                    className={`file-tree__chevron ${expanded ? "is-open" : ""}`}
                    size={12}
                    aria-hidden="true"
                  />
                  {directory ? (
                    expanded ? <FolderOpen className="file-tree__icon" size={14} aria-hidden="true" /> : <Folder className="file-tree__icon" size={14} aria-hidden="true" />
                  ) : (
                    <FileText className="file-tree__icon" size={14} aria-hidden="true" />
                  )}
                  <span className="file-tree__name">{visibleNodeName(node)}</span>
                </button>
              )}
              {editState?.mode !== "rename" && editState?.parentPath === node.path && draftRow}
            </div>
          );
        })}
      </div>

      {draggingPaths.size > 0 && dropTarget && (
        <div
          className={`file-tree__drop-status ${dropTarget.invalidReason ? "is-invalid" : ""}`}
          role="status"
          aria-live="polite"
        >
          <FolderInput size={13} aria-hidden="true" />
          <span>{dropTarget.invalidReason ?? `${draggingPaths.size > 1 ? `${draggingPaths.size} items` : "Move"} → ${dragDestinationLabel}`}</span>
        </div>
      )}

      {operationError && (
        <div className="file-explorer__notice is-error" role="alert">
          <span>{operationError}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setOperationError(undefined)}>
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      {undoReceipt && (
        <div className="file-explorer__notice" role="status">
          <span>
            <strong>{undoCount > 1 ? `${undoCount} items` : visiblePathName(undoReceipt.originalPath)}</strong>
            {" "}moved to Trash
          </span>
          <button type="button" className="file-explorer__undo" onClick={() => void restoreDeleted()} disabled={busy}>
            <RotateCcw size={12} aria-hidden="true" /> Undo
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => {
            setUndoReceipt(undefined);
            setUndoCount(1);
          }}>
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="file-context-menu"
          data-keyboard-scope="files"
          role="menu"
          aria-label="File actions"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            let nextIndex: number | undefined;
            if (event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
            else if (event.key === "ArrowUp") nextIndex = (index - 1 + items.length) % items.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = items.length - 1;
            if (nextIndex !== undefined && items[nextIndex]) {
              event.preventDefault();
              items[nextIndex].focus();
            }
          }}
        >
          {contextMenu.node?.type === "file" && (
            <button type="button" role="menuitem" onClick={() => {
              onSelectFile(contextMenu.node!.path);
              setContextMenu(undefined);
            }}>
              <FileText size={14} aria-hidden="true" /><span>Open</span><kbd>Enter</kbd>
            </button>
          )}
          {contextMenu.node?.type !== "file" && (
            <>
              <button type="button" role="menuitem" onClick={() => beginCreate("create-note", contextMenu.node?.path ?? "")}>
                <FilePlus2 size={14} aria-hidden="true" /><span>New note</span><kbd>Ctrl N</kbd>
              </button>
              <button type="button" role="menuitem" onClick={() => beginCreate("create-folder", contextMenu.node?.path ?? "")}>
                <FolderPlus size={14} aria-hidden="true" /><span>New folder</span><kbd>Ctrl ⇧ N</kbd>
              </button>
            </>
          )}
          {contextMenu.node && (
            <>
              <div className="file-context-menu__rule" />
              <button type="button" role="menuitem" onClick={() => beginRename(contextMenu.node!)}>
                <Pencil size={14} aria-hidden="true" /><span>Rename</span><kbd>F2</kbd>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => {
                setDeleteTargets(targetsForSelection(contextMenu.node!));
                setContextMenu(undefined);
              }}>
                <Trash2 size={14} aria-hidden="true" />
                <span>
                  {selectedPaths.has(contextMenu.node.path) && selectedPaths.size > 1
                    ? `Move ${selectionMoveRoots([...selectedPaths]).length} items to Trash`
                    : "Move to Trash"}
                </span>
                <kbd>Del</kbd>
              </button>
            </>
          )}
        </div>,
        document.body,
      )}

      {deleteTargets.length > 0 && createPortal(
        <div className="file-confirmation-backdrop" data-keyboard-scope="files" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) dismissDeleteConfirmation();
        }}>
          <section className="file-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="file-delete-title" onKeyDown={(event) => {
            if (event.key === "Escape") dismissDeleteConfirmation();
          }}>
            <div className="file-confirmation__icon"><Trash2 size={17} aria-hidden="true" /></div>
            <div>
              <h3 id="file-delete-title">
                {deleteTargets.length === 1
                  ? `Move “${visibleNodeName(deleteTargets[0])}” to Trash?`
                  : `Move ${deleteTargets.length} items to Trash?`}
              </h3>
              <p>
                {deleteTargets.length > 1
                  ? "The selected files and folders will move to Trash. Map landmarks stay in place."
                  : deleteTargets[0].type === "directory"
                  ? "The folder and its notes will move to Trash. Map landmarks stay in place."
                  : "The note will move to Trash. Its map landmark stays in place."}
                {" "}You can undo this action.
              </p>
            </div>
            <div className="file-confirmation__actions">
              <button ref={cancelDeleteRef} type="button" onClick={dismissDeleteConfirmation} disabled={busy}>Cancel</button>
              <button type="button" className="is-danger" onClick={() => void confirmDelete()} disabled={busy}>Move to Trash</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
});
