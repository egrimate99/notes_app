import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  FolderTree,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  RefreshCw,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import type { Viewport } from "@xyflow/react";
import { isTauri } from "@tauri-apps/api/core";
import "./App.css";
import type {
  FileExplorerActions,
  FileExplorerMoveEntry,
} from "./components/FileExplorer";
import { InspectorPanel } from "./components/InspectorPanel";
import type { LiveNoteEditorSafety } from "./components/LiveNoteEditor";
import {
  PanelResizer,
  usePersistentPanelSize,
  usePersistentPanelVisibility,
} from "./components/PanelResizer";
import { SearchBar } from "./components/SearchBar";
import type {
  NewLandmarkRequest,
  LandmarkResizeBounds,
  PlaceNoteRequest,
  RemoveCanvasObjectsRequest,
} from "./components/AtlasGraph";
import {
  defaultLandmarkShape,
  SUBJECT_RAINBOW_COLORS,
} from "./domain/mapAppearance";
import {
  repositoryPath,
  subjectForRepositoryPath,
  titleForRepositoryPath,
} from "./domain/contentPaths";
import { mathNoteType } from "./domain/landmarkDisplay";
import { isTextEditingTarget } from "./domain/keyboardTargets";
import { landmarkFileTemplate, noteBodyTemplate } from "./domain/noteTemplates";
import type { AtlasSnapshot, Landmark, Placement } from "./domain/types";
import snapshotJson from "./data/public-atlas.snapshot.json";
import { buildWikiLinkIndex } from "./domain/wikiLinks";
import {
  noteRepository,
  type ContentMutationResult,
  type DeletedContentReceipt,
  type NoteDocument,
  type NoteTreeEntry,
  NoteRepositoryError,
} from "./services/noteRepository";
import {
  compactContentSelection,
  ContentMoveTransactionError,
  ContentOperationHistory,
  ContentTrashBatch,
  ContentTrashTransactionError,
  executeContentMoveTransaction,
  reverseContentMoves,
  type ContentHistoryState,
  type ContentMove,
  type ContentSelectionEntry,
} from "./services/contentOperationHistory";
import {
  AtlasRepositoryError,
  atlasRepository,
} from "./services/atlasRepository";
import { rendererPixelScale } from "./services/desktopProjection";
import type { DesktopCanvasDragEvent } from "./services/desktopCanvasDrag";
import type { DesktopSurfaceStatus } from "./services/desktopSurface";
import type {
  DesktopAtlasSnapshot,
  DesktopNoteSnapshot,
  DesktopSelectionSnapshot,
  DesktopWorkspaceBridge,
} from "./services/desktopWorkspaceSync";
import {
  atlasMetadataToLegacyState,
  migrateLegacyAtlasState,
} from "./services/atlasMigration";
import {
  loadPlacementOverrides,
  savePlacementOverrides,
} from "./state/placementStore";
import {
  loadMapCustomizations,
  saveMapCustomizations,
  type EditableLandmarkKind,
  type MapCustomizations,
  type MapCustomizationsUpdater,
} from "./state/mapCustomizationStore";

// Focus/visibility signals handle the normal case immediately. This is only a
// foreground fallback, deliberately conservative because desktop mode can have
// one WebView per monitor.
const CONTENT_TREE_POLL_INTERVAL_MS = 30_000;
const INTERNAL_NOTE_ROOT = "notes";

type ContentTreeRefreshPriority = "foreground" | "background";

/**
 * The API returns its tree in a stable order, so a compact serialization is a
 * reliable change token. Keeping this outside React state avoids repainting a
 * vault-sized explorer when a background check finds no changes.
 */
function contentTreeFingerprint(nodes: readonly NoteTreeEntry[]) {
  return JSON.stringify(nodes);
}

/**
 * Keep utility/archive roots out of the file browser without removing their
 * notes from the repository, search/link indexes, or direct navigation.
 */
function navigationContentTree(nodes: readonly NoteTreeEntry[]) {
  return nodes.filter((entry) => {
    if (entry.type !== "directory") return true;
    const rootPath = entry.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return rootPath.includes("/") || (
      !rootPath.startsWith("_") && rootPath.toLocaleLowerCase() !== INTERNAL_NOTE_ROOT
    );
  });
}

const AtlasGraph = lazy(() =>
  import("./components/AtlasGraph").then((module) => ({ default: module.AtlasGraph })),
);

const FileExplorer = lazy(() =>
  import("./components/FileExplorer").then((module) => ({ default: module.FileExplorer })),
);

const DesktopSurfaceController = lazy(() =>
  import("./components/DesktopSurfaceControls").then((module) => ({
    default: module.DesktopSurfaceController,
  })),
);

const snapshot = snapshotJson as unknown as AtlasSnapshot;
const placementSnapshotKey = "math-atlas-v1";
const fileSidebarSize = { default: 246, min: 180, max: 480 } as const;
const inspectorSize = { default: 548, min: 360, max: 860 } as const;
const snapshotLandmarkIds = snapshot.landmarks.map(({ id }) => id);

interface TreeIndex {
  entryByPath: Map<string, NoteTreeEntry>;
  fileByPath: Map<string, Extract<NoteTreeEntry, { type: "file" }>>;
  pathByLandmarkId: Map<string, string>;
}

interface MapHistorySnapshot {
  placements: Placement[];
  customizations: MapCustomizations;
}

interface AtlasPendingSnapshot {
  placements: Placement[];
  customizations: MapCustomizations;
}

function cloneCustomizations(value: MapCustomizations): MapCustomizations {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as MapCustomizations;
  }
}

function indexContentTree(nodes: readonly NoteTreeEntry[]): TreeIndex {
  const entryByPath = new Map<string, NoteTreeEntry>();
  const fileByPath = new Map<string, Extract<NoteTreeEntry, { type: "file" }>>();
  const pathByLandmarkId = new Map<string, string>();
  const visit = (entries: readonly NoteTreeEntry[]) => {
    entries.forEach((entry) => {
      entryByPath.set(entry.path.toLocaleLowerCase(), entry);
      if (entry.type === "directory") visit(entry.children);
      else {
        fileByPath.set(entry.path.toLocaleLowerCase(), entry);
        if (entry.id) pathByLandmarkId.set(entry.id, entry.path);
      }
    });
  };
  visit(nodes);
  return { entryByPath, fileByPath, pathByLandmarkId };
}

export function wikiNotesFromContentTree(nodes: readonly NoteTreeEntry[]) {
  const notes: Array<{ path: string; aliases?: readonly string[] }> = [];
  const visit = (entries: readonly NoteTreeEntry[]) => {
    entries.forEach((entry) => {
      if (entry.type === "directory") visit(entry.children);
      else if (!/^notes\/atlas-note-[^/]+\.md$/i.test(entry.path.replace(/\\/g, "/"))) {
        notes.push({ path: entry.path, aliases: entry.aliases });
      }
    });
  };
  visit(nodes);
  return notes;
}

function customLandmarkModel(custom: MapCustomizations["customLandmarks"][number]): Landmark {
  return {
    id: custom.id,
    title: custom.title,
    kind: custom.kind ?? "concept",
    subjectIds: [custom.subjectId],
    regionId: custom.regionId,
    summary: "",
    markdown: "",
    tags: [],
    status: "draft",
    mastery: { state: 0, explain: 0, derive: 0, apply: 0 },
    contentPath: custom.contentPath,
  };
}

function newObjectId(prefix: string) {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function editableLandmarkKind(kind: Landmark["kind"]): EditableLandmarkKind {
  switch (kind) {
    case "definition":
    case "theorem":
    case "proposition":
    case "lemma":
    case "corollary":
    case "method":
    case "example":
      return kind;
    case "result":
      return "theorem";
    default:
      return "concept";
  }
}

function childContentPath(parentPath: string, name: string, markdown = false) {
  const leaf = markdown ? `${name}.md` : name;
  return parentPath ? `${parentPath}/${leaf}` : leaf;
}

function movedContentPath(path: string, from: string, to: string) {
  const normalizedPath = path.toLocaleLowerCase();
  const normalizedFrom = from.toLocaleLowerCase();
  if (normalizedPath === normalizedFrom) return to;
  if (normalizedPath.startsWith(`${normalizedFrom}/`)) {
    return `${to}${path.slice(from.length)}`;
  }
  return undefined;
}

/**
 * Resolve every path against the same pre-operation snapshot. Applying moves
 * iteratively can double-remap crossing batches and corrupt an undo.
 */
function contentPathAfterMoves(path: string, moves: readonly ContentMove[]) {
  for (const move of moves) {
    const nextPath = movedContentPath(path, move.sourcePath, move.destinationPath);
    if (nextPath) return nextPath;
  }
  return path;
}

function mapCustomizationsAfterContentMoves(
  customizations: MapCustomizations,
  moves: readonly ContentMove[],
) {
  let changed = false;
  const customLandmarks = customizations.customLandmarks.map((landmark) => {
    const storedPath = repositoryPath(landmark.contentPath);
    if (!storedPath) return landmark;
    const nextPath = contentPathAfterMoves(storedPath, moves);
    if (nextPath === storedPath) return landmark;
    changed = true;
    const directFileMove = moves.find((move) => (
      move.type === "file" &&
      move.sourcePath.toLocaleLowerCase() === storedPath.toLocaleLowerCase()
    ));
    return {
      ...landmark,
      contentPath: `content/${nextPath}`,
      ...(directFileMove ? { title: contentLeafTitle(nextPath) } : {}),
    };
  });
  return changed ? { ...customizations, customLandmarks } : customizations;
}

function contentLeafTitle(path: string) {
  const segments = path.split("/");
  return (segments[segments.length - 1] ?? path).replace(/\.md$/i, "");
}

function atlasPersistenceDisabledForSession() {
  try {
    return sessionStorage.getItem("math-atlas:ephemeral-session") === "true";
  } catch {
    return false;
  }
}

function desktopMonitorBootstrapId() {
  try {
    return new URLSearchParams(window.location.search).get("desktopSurface") || undefined;
  } catch {
    return undefined;
  }
}

function App() {
  const fileSidebarPanel = usePersistentPanelSize({
    storageKey: "math-atlas:panel-width:file-sidebar",
    defaultSize: fileSidebarSize.default,
    minSize: fileSidebarSize.min,
    maxSize: fileSidebarSize.max,
  });
  const inspectorPanel = usePersistentPanelSize({
    storageKey: "math-atlas:panel-width:inspector",
    defaultSize: inspectorSize.default,
    minSize: inspectorSize.min,
    maxSize: inspectorSize.max,
  });
  const fileVisibility = usePersistentPanelVisibility("math-atlas:panel-visible:file-sidebar");
  const inspectorVisibility = usePersistentPanelVisibility("math-atlas:panel-visible:inspector");

  const initialLandmarkId = snapshot.trails[0]?.steps[0]?.landmarkId ?? snapshot.landmarks[0]?.id;
  const initialLandmark = snapshot.landmarks.find(({ id }) => id === initialLandmarkId);
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | undefined>(initialLandmarkId);
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>(repositoryPath(initialLandmark?.contentPath));
  const [contentTree, setContentTree] = useState<NoteTreeEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string>();
  const [contentRefresh, setContentRefresh] = useState(0);
  const [openDocument, setOpenDocument] = useState<NoteDocument>();
  const [documentLoading, setDocumentLoading] = useState(true);
  const [documentError, setDocumentError] = useState<string>();
  const [autoEditNoteId, setAutoEditNoteId] = useState<string>();
  const [atlasSyncError, setAtlasSyncError] = useState<string>();
  const [desktopHostAvailable] = useState(isTauri);
  const [desktopBootstrapId] = useState(desktopMonitorBootstrapId);
  const [desktopStatus, setDesktopStatus] = useState<DesktopSurfaceStatus>();
  const [desktopViewport, setDesktopViewport] = useState<Viewport>();
  const [desktopCanvasDrag, setDesktopCanvasDrag] = useState<DesktopCanvasDragEvent>();
  const [desktopChromeVisible, setDesktopChromeVisible] = useState(false);
  const [desktopInspectorDismissed, setDesktopInspectorDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mapCustomizations, setMapCustomizations] = useState(() => loadMapCustomizations(placementSnapshotKey));
  const [contentHistory] = useState(() => new ContentOperationHistory(100));
  const [contentHistoryState, setContentHistoryState] = useState<ContentHistoryState>(
    () => contentHistory.state,
  );
  const initialAllowedIds = useMemo(() => [
    ...snapshotLandmarkIds,
    ...mapCustomizations.customLandmarks.map(({ id }) => id),
  ], []);
  const [placementOverrides, setPlacementOverrides] = useState<Placement[]>(() =>
    loadPlacementOverrides(placementSnapshotKey, initialAllowedIds),
  );

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const documentCache = useRef(new Map<string, NoteDocument>());
  const revisionByPath = useRef(new Map<string, string>());
  const saveQueues = useRef(new Map<string, Promise<NoteDocument>>());
  const contentTreeFingerprintRef = useRef<string | undefined>(undefined);
  const contentTreeRefreshRef = useRef<Promise<NoteTreeEntry[] | undefined> | undefined>(undefined);
  const readRequest = useRef(0);
  const selectedLandmarkIdRef = useRef(selectedLandmarkId);
  const selectedFilePathRef = useRef(selectedFilePath);
  const selectedEditorSafetyRef = useRef<LiveNoteEditorSafety | undefined>(undefined);
  const selectedNoteRevalidationRef = useRef<() => Promise<void>>(
    () => Promise.resolve(),
  );
  const selectedNoteRevalidationRequestRef = useRef(0);
  const placementsRef = useRef(placementOverrides);
  const customizationsRef = useRef(mapCustomizations);
  const pastRef = useRef<MapHistorySnapshot[]>([]);
  const futureRef = useRef<MapHistorySnapshot[]>([]);
  const lastCheckpointRef = useRef(0);
  const atlasRevisionRef = useRef<string | null | undefined>(undefined);
  const atlasPersistenceReadyRef = useRef(false);
  const atlasPersistenceDisabledRef = useRef(atlasPersistenceDisabledForSession());
  const atlasPendingRef = useRef<AtlasPendingSnapshot | undefined>(undefined);
  const atlasWriteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const atlasWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const atlasWriteInFlightRef = useRef(false);
  const scheduleAtlasFlushRef = useRef<((delay?: number) => void) | undefined>(undefined);
  const desktopBridgeRef = useRef<DesktopWorkspaceBridge | undefined>(undefined);
  const desktopStatusRef = useRef<DesktopSurfaceStatus | undefined>(undefined);
  const deferredDesktopAtlasRef = useRef<{
    placements: Placement[];
    customizations: MapCustomizations;
  } | undefined>(undefined);
  const deferredDesktopViewportRef = useRef<Viewport | undefined>(undefined);
  selectedLandmarkIdRef.current = selectedLandmarkId;
  selectedFilePathRef.current = selectedFilePath;
  placementsRef.current = placementOverrides;
  customizationsRef.current = mapCustomizations;

  const clearActiveCanvasDocumentSelection = useCallback(() => {
    // Removing a canvas instance must not keep its backing file masquerading as
    // the active object. Invalidate pending reads as well, otherwise a slow
    // response can repopulate the now-dismissed inspector after deletion.
    selectedLandmarkIdRef.current = undefined;
    selectedFilePathRef.current = undefined;
    selectedEditorSafetyRef.current = undefined;
    readRequest.current += 1;
    selectedNoteRevalidationRequestRef.current += 1;
    setSelectedLandmarkId(undefined);
    setSelectedFilePath(undefined);
    setOpenDocument(undefined);
    setDocumentLoading(false);
    setDocumentError(undefined);
    setAutoEditNoteId(undefined);
    // Desktop controller chrome owns the Files and search surfaces as well as
    // the inspector. Suppress only the right panel so deleting a note does not
    // unexpectedly collapse the rest of the workspace controls.
    setDesktopInspectorDismissed(true);
  }, []);

  const handleEditorSafetyChange = useCallback((safety: LiveNoteEditorSafety) => {
    if (selectedFilePathRef.current !== safety.noteId) return;
    const previous = selectedEditorSafetyRef.current;
    selectedEditorSafetyRef.current = safety;
    // Opening a note already performs an authoritative read. Revalidate here
    // only when an existing edit session becomes safe again; this avoids a
    // duplicate full-note read on every ordinary file selection.
    if (
      safety.canRefreshFromDisk &&
      previous?.noteId === safety.noteId &&
      !previous.canRefreshFromDisk
    ) {
      void selectedNoteRevalidationRef.current();
    }
  }, []);

  const revalidateSelectedNote = useCallback(async () => {
    const path = selectedFilePathRef.current;
    const safety = selectedEditorSafetyRef.current;
    const expectedRevision = path ? revisionByPath.current.get(path) : undefined;
    if (
      !path || !expectedRevision ||
      safety?.noteId !== path || !safety.canRefreshFromDisk
    ) {
      return;
    }

    const request = selectedNoteRevalidationRequestRef.current + 1;
    selectedNoteRevalidationRequestRef.current = request;
    let refreshed: NoteDocument;
    try {
      refreshed = await noteRepository.readNote(path);
    } catch {
      // Focus/poll checks are passive. A transient read failure must leave the
      // healthy cached note and editor untouched; the next signal retries.
      return;
    }

    const currentSafety = selectedEditorSafetyRef.current;
    if (
      selectedNoteRevalidationRequestRef.current !== request ||
      selectedFilePathRef.current !== path ||
      refreshed.path !== path ||
      currentSafety?.noteId !== path ||
      !currentSafety.canRefreshFromDisk ||
      revisionByPath.current.get(path) !== expectedRevision
    ) {
      return;
    }
    if (refreshed.revision === expectedRevision) return;

    // Invalidate any ordinary open request that began before this revision
    // check, then atomically advance every in-memory view of the document.
    readRequest.current += 1;
    revisionByPath.current.set(path, refreshed.revision);
    documentCache.current.set(path, refreshed);
    setOpenDocument(refreshed);
    setDocumentLoading(false);
    setDocumentError(undefined);
    window.dispatchEvent(new CustomEvent("math-atlas:note-saved", {
      detail: { path, markdown: refreshed.markdown },
    }));
  }, []);
  selectedNoteRevalidationRef.current = revalidateSelectedNote;

  useEffect(() => {
    const unsubscribe = contentHistory.subscribe(setContentHistoryState);
    return () => { unsubscribe(); };
  }, [contentHistory]);

  const flushAtlasWrite = useCallback(() => {
    if (
      atlasPersistenceDisabledRef.current ||
      !atlasPersistenceReadyRef.current ||
      atlasWriteInFlightRef.current
    ) return;
    const pending = atlasPendingRef.current;
    if (!pending) return;

    atlasPendingRef.current = undefined;
    atlasWriteInFlightRef.current = true;
    const metadata = migrateLegacyAtlasState(
      pending.customizations,
      pending.placements,
    );
    let succeeded = false;
    const operation = atlasRepository.writeAtlas(
      metadata,
      atlasRevisionRef.current ?? null,
    ).then((saved) => {
      succeeded = true;
      atlasRevisionRef.current = saved.revision;
      if (saved.revision) {
        desktopBridgeRef.current?.publishAtlasRevision(saved.revision);
      }
      setAtlasSyncError(undefined);
    }).catch((error) => {
      if (!atlasPendingRef.current) atlasPendingRef.current = pending;
      const conflict = error instanceof AtlasRepositoryError && error.code === "conflict";
      setAtlasSyncError(
        conflict
          ? "The atlas file changed in another window. Your local map is intact; reload before retrying."
          : "The atlas file could not be saved. Your map is still preserved locally.",
      );
      throw error;
    }).finally(() => {
      atlasWriteInFlightRef.current = false;
    });
    atlasWriteQueueRef.current = operation.catch(() => undefined).then(() => {
      if (succeeded && atlasPendingRef.current) {
        scheduleAtlasFlushRef.current?.(80);
      }
    });
  }, []);

  const scheduleAtlasFlush = useCallback((delay = 240) => {
    if (
      atlasPersistenceDisabledRef.current ||
      !atlasPersistenceReadyRef.current
    ) return;
    if (atlasWriteTimerRef.current !== undefined) {
      clearTimeout(atlasWriteTimerRef.current);
    }
    atlasWriteTimerRef.current = setTimeout(() => {
      atlasWriteTimerRef.current = undefined;
      flushAtlasWrite();
    }, delay);
  }, [flushAtlasWrite]);
  scheduleAtlasFlushRef.current = scheduleAtlasFlush;

  const scheduleAtlasPersistence = useCallback((
    customizations: MapCustomizations,
    placements: readonly Placement[],
  ) => {
    const desktopSnapshot = {
      customizations: cloneCustomizations(customizations),
      placements: placements.map((placement) => ({ ...placement })),
    };
    const status = desktopStatusRef.current;
    const isMonitorSurface = Boolean(desktopBootstrapId) || status?.role === "monitor";
    if (isMonitorSurface) {
      const requestCommit = status?.surface?.isController !== true;
      const bridge = desktopBridgeRef.current;
      if (bridge) bridge.publishAtlas({ ...desktopSnapshot, requestCommit });
      else deferredDesktopAtlasRef.current = desktopSnapshot;
      // Companion WebViews never race the controller's revision-checked write.
      if (requestCommit) return;
    }
    atlasPendingRef.current = desktopSnapshot;
    scheduleAtlasFlush();
  }, [desktopBootstrapId, scheduleAtlasFlush]);

  const handleDesktopStatus = useCallback((next: DesktopSurfaceStatus) => {
    desktopStatusRef.current = next;
    setDesktopStatus(next);
    if (next.role !== "monitor" || !next.active) setDesktopCanvasDrag(undefined);
  }, []);

  const handleDesktopBridge = useCallback((bridge: DesktopWorkspaceBridge | undefined) => {
    desktopBridgeRef.current = bridge;
    if (!bridge) return;

    const deferredViewport = deferredDesktopViewportRef.current;
    if (deferredViewport) {
      deferredDesktopViewportRef.current = undefined;
      bridge.publishViewport(deferredViewport);
    }

    const deferredAtlas = deferredDesktopAtlasRef.current;
    if (!deferredAtlas) return;
    deferredDesktopAtlasRef.current = undefined;
    const isController = desktopStatusRef.current?.surface?.isController === true;
    bridge.publishAtlas({ ...deferredAtlas, requestCommit: !isController });
    if (isController) {
      atlasPendingRef.current = deferredAtlas;
      scheduleAtlasFlush(0);
    }
  }, [scheduleAtlasFlush]);

  const handleRemoteDesktopAtlas = useCallback((snapshot: DesktopAtlasSnapshot) => {
    const placements = snapshot.placements.map((placement) => ({ ...placement }));
    const customizations = cloneCustomizations(snapshot.customizations);
    const ids = new Set([
      ...snapshotLandmarkIds,
      ...customizations.customLandmarks.map(({ id }) => id),
    ]);
    placementsRef.current = placements;
    customizationsRef.current = customizations;
    pastRef.current = [];
    futureRef.current = [];
    savePlacementOverrides(placementSnapshotKey, placements, ids);
    saveMapCustomizations(customizations);
    setPlacementOverrides(placements);
    setMapCustomizations(customizations);

    if (
      snapshot.requestCommit &&
      desktopStatusRef.current?.surface?.isController === true
    ) {
      atlasPendingRef.current = { placements, customizations };
      scheduleAtlasFlush(0);
    }
  }, [scheduleAtlasFlush]);

  const handleRemoteDesktopSelection = useCallback((selection: DesktopSelectionSnapshot) => {
    if (!selection.landmarkId && !selection.filePath) {
      clearActiveCanvasDocumentSelection();
      return;
    }
    const sameFile = Boolean(
      selection.filePath && selectedFilePathRef.current === selection.filePath,
    );
    selectedLandmarkIdRef.current = selection.landmarkId;
    selectedFilePathRef.current = selection.filePath;
    setSelectedLandmarkId(selection.landmarkId);
    setSelectedFilePath(selection.filePath);
    setDesktopInspectorDismissed(false);
    if (sameFile) void selectedNoteRevalidationRef.current();
  }, [clearActiveCanvasDocumentSelection]);

  const handleRemoteDesktopNote = useCallback((note: DesktopNoteSnapshot) => {
    if (selectedFilePathRef.current === note.path) {
      void selectedNoteRevalidationRef.current();
      return;
    }
    documentCache.current.delete(note.path);
    revisionByPath.current.delete(note.path);
  }, []);

  const handleDesktopViewportChange = useCallback((viewport: Viewport) => {
    const bridge = desktopBridgeRef.current;
    if (bridge) bridge.publishViewport(viewport);
    else deferredDesktopViewportRef.current = viewport;
  }, []);

  const handleDesktopCanvasDrag = useCallback((event: DesktopCanvasDragEvent) => {
    desktopBridgeRef.current?.publishCanvasDrag(event);
  }, []);

  const navigationTree = useMemo(() => navigationContentTree(contentTree), [contentTree]);
  const treeIndex = useMemo(() => indexContentTree(contentTree), [contentTree]);
  const wikiLinkIndex = useMemo(
    () => buildWikiLinkIndex(wikiNotesFromContentTree(contentTree)),
    [contentTree],
  );
  const effectiveLandmarks = useMemo(() => {
    const imported = snapshot.landmarks.map((landmark) => {
      const kind = mapCustomizations.landmarkKinds[landmark.id];
      const currentPath = treeIndex.pathByLandmarkId.get(landmark.id);
      const title = currentPath
        ? titleForRepositoryPath(currentPath)
        : landmark.title;
      if ((!kind || kind === landmark.kind) && title === landmark.title) {
        return landmark;
      }
      return {
        ...landmark,
        ...(kind && kind !== landmark.kind ? { kind } : {}),
        ...(title !== landmark.title ? { title } : {}),
      };
    });
    const custom = mapCustomizations.customLandmarks.map((item) => {
      const landmark = customLandmarkModel(item);
      const kind = mapCustomizations.landmarkKinds[item.id];
      return kind && kind !== landmark.kind ? { ...landmark, kind } : landmark;
    });
    return [...imported, ...custom];
  }, [mapCustomizations.customLandmarks, mapCustomizations.landmarkKinds, treeIndex]);
  const allowedLandmarkIds = useMemo(() => new Set(effectiveLandmarks.map(({ id }) => id)), [effectiveLandmarks]);
  const effectiveLandmarkById = useMemo(() => new Map(effectiveLandmarks.map((landmark) => [landmark.id, landmark])), [effectiveLandmarks]);
  const effectiveLandmarkByStoredPath = useMemo(() => new Map(effectiveLandmarks.flatMap((landmark) => {
    const path = repositoryPath(landmark.contentPath);
    return path ? [[path.toLocaleLowerCase(), landmark] as const] : [];
  })), [effectiveLandmarks]);
  const selectedLandmark = selectedLandmarkId ? effectiveLandmarkById.get(selectedLandmarkId) : undefined;

  useEffect(() => {
    if (!selectedLandmarkId) return;
    const remainsVisible = effectiveLandmarkById.has(selectedLandmarkId) &&
      mapCustomizations.landmarks[selectedLandmarkId]?.hidden !== true;
    if (remainsVisible) return;
    clearActiveCanvasDocumentSelection();
    desktopBridgeRef.current?.publishSelection({});
  }, [clearActiveCanvasDocumentSelection, effectiveLandmarkById, mapCustomizations.landmarks, selectedLandmarkId]);

  const checkpointHistory = useCallback((force = false) => {
    const now = performance.now();
    if (!force && lastCheckpointRef.current > 0 && now - lastCheckpointRef.current < 110) return;
    const past = pastRef.current;
    past.push({
      placements: placementsRef.current.map((placement) => ({ ...placement })),
      customizations: cloneCustomizations(customizationsRef.current),
    });
    if (past.length > 100) past.shift();
    futureRef.current = [];
    lastCheckpointRef.current = now;
  }, []);

  const persistHistorySnapshot = useCallback((state: MapHistorySnapshot) => {
    const ids = new Set([
      ...snapshotLandmarkIds,
      ...state.customizations.customLandmarks.map(({ id }) => id),
    ]);
    placementsRef.current = state.placements;
    customizationsRef.current = state.customizations;
    setPlacementOverrides(state.placements);
    setMapCustomizations(state.customizations);
    savePlacementOverrides(placementSnapshotKey, state.placements, ids);
    saveMapCustomizations(state.customizations);
    scheduleAtlasPersistence(state.customizations, state.placements);
  }, [scheduleAtlasPersistence]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push({
      placements: placementsRef.current.map((placement) => ({ ...placement })),
      customizations: cloneCustomizations(customizationsRef.current),
    });
    lastCheckpointRef.current = 0;
    persistHistorySnapshot(previous);
  }, [persistHistorySnapshot]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push({
      placements: placementsRef.current.map((placement) => ({ ...placement })),
      customizations: cloneCustomizations(customizationsRef.current),
    });
    lastCheckpointRef.current = 0;
    persistHistorySnapshot(next);
  }, [persistHistorySnapshot]);

  useEffect(() => {
    const handleHistoryKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTextEditingTarget(event.target)) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(".file-explorer, [data-keyboard-scope='files']")
      ) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleHistoryKey);
    return () => window.removeEventListener("keydown", handleHistoryKey);
  }, [redo, undo]);

  const applyMapCustomizations = useCallback((updater: MapCustomizationsUpdater) => {
    // Evaluate map transactions exactly once. React Strict Mode may invoke a
    // state-setter callback twice in development; creation updaters generate
    // stable IDs and therefore must never run inside that callback.
    const next = updater(customizationsRef.current);
    if (next === customizationsRef.current) return;
    customizationsRef.current = next;
    saveMapCustomizations(next);
    setMapCustomizations(next);
    scheduleAtlasPersistence(next, placementsRef.current);
  }, [scheduleAtlasPersistence]);

  const updateMapCustomizations = useCallback((updater: MapCustomizationsUpdater) => {
    checkpointHistory();
    applyMapCustomizations(updater);
  }, [applyMapCustomizations, checkpointHistory]);

  const refreshContentTree = useCallback((
    priority: ContentTreeRefreshPriority = "foreground",
  ): Promise<NoteTreeEntry[] | undefined> => {
    // Focus, visibility and the timer can arrive together. One scan is enough;
    // sharing it also prevents a slow disk from accumulating refresh work.
    const pending = contentTreeRefreshRef.current;
    if (pending) return pending;

    if (priority === "foreground") {
      setTreeLoading(true);
      setTreeError(undefined);
    }

    let operation: Promise<NoteTreeEntry[] | undefined>;
    operation = noteRepository.listTree().then((nextTree) => {
      const fingerprint = contentTreeFingerprint(nextTree);
      if (fingerprint !== contentTreeFingerprintRef.current) {
        contentTreeFingerprintRef.current = fingerprint;
        if (priority === "background") {
          // A large imported vault can create hundreds of rows. Treat its
          // passive refresh as non-urgent so a caret or drag stays responsive.
          startTransition(() => setContentTree(nextTree));
        } else {
          setContentTree(nextTree);
        }
      }
      setTreeError(undefined);
      return nextTree;
    }).catch((error: unknown) => {
      // A transient background miss must not replace a healthy explorer with
      // an error. The existing tree remains useful and the next check retries.
      if (
        priority === "foreground" &&
        contentTreeFingerprintRef.current === undefined
      ) {
        setTreeError(error instanceof Error ? error.message : "The content folder is unavailable.");
      }
      return undefined;
    }).finally(() => {
      if (contentTreeRefreshRef.current === operation) {
        contentTreeRefreshRef.current = undefined;
      }
      if (priority === "foreground") setTreeLoading(false);
    });
    contentTreeRefreshRef.current = operation;
    return operation;
  }, []);

  const handleRemoteDesktopContent = useCallback(() => {
    // Another desktop surface changed disk state. Its private undo stack owns
    // that command; retaining local path commands here would make Ctrl+Z stale.
    contentHistory.clear();
    void refreshContentTree();
    void selectedNoteRevalidationRef.current();
  }, [contentHistory, refreshContentTree]);

  useEffect(() => {
    if (atlasPersistenceDisabledRef.current) return;
    let cancelled = false;

    void atlasRepository.readAtlas(placementSnapshotKey).then((opened) => {
      if (cancelled) return;
      if (opened.recovery?.reason === "missing") {
        atlasRevisionRef.current = null;
        atlasPersistenceReadyRef.current = true;
        if (atlasPendingRef.current) scheduleAtlasFlush(0);
        return;
      }
      if (opened.recovery) {
        atlasPersistenceReadyRef.current = false;
        setAtlasSyncError(
          "The atlas metadata file needs attention. Browser-local map data has been kept untouched.",
        );
        return;
      }

      const hydrated = atlasMetadataToLegacyState(opened.atlas);
      const allowedIds = new Set([
        ...snapshotLandmarkIds,
        ...hydrated.customizations.customLandmarks.map(({ id }) => id),
      ]);
      atlasRevisionRef.current = opened.revision;
      atlasPersistenceReadyRef.current = true;
      atlasPendingRef.current = undefined;
      placementsRef.current = hydrated.placements;
      customizationsRef.current = hydrated.customizations;
      pastRef.current = [];
      futureRef.current = [];
      savePlacementOverrides(
        placementSnapshotKey,
        hydrated.placements,
        allowedIds,
      );
      saveMapCustomizations(hydrated.customizations);
      setPlacementOverrides(hydrated.placements);
      setMapCustomizations(hydrated.customizations);
      setAtlasSyncError(undefined);
    }).catch(() => {
      if (cancelled) return;
      atlasPersistenceReadyRef.current = false;
      setAtlasSyncError(
        "The atlas file service is unavailable. Map changes will stay browser-local for now.",
      );
    });

    return () => {
      cancelled = true;
      if (atlasWriteTimerRef.current !== undefined) {
        clearTimeout(atlasWriteTimerRef.current);
        atlasWriteTimerRef.current = undefined;
      }
    };
  }, [scheduleAtlasFlush]);

  useEffect(() => { void refreshContentTree(); }, [refreshContentTree]);

  useEffect(() => {
    const refreshInBackground = () => {
      void refreshContentTree("background");
      void selectedNoteRevalidationRef.current();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") refreshInBackground();
    };

    // Returning to the app should reveal external imports immediately. The
    // low-frequency timer is a fallback for a workspace that stays foreground
    // throughout a long-running import. The selected note is revision-checked,
    // but only while its editor reports a clean, inactive state.
    window.addEventListener("focus", refreshInBackground);
    window.addEventListener("pageshow", refreshInBackground);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const poll = window.setInterval(refreshWhenVisible, CONTENT_TREE_POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", refreshInBackground);
      window.removeEventListener("pageshow", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(poll);
    };
  }, [refreshContentTree]);

  useEffect(() => {
    if (!selectedLandmarkId) return;
    // Effects from an older selection can be queued while an async creation is
    // completing. Never let that stale landmark path split the active
    // landmark/file pair (and potentially route a save to the previous file).
    if (selectedLandmarkIdRef.current !== selectedLandmarkId) return;
    const currentPath = treeIndex.pathByLandmarkId.get(selectedLandmarkId);
    if (currentPath && selectedFilePathRef.current !== currentPath) {
      selectedFilePathRef.current = currentPath;
      setSelectedFilePath(currentPath);
    }
  }, [selectedLandmarkId, treeIndex]);

  useEffect(() => {
    const path = selectedFilePath;
    if (!path) {
      setOpenDocument(undefined);
      setDocumentLoading(false);
      setDocumentError(undefined);
      return;
    }
    const request = readRequest.current + 1;
    readRequest.current = request;
    const cached = documentCache.current.get(path);
    setOpenDocument(cached);
    setDocumentLoading(!cached);
    setDocumentError(undefined);
    void noteRepository.readNote(path).then((document) => {
      if (readRequest.current !== request) return;
      documentCache.current.set(path, document);
      revisionByPath.current.set(path, document.revision);
      setOpenDocument(document);
      setDocumentLoading(false);
    }).catch((error) => {
      if (readRequest.current !== request) return;
      setDocumentLoading(false);
      setDocumentError(error instanceof Error ? error.message : "The Markdown file could not be opened.");
    });
  }, [contentRefresh, selectedFilePath]);

  const filteredLandmarks = useMemo(() => {
    const query = deferredSearchQuery.trim().toLocaleLowerCase();
    if (!query) return effectiveLandmarks;
    return effectiveLandmarks.filter((landmark) => [
      landmark.title,
      landmark.summary,
      documentCache.current.get(treeIndex.pathByLandmarkId.get(landmark.id) || repositoryPath(landmark.contentPath) || "")?.markdown || "",
      ...landmark.tags,
    ].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [deferredSearchQuery, effectiveLandmarks, treeIndex]);
  const searchMatchIds = useMemo(() => {
    if (!deferredSearchQuery.trim()) return undefined;
    return new Set(filteredLandmarks.map(({ id }) => id));
  }, [deferredSearchQuery, filteredLandmarks]);

  const handleSelectLandmark = useCallback((landmark: Landmark) => {
    const filePath = treeIndex.pathByLandmarkId.get(landmark.id) || repositoryPath(landmark.contentPath);
    const sameFile = Boolean(filePath && selectedFilePathRef.current === filePath);
    selectedLandmarkIdRef.current = landmark.id;
    selectedFilePathRef.current = filePath;
    setSelectedLandmarkId(landmark.id);
    setSelectedFilePath(filePath);
    setDesktopInspectorDismissed(false);
    desktopBridgeRef.current?.publishSelection({ landmarkId: landmark.id, filePath });
    if (sameFile) void selectedNoteRevalidationRef.current();
  }, [treeIndex]);

  const handleSelectFile = useCallback((path: string) => {
    const sameFile = selectedFilePathRef.current === path;
    selectedFilePathRef.current = path;
    setSelectedFilePath(path);
    // A file can have zero, one, or many canvas instances. Selecting it opens
    // the canonical note and lets the graph emphasize every matching instance
    // without arbitrarily choosing one as the active map object.
    selectedLandmarkIdRef.current = undefined;
    setSelectedLandmarkId(undefined);
    setDesktopInspectorDismissed(false);
    desktopBridgeRef.current?.publishSelection({ filePath: path });
    if (sameFile) void selectedNoteRevalidationRef.current();
  }, []);

  const handleNavigateWikiLink = useCallback((path: string) => {
    // Wikilinks always open the canonical file. Canvas instances remain
    // independent, just as files can exist without being placed on the map.
    handleSelectFile(path);
  }, [handleSelectFile]);

  const handlePlacementChanges = useCallback((placements: readonly Placement[]) => {
    checkpointHistory();
    setPlacementOverrides((current) => {
      const changedIds = new Set(placements.map(({ landmarkId }) => landmarkId));
      const next = current.filter(({ landmarkId }) => !changedIds.has(landmarkId));
      placements.forEach((placement) => next.push({ ...placement }));
      placementsRef.current = next;
      savePlacementOverrides(placementSnapshotKey, next, allowedLandmarkIds);
      scheduleAtlasPersistence(customizationsRef.current, next);
      return next;
    });
  }, [allowedLandmarkIds, checkpointHistory, scheduleAtlasPersistence]);

  const handlePlacementChange = useCallback((placement: Placement) => handlePlacementChanges([placement]), [handlePlacementChanges]);

  const handleLandmarkResize = useCallback((bounds: LandmarkResizeBounds) => {
    const currentCustomizations = customizationsRef.current;
    const currentPlacements = placementsRef.current;
    const customIndex = currentCustomizations.customLandmarks.findIndex(({ id }) => id === bounds.landmarkId);
    const existingAppearance = currentCustomizations.landmarks[bounds.landmarkId];
    const currentPlacement = currentPlacements.find(({ landmarkId }) => landmarkId === bounds.landmarkId);
    const placementChanged = !currentPlacement ||
      currentPlacement.x !== bounds.x ||
      currentPlacement.y !== bounds.y;
    const sizeChanged = customIndex >= 0
      ? currentCustomizations.customLandmarks[customIndex].width !== bounds.width ||
        currentCustomizations.customLandmarks[customIndex].height !== bounds.height ||
        currentCustomizations.customLandmarks[customIndex].x !== bounds.x ||
        currentCustomizations.customLandmarks[customIndex].y !== bounds.y
      : existingAppearance?.width !== bounds.width || existingAppearance?.height !== bounds.height;
    if (!placementChanged && !sizeChanged) return;

    checkpointHistory();
    const nextPlacements = currentPlacements
      .filter(({ landmarkId }) => landmarkId !== bounds.landmarkId)
      .concat({ landmarkId: bounds.landmarkId, x: bounds.x, y: bounds.y });
    let nextCustomizations: MapCustomizations;
    if (customIndex >= 0) {
      const customLandmarks = [...currentCustomizations.customLandmarks];
      customLandmarks[customIndex] = {
        ...customLandmarks[customIndex],
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
      nextCustomizations = { ...currentCustomizations, customLandmarks };
    } else {
      nextCustomizations = {
        ...currentCustomizations,
        landmarks: {
          ...currentCustomizations.landmarks,
          [bounds.landmarkId]: {
            ...existingAppearance,
            width: bounds.width,
            height: bounds.height,
          },
        },
      };
    }

    placementsRef.current = nextPlacements;
    customizationsRef.current = nextCustomizations;
    savePlacementOverrides(placementSnapshotKey, nextPlacements, allowedLandmarkIds);
    saveMapCustomizations(nextCustomizations);
    setPlacementOverrides(nextPlacements);
    setMapCustomizations(nextCustomizations);
    // One publication prevents companion monitors from ever observing a new
    // position paired with the old dimensions (or vice versa).
    scheduleAtlasPersistence(nextCustomizations, nextPlacements);
  }, [allowedLandmarkIds, checkpointHistory, scheduleAtlasPersistence]);

  const handleLandmarkKindChange = useCallback((landmarkId: string, kind: EditableLandmarkKind) => {
    updateMapCustomizations((current) => ({
      ...current,
      landmarkKinds: { ...current.landmarkKinds, [landmarkId]: kind },
      customLandmarks: current.customLandmarks.map((landmark) => landmark.id === landmarkId ? { ...landmark, kind } : landmark),
    }));
  }, [updateMapCustomizations]);

  const saveNote = useCallback((path: string, markdown: string) => {
    const previous = saveQueues.current.get(path);
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
      let expectedRevision = revisionByPath.current.get(path);
      if (!expectedRevision) {
        const opened = await noteRepository.readNote(path);
        expectedRevision = opened.revision;
        revisionByPath.current.set(path, opened.revision);
        documentCache.current.set(path, opened);
      }
      const saved = await noteRepository.writeNote(path, markdown, expectedRevision);
      readRequest.current += 1;
      revisionByPath.current.set(path, saved.revision);
      documentCache.current.set(path, saved);
      window.dispatchEvent(new CustomEvent("math-atlas:note-saved", {
        detail: { path, markdown: saved.markdown },
      }));
      if (selectedFilePathRef.current === path) {
        setOpenDocument(saved);
        setDocumentError(undefined);
      }
      return saved;
    });
    saveQueues.current.set(path, operation);
    void operation.finally(() => {
      if (saveQueues.current.get(path) === operation) saveQueues.current.delete(path);
    }).catch(() => undefined);
    return operation.then(() => undefined);
  }, []);

  const handleSaveSelectedNote = useCallback((markdown: string) => {
    if (!selectedFilePath) return Promise.reject(new Error("No Markdown file is selected."));
    return saveNote(selectedFilePath, markdown);
  }, [saveNote, selectedFilePath]);

  const handleSaveCanvasNote = useCallback((landmark: Landmark, markdown: string) => {
    const path = treeIndex.pathByLandmarkId.get(landmark.id) || repositoryPath(landmark.contentPath);
    if (!path) return Promise.reject(new Error("This Note has no writable Markdown file."));
    return saveNote(path, markdown);
  }, [saveNote, treeIndex]);

  const handleBeginCanvasNoteEdit = useCallback((landmark: Landmark) => {
    setAutoEditNoteId(undefined);
    handleSelectLandmark(landmark);
    setDesktopInspectorDismissed(true);
  }, [handleSelectLandmark]);

  const handlePlaceNotes = useCallback((requests: readonly PlaceNoteRequest[]) => {
    const seenPaths = new Set<string>();
    const prepared = requests.flatMap((request) => {
      const path = repositoryPath(request.path);
      if (!path) return [];
      const pathKey = path.toLocaleLowerCase();
      if (seenPaths.has(pathKey)) return [];
      seenPaths.add(pathKey);
      const source = (request.noteId
        ? effectiveLandmarkById.get(request.noteId)
        : undefined) ?? effectiveLandmarkByStoredPath.get(pathKey);
      const instanceId = newObjectId("instance");
      const kind = editableLandmarkKind(source?.kind ?? "concept");
      // A file's repository folder is canonical metadata. Canvas coordinates
      // describe only where this particular copy lives; they must not silently
      // reclassify a file from one repository subject as another.
      const subjectId = subjectForRepositoryPath(path) ??
        source?.subjectIds[0] ??
        request.subjectId;
      const sourceRegionId = source?.subjectIds[0] === subjectId
        ? source.regionId
        : undefined;
      const requestedRegionId = request.subjectId === subjectId
        ? request.regionId
        : undefined;
      const regionId = sourceRegionId ??
        requestedRegionId ??
        snapshot.regions.find((region) => region.subjectId === subjectId)?.id ??
        `subject-zone:${subjectId}`;
      const subject = snapshot.subjects.find(({ id }) => id === subjectId);
      return [{
        request,
        path,
        source,
        instanceId,
        kind,
        subjectId,
        regionId,
        subject,
      }];
    });
    if (!prepared.length) return;

    // One updater gives a folder/selection drop one undo checkpoint, one file
    // persistence write, and one companion-desktop publication.
    updateMapCustomizations((current) => ({
      ...current,
      customLandmarks: [
        ...current.customLandmarks,
        ...prepared.map(({
          request,
          path,
          source,
          instanceId,
          kind,
          subjectId,
          regionId,
          subject,
        }) => {
          const sourceInstance = source
            ? current.customLandmarks.find(({ id }) => id === source.id)
            : undefined;
          const sourceAppearance = source
            ? current.landmarks[source.id]
            : undefined;
          return {
            id: instanceId,
            title: request.title.trim() || contentLeafTitle(path),
            subjectId,
            regionId,
            contentPath: `content/${path}`,
            x: request.x,
            y: request.y,
            width: sourceAppearance?.width ?? sourceInstance?.width ?? 196,
            height: sourceAppearance?.height ?? sourceInstance?.height ?? (kind === "concept" ? 112 : 84),
            color: sourceAppearance?.color ?? sourceInstance?.color ??
              SUBJECT_RAINBOW_COLORS[subjectId] ?? subject?.accent ?? "#333333",
            shape: sourceAppearance?.shape ?? sourceInstance?.shape ??
              defaultLandmarkShape(kind),
            kind,
            contentMode: sourceAppearance?.contentMode ??
              sourceInstance?.contentMode ?? "title",
            formulaIndex: sourceAppearance?.formulaIndex ?? sourceInstance?.formulaIndex ?? 0,
          };
        }),
      ],
    }));

    const selected = prepared[prepared.length - 1];
    selectedFilePathRef.current = selected.path;
    selectedLandmarkIdRef.current = selected.instanceId;
    setSelectedLandmarkId(selected.instanceId);
    setSelectedFilePath(selected.path);
    setDesktopInspectorDismissed(false);
    desktopBridgeRef.current?.publishSelection({
      landmarkId: selected.instanceId,
      filePath: selected.path,
    });
  }, [effectiveLandmarkById, effectiveLandmarkByStoredPath, updateMapCustomizations]);

  const handlePlaceNote = useCallback((request: PlaceNoteRequest) => {
    handlePlaceNotes([request]);
  }, [handlePlaceNotes]);

  const handleRemoveCanvasObjects = useCallback((request: RemoveCanvasObjectsRequest) => {
    const current = customizationsRef.current;
    const liveLandmarkIds = new Set([
      ...snapshotLandmarkIds,
      ...current.customLandmarks.map(({ id }) => id),
    ]);
    const liveCustomGroupIds = new Set(current.customGroups.map(({ id }) => id));
    const liveConnectionIds = new Set([
      ...snapshot.connections.map(({ id }) => id),
      ...current.customConnections.map(({ id }) => id),
    ]);
    const landmarkIds = new Set(request.landmarkIds.filter((id) => liveLandmarkIds.has(id)));
    const customGroupIds = new Set(request.customGroupIds.filter((id) => liveCustomGroupIds.has(id)));
    const connectionIds = new Set(request.connectionIds.filter((id) => liveConnectionIds.has(id)));
    if (!landmarkIds.size && !customGroupIds.size && !connectionIds.size) return;

    checkpointHistory(true);
    const customInstanceIds = new Set(
      current.customLandmarks
        .filter(({ id }) => landmarkIds.has(id))
        .map(({ id }) => id),
    );
    const landmarkKinds = { ...current.landmarkKinds };
    const landmarkAppearances = { ...current.landmarks };
    landmarkIds.forEach((id) => {
      if (customInstanceIds.has(id)) {
        delete landmarkKinds[id];
        delete landmarkAppearances[id];
      } else {
        landmarkAppearances[id] = { ...landmarkAppearances[id], hidden: true };
      }
    });

    const customGroupById = new Map(current.customGroups.map((group) => [group.id, group]));
    const customGroups = current.customGroups.flatMap((group) => {
      if (customGroupIds.has(group.id)) return [];
      let parentId = group.parentId;
      const seen = new Set<string>();
      while (parentId && customGroupIds.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        parentId = customGroupById.get(parentId)?.parentId;
      }
      if (parentId === group.parentId) return [group];
      const { parentId: _discarded, ...withoutParent } = group;
      return [{ ...withoutParent, ...(parentId ? { parentId } : {}) }];
    });
    const removedEndpoints = new Set([
      ...landmarkIds,
      ...[...customGroupIds].map((id) => `custom-group:${id}`),
    ]);
    const customConnectionIds = new Set(current.customConnections.map(({ id }) => id));
    const customConnections = current.customConnections.filter(({ id, source, target }) => (
      !connectionIds.has(id) &&
      !removedEndpoints.has(source) &&
      !removedEndpoints.has(target)
    ));
    const connectionOverrides = { ...current.connectionOverrides };
    connectionIds.forEach((id) => {
      if (customConnectionIds.has(id)) return;
      connectionOverrides[id] = { ...connectionOverrides[id], hidden: true };
    });
    const nextCustomizations: MapCustomizations = {
      ...current,
      landmarkKinds,
      landmarks: landmarkAppearances,
      customLandmarks: current.customLandmarks.filter(({ id }) => !landmarkIds.has(id)),
      customGroups,
      customConnections,
      connectionOverrides,
    };
    const nextPlacements = placementsRef.current.filter(
      (placement) => !landmarkIds.has(placement.landmarkId),
    );
    const allowedIds = new Set([
      ...snapshotLandmarkIds,
      ...nextCustomizations.customLandmarks.map(({ id }) => id),
    ]);

    customizationsRef.current = nextCustomizations;
    placementsRef.current = nextPlacements;
    saveMapCustomizations(nextCustomizations);
    savePlacementOverrides(placementSnapshotKey, nextPlacements, allowedIds);
    setMapCustomizations(nextCustomizations);
    setPlacementOverrides(nextPlacements);
    scheduleAtlasPersistence(nextCustomizations, nextPlacements);

    const activeLandmarkId = selectedLandmarkIdRef.current;
    if (activeLandmarkId && landmarkIds.has(activeLandmarkId)) {
      clearActiveCanvasDocumentSelection();
      desktopBridgeRef.current?.publishSelection({});
    }
  }, [checkpointHistory, clearActiveCanvasDocumentSelection, scheduleAtlasPersistence]);

  const handleCreateLandmark = useCallback(async (request: NewLandmarkRequest) => {
    const id = newObjectId("landmark");
    const isInformalNote = request.kind === "concept";
    const requestedTitle = request.title.trim().replace(/\.md$/i, "");
    if (!isInformalNote && !requestedTitle) throw new Error("Enter a name.");
    const canonicalMarkdown = landmarkFileTemplate({
      id,
      kind: request.kind,
      subjectId: request.subjectId,
    });
    const title = isInformalNote ? "Note" : requestedTitle;
    const relativePath = isInformalNote
      ? `notes/atlas-note-${id}.md`
      : childContentPath("", requestedTitle, true);
    try {
      const created = await noteRepository.writeNote(relativePath, canonicalMarkdown, null);
      const editableDocument: NoteDocument = {
        ...created,
        id,
        // Creation writes the complete canonical file. The editor contract is
        // body-only, matching every subsequent repository read.
        markdown: noteBodyTemplate(request.kind),
      };
      documentCache.current.set(relativePath, editableDocument);
      revisionByPath.current.set(relativePath, editableDocument.revision);
      // The selection that was active while creation awaited disk I/O may
      // still have a read in flight. It must never overwrite the new paper's
      // empty body after the caret has moved there.
      readRequest.current += 1;
      selectedNoteRevalidationRequestRef.current += 1;
      selectedEditorSafetyRef.current = undefined;
      updateMapCustomizations((current) => ({
        ...current,
        customLandmarks: [...current.customLandmarks, {
          id,
          title,
          kind: request.kind,
          subjectId: request.subjectId,
          regionId: request.regionId,
          contentPath: `content/${relativePath}`,
          x: request.x,
          y: request.y,
          width: 196,
          height: request.kind === "concept" ? 112 : 84,
          color: request.color,
          shape: request.shape,
          ...(isInformalNote ? { contentMode: "note" as const } : {}),
        }],
      }));
      selectedFilePathRef.current = relativePath;
      selectedLandmarkIdRef.current = id;
      setSelectedLandmarkId(id);
      setSelectedFilePath(relativePath);
      setDesktopInspectorDismissed(isInformalNote);
      setOpenDocument(editableDocument);
      setDocumentLoading(false);
      setDocumentError(undefined);
      if (isInformalNote) {
        setAutoEditNoteId(id);
      }
      desktopBridgeRef.current?.publishSelection({ landmarkId: id, filePath: relativePath });
      await refreshContentTree();
      desktopBridgeRef.current?.publishContentChanged();
      setContentRefresh((value) => value + 1);
    } catch (error) {
      if (error instanceof NoteRepositoryError && error.code === "conflict") {
        if (isInformalNote) {
          throw new Error("The note could not be created. Try again.");
        }
        throw new Error(`A note named “${requestedTitle}” already exists in the content root.`);
      }
      throw error instanceof Error
        ? error
        : new Error("The note could not be created.");
    }
  }, [refreshContentTree, updateMapCustomizations]);

  const flushPendingContentSaves = useCallback(async (paths: readonly string[]) => {
    const pending = new Set<Promise<NoteDocument>>();
    for (const [candidate, operation] of saveQueues.current.entries()) {
      if (paths.some((path) => movedContentPath(candidate, path, path))) {
        pending.add(operation);
      }
    }
    if (pending.size) await Promise.all(pending);
  }, []);

  const refreshAfterContentMutation = useCallback(async () => {
    const nextTree = await refreshContentTree();
    desktopBridgeRef.current?.publishContentChanged();
    return nextTree;
  }, [refreshContentTree]);

  const applyContentMoveState = useCallback((moves: readonly ContentMove[]) => {
    if (!moves.length) return;

    const movedDocuments = [...documentCache.current.entries()].flatMap(
      ([oldPath, document]) => {
        const nextPath = contentPathAfterMoves(oldPath, moves);
        return nextPath === oldPath ? [] : [{ oldPath, nextPath, document }];
      },
    );
    movedDocuments.forEach(({ oldPath }) => documentCache.current.delete(oldPath));
    movedDocuments.forEach(({ nextPath, document }) => {
      documentCache.current.set(nextPath, { ...document, path: nextPath });
    });

    const movedRevisions = [...revisionByPath.current.entries()].flatMap(
      ([oldPath, revision]) => {
        const nextPath = contentPathAfterMoves(oldPath, moves);
        return nextPath === oldPath ? [] : [{ oldPath, nextPath, revision }];
      },
    );
    movedRevisions.forEach(({ oldPath }) => revisionByPath.current.delete(oldPath));
    movedRevisions.forEach(({ nextPath, revision }) => {
      revisionByPath.current.set(nextPath, revision);
    });

    const remapSnapshot = (snapshotState: MapHistorySnapshot): MapHistorySnapshot => {
      const customizations = mapCustomizationsAfterContentMoves(
        snapshotState.customizations,
        moves,
      );
      return customizations === snapshotState.customizations
        ? snapshotState
        : { ...snapshotState, customizations };
    };
    pastRef.current = pastRef.current.map(remapSnapshot);
    futureRef.current = futureRef.current.map(remapSnapshot);
    applyMapCustomizations((current) => mapCustomizationsAfterContentMoves(current, moves));

    const selectedPath = selectedFilePathRef.current;
    if (!selectedPath) return;
    const nextSelectedPath = contentPathAfterMoves(selectedPath, moves);
    if (nextSelectedPath === selectedPath) return;
    selectedFilePathRef.current = nextSelectedPath;
    setSelectedFilePath(nextSelectedPath);
    const cached = documentCache.current.get(nextSelectedPath);
    if (cached) setOpenDocument(cached);
    desktopBridgeRef.current?.publishSelection({
      ...(selectedLandmarkId ? { landmarkId: selectedLandmarkId } : {}),
      filePath: nextSelectedPath,
    });
  }, [applyMapCustomizations, selectedLandmarkId]);

  const commitContentMoves = useCallback(async (moves: readonly ContentMove[]) => {
    if (!moves.length) return [] as ContentMove[];
    await flushPendingContentSaves(moves.map(({ sourcePath }) => sourcePath));
    let results: ContentMutationResult[];
    try {
      results = await executeContentMoveTransaction(noteRepository, moves);
    } catch (error) {
      if (
        error instanceof ContentMoveTransactionError &&
        error.unrecoveredMoves.length
      ) {
        applyContentMoveState(error.unrecoveredMoves);
      }
      await refreshAfterContentMutation();
      throw error;
    }
    const committed = moves.map((move, index) => ({
      ...move,
      destinationPath: results[index]?.path ?? move.destinationPath,
      type: results[index]?.type ?? move.type,
    }));
    applyContentMoveState(committed);
    await refreshAfterContentMutation();
    return committed;
  }, [applyContentMoveState, flushPendingContentSaves, refreshAfterContentMutation]);

  const recordMoveHistory = useCallback((moves: readonly ContentMove[], label: string) => {
    contentHistory.record({
      label,
      undo: async () => {
        await commitContentMoves(reverseContentMoves(moves));
      },
      redo: async () => {
        await commitContentMoves(moves);
      },
    });
  }, [commitContentMoves, contentHistory]);

  const entriesForPaths = useCallback((paths: readonly string[]) => {
    const entries: ContentSelectionEntry[] = paths.map((path) => {
      const entry = treeIndex.entryByPath.get(path.toLocaleLowerCase());
      if (!entry) throw new Error(`“${contentLeafTitle(path)}” is no longer in the content tree.`);
      return { path: entry.path, type: entry.type };
    });
    return compactContentSelection(entries);
  }, [treeIndex.entryByPath]);

  const applyTrashedState = useCallback(async (paths: readonly string[]) => {
    for (const cachedPath of [...documentCache.current.keys()]) {
      if (paths.some((path) => movedContentPath(cachedPath, path, path))) {
        documentCache.current.delete(cachedPath);
        revisionByPath.current.delete(cachedPath);
      }
    }
    const selectedPath = selectedFilePathRef.current;
    if (selectedPath && paths.some((path) => movedContentPath(selectedPath, path, path))) {
      readRequest.current += 1;
      setOpenDocument(undefined);
      setDocumentLoading(false);
      setDocumentError(
        "This note is in Trash. Its landmark remains on the map and can be restored from Files.",
      );
    }
    await refreshAfterContentMutation();
  }, [refreshAfterContentMutation]);

  const applyRestoredState = useCallback(async (
    restored: readonly ContentMutationResult[],
  ) => {
    const nextTree = await refreshAfterContentMutation();
    const selectedPath = selectedFilePathRef.current;
    const restoresSelection = selectedPath && restored.some(({ path }) => (
      movedContentPath(selectedPath, path, path)
    ));
    if (!selectedPath || !restoresSelection) return;
    selectedFilePathRef.current = selectedPath;
    setSelectedFilePath(selectedPath);
    const refreshedIndex = nextTree ? indexContentTree(nextTree) : undefined;
    const refreshedFile = refreshedIndex?.fileByPath.get(selectedPath.toLocaleLowerCase());
    const landmark =
      (refreshedFile?.id ? effectiveLandmarkById.get(refreshedFile.id) : undefined) ||
      effectiveLandmarkByStoredPath.get(selectedPath.toLocaleLowerCase());
    setSelectedLandmarkId(landmark?.id);
    setDocumentError(undefined);
    setDocumentLoading(true);
    setContentRefresh((value) => value + 1);
  }, [effectiveLandmarkById, effectiveLandmarkByStoredPath, refreshAfterContentMutation]);

  const reconcileTrashFailure = useCallback(async (
    error: unknown,
    fallbackBatch?: ContentTrashBatch,
  ) => {
    const batch = error instanceof ContentTrashTransactionError
      ? error.batch
      : fallbackBatch;
    const trashedPaths = batch?.state.flatMap((item) => (
      item.location === "trash" ? [item.path] : []
    )) ?? [];
    if (trashedPaths.length) await applyTrashedState(trashedPaths);
    else await refreshAfterContentMutation();

    const selectedPath = selectedFilePathRef.current;
    const selectedIsTrashed = selectedPath && trashedPaths.some((path) => (
      movedContentPath(selectedPath, path, path)
    ));
    if (!selectedIsTrashed) setContentRefresh((value) => value + 1);
  }, [applyTrashedState, refreshAfterContentMutation]);

  const recordCreatedContent = useCallback((entry: ContentSelectionEntry) => {
    let batch: ContentTrashBatch | undefined;
    contentHistory.record({
      label: `Create ${entry.type === "file" ? "note" : "folder"}`,
      undo: async () => {
        await flushPendingContentSaves([entry.path]);
        try {
          if (batch) await batch.moveToTrash();
          else batch = await ContentTrashBatch.fromLiveEntries(noteRepository, [entry]);
        } catch (error) {
          await reconcileTrashFailure(error, batch);
          throw error;
        }
        await applyTrashedState([entry.path]);
      },
      redo: async () => {
        if (!batch) throw new Error("The created item is no longer available in history.");
        let restored: readonly ContentMutationResult[];
        try {
          restored = await batch.restore();
        } catch (error) {
          await reconcileTrashFailure(error, batch);
          throw error;
        }
        await applyRestoredState(restored);
      },
    });
  }, [
    applyRestoredState,
    applyTrashedState,
    contentHistory,
    flushPendingContentSaves,
    reconcileTrashFailure,
  ]);

  const handleCreateFileNote = useCallback(async (parentPath: string, name: string) => {
    const relativePath = childContentPath(parentPath, name, true);
    const created = await noteRepository.writeNote(relativePath, "", null);
    documentCache.current.set(relativePath, created);
    revisionByPath.current.set(relativePath, created.revision);
    selectedFilePathRef.current = relativePath;
    setSelectedFilePath(relativePath);
    selectedLandmarkIdRef.current = undefined;
    setSelectedLandmarkId(undefined);
    setDesktopInspectorDismissed(false);
    desktopBridgeRef.current?.publishSelection({ filePath: relativePath });
    setOpenDocument(created);
    setDocumentLoading(false);
    setDocumentError(undefined);
    await refreshAfterContentMutation();
    recordCreatedContent({ path: relativePath, type: "file" });
    return relativePath;
  }, [recordCreatedContent, refreshAfterContentMutation]);

  const handleCreateContentFolder = useCallback(async (parentPath: string, name: string) => {
    const relativePath = childContentPath(parentPath, name);
    await noteRepository.createFolder(relativePath);
    await refreshAfterContentMutation();
    recordCreatedContent({ path: relativePath, type: "directory" });
    return relativePath;
  }, [recordCreatedContent, refreshAfterContentMutation]);

  const handleMoveContentEntries = useCallback(async (
    entries: readonly FileExplorerMoveEntry[],
  ) => {
    const moves: ContentMove[] = entries.map(({ path, destinationPath }) => {
      const entry = treeIndex.entryByPath.get(path.toLocaleLowerCase());
      if (!entry) throw new Error(`“${contentLeafTitle(path)}” is no longer in the content tree.`);
      return { sourcePath: entry.path, destinationPath, type: entry.type };
    });
    const committed = await commitContentMoves(moves);
    if (committed.length) {
      recordMoveHistory(
        committed,
        `Move ${committed.length === 1 ? contentLeafTitle(committed[0].sourcePath) : `${committed.length} items`}`,
      );
    }
    return committed.map(({ destinationPath }) => destinationPath);
  }, [commitContentMoves, recordMoveHistory, treeIndex.entryByPath]);

  const handleRenameContentEntry = useCallback(async (sourcePath: string, name: string) => {
    const entry = treeIndex.entryByPath.get(sourcePath.toLocaleLowerCase());
    if (!entry) throw new Error(`“${contentLeafTitle(sourcePath)}” is no longer in the content tree.`);
    const parent = sourcePath.includes("/")
      ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
      : "";
    const destinationPath = childContentPath(parent, name, entry.type === "file");
    if (sourcePath === destinationPath) return sourcePath;
    const [committed] = await commitContentMoves([{
      sourcePath: entry.path,
      destinationPath,
      type: entry.type,
    }]);
    if (!committed) return sourcePath;
    recordMoveHistory([committed], `Rename ${contentLeafTitle(sourcePath)}`);
    return committed.destinationPath;
  }, [commitContentMoves, recordMoveHistory, treeIndex.entryByPath]);

  const handleTrashContentEntries = useCallback(async (paths: readonly string[]) => {
    const entries = entriesForPaths(paths);
    if (!entries.length) return [];
    await flushPendingContentSaves(entries.map(({ path }) => path));
    let batch: ContentTrashBatch;
    try {
      batch = await ContentTrashBatch.fromLiveEntries(noteRepository, entries);
    } catch (error) {
      await reconcileTrashFailure(error);
      throw error;
    }
    const receipts = batch.state.flatMap(({ receipt }) => receipt ? [receipt] : []);
    await applyTrashedState(entries.map(({ path }) => path));
    contentHistory.record({
      label: `Move ${entries.length === 1 ? contentLeafTitle(entries[0].path) : `${entries.length} items`} to Trash`,
      undo: async () => {
        let restored: readonly ContentMutationResult[];
        try {
          restored = await batch.restore();
        } catch (error) {
          await reconcileTrashFailure(error, batch);
          throw error;
        }
        await applyRestoredState(restored);
      },
      redo: async () => {
        await flushPendingContentSaves(entries.map(({ path }) => path));
        try {
          await batch.moveToTrash();
        } catch (error) {
          await reconcileTrashFailure(error, batch);
          throw error;
        }
        await applyTrashedState(entries.map(({ path }) => path));
      },
    });
    return receipts;
  }, [
    applyRestoredState,
    applyTrashedState,
    contentHistory,
    entriesForPaths,
    flushPendingContentSaves,
    reconcileTrashFailure,
  ]);

  const handleTrashContentEntry = useCallback(async (path: string) => {
    const [receipt] = await handleTrashContentEntries([path]);
    if (!receipt) throw new Error("The item could not be moved to Trash.");
    return receipt;
  }, [handleTrashContentEntries]);

  const handleRestoreContentEntry = useCallback(async (receipt: DeletedContentReceipt) => {
    const batch = ContentTrashBatch.fromReceipts(noteRepository, [receipt]);
    let restoredEntries: readonly ContentMutationResult[];
    try {
      restoredEntries = await batch.restore();
    } catch (error) {
      await reconcileTrashFailure(error, batch);
      throw error;
    }
    const [restored] = restoredEntries;
    if (!restored) throw new Error("The item could not be restored.");
    await applyRestoredState([restored]);
    return restored.path;
  }, [applyRestoredState, reconcileTrashFailure]);

  const fileExplorerActions = useMemo<FileExplorerActions>(() => ({
    createNote: handleCreateFileNote,
    createFolder: handleCreateContentFolder,
    rename: handleRenameContentEntry,
    move: handleMoveContentEntries,
    trash: handleTrashContentEntry,
    trashMany: handleTrashContentEntries,
    restore: handleRestoreContentEntry,
    undo: () => contentHistory.undo(),
    redo: () => contentHistory.redo(),
    canUndo: contentHistoryState.canUndo,
    canRedo: contentHistoryState.canRedo,
  }), [
    contentHistory,
    contentHistoryState.canRedo,
    contentHistoryState.canUndo,
    handleCreateContentFolder,
    handleCreateFileNote,
    handleMoveContentEntries,
    handleRenameContentEntry,
    handleRestoreContentEntry,
    handleTrashContentEntries,
    handleTrashContentEntry,
  ]);

  const handleRefresh = useCallback(() => {
    void refreshContentTree();
    setContentRefresh((value) => value + 1);
  }, [refreshContentTree]);

  const retryAtlasSync = useCallback(() => {
    if (!atlasPersistenceReadyRef.current) {
      window.location.reload();
      return;
    }
    atlasPendingRef.current = {
      customizations: cloneCustomizations(customizationsRef.current),
      placements: placementsRef.current.map((placement) => ({ ...placement })),
    };
    setAtlasSyncError(undefined);
    scheduleAtlasFlush(0);
  }, [scheduleAtlasFlush]);

  const effectiveMarkdown = openDocument && openDocument.path === selectedFilePath ? openDocument.markdown : undefined;
  const selectedLandmarkPath = selectedLandmark
    ? treeIndex.pathByLandmarkId.get(selectedLandmark.id) || repositoryPath(selectedLandmark.contentPath)
    : undefined;
  const selectedCanvasMarkdown = selectedLandmarkPath === selectedFilePath
    ? effectiveMarkdown ?? documentCache.current.get(selectedLandmarkPath ?? "")?.markdown
    : undefined;
  const previewMarkdownByLandmarkId = useMemo(() => (
    selectedLandmarkId &&
    selectedCanvasMarkdown !== undefined
      ? new Map([[selectedLandmarkId, selectedCanvasMarkdown]])
      : undefined
  ), [selectedCanvasMarkdown, selectedLandmarkId]);
  const hasLiveDocument = openDocument?.path === selectedFilePath && !documentError && !documentLoading;
  const desktopMonitorMode = Boolean(desktopBootstrapId) || desktopStatus?.role === "monitor";
  const desktopIsController = desktopStatus?.surface?.isController === true;
  const showDesktopChrome = desktopMonitorMode && desktopIsController && desktopChromeVisible;
  const showFileSidebar = desktopMonitorMode ? showDesktopChrome : fileVisibility.visible;
  const hasValidInspectorSelection = selectedLandmarkId
    ? Boolean(selectedLandmark)
    : Boolean(selectedFilePath);
  const showInspector = desktopMonitorMode
    ? showDesktopChrome && !desktopInspectorDismissed && hasValidInspectorSelection
    : inspectorVisibility.visible && !desktopInspectorDismissed && hasValidInspectorSelection;
  const showSearch = !desktopMonitorMode || showDesktopChrome;
  const collapseDesktopChrome = () => {
    setDesktopChromeVisible(false);
  };
  const appShellStyle = {
    "--file-sidebar-width": `${fileSidebarPanel.size}px`,
    gridTemplateColumns: showFileSidebar
      ? "var(--file-sidebar-width) var(--panel-resizer-size) minmax(0, 1fr)"
      : "0 0 minmax(0, 1fr)",
  } as CSSProperties;
  const workspaceContentStyle = {
    "--inspector-width": `${inspectorPanel.size}px`,
    gridTemplateColumns: showInspector
      ? "minmax(320px, 1fr) var(--panel-resizer-size) var(--inspector-width)"
      : "minmax(0, 1fr) 0 0",
  } as CSSProperties;
  return (
    <div
      className="app-shell"
      data-desktop-surface={desktopMonitorMode ? "active" : "workspace"}
      style={appShellStyle}
    >
      <aside id="file-sidebar" className="file-sidebar" hidden={!showFileSidebar}>
        {treeError ? (
          <div className="file-sidebar__message" role="status"><FolderTree size={15} aria-hidden="true" /><span>{treeError}</span></div>
        ) : (
          <Suspense fallback={<div className="file-sidebar__message" aria-label="Loading files" />}>
            <FileExplorer
              nodes={navigationTree}
              selectedContentPath={selectedFilePath}
              onSelectFile={handleSelectFile}
              actions={fileExplorerActions}
              headerActions={(
                <>
                  <button type="button" className="file-refresh-button" aria-label="Refresh files" title="Refresh files" onClick={handleRefresh} disabled={treeLoading}><RefreshCw size={13} aria-hidden="true" /></button>
                  <button type="button" className="panel-hide" aria-label="Hide file sidebar" title="Hide file sidebar" onClick={desktopMonitorMode ? collapseDesktopChrome : fileVisibility.hide}><PanelLeftClose size={14} aria-hidden="true" /></button>
                </>
              )}
            />
          </Suspense>
        )}
      </aside>

      {showFileSidebar && (
        <PanelResizer
          label="Resize file sidebar"
          panel="file-sidebar"
          value={fileSidebarPanel.size}
          min={fileSidebarSize.min}
          max={fileSidebarSize.max}
          direction={1}
          onResize={fileSidebarPanel.resize}
          onResizeEnd={fileSidebarPanel.commit}
        />
      )}

      <section className="workspace-shell">
        {showSearch && (
          <SearchBar
            searchQuery={searchQuery}
            resultCount={filteredLandmarks.length}
            onSearch={setSearchQuery}
            compact={!showFileSidebar && !showInspector}
          />
        )}
        {!desktopMonitorMode && !showFileSidebar && (
          <button type="button" className="sidebar-restore sidebar-restore--left" aria-label="Show file sidebar" title="Show file sidebar" aria-controls="file-sidebar" aria-expanded="false" onClick={fileVisibility.show}><PanelLeftOpen size={13} aria-hidden="true" /></button>
        )}
        {!desktopMonitorMode && !showInspector && (
          <button type="button" className="sidebar-restore sidebar-restore--right" aria-label="Show note sidebar" title="Show note sidebar" aria-controls="note-sidebar" aria-expanded="false" onClick={() => { setDesktopInspectorDismissed(false); inspectorVisibility.show(); }}><PanelRightOpen size={13} aria-hidden="true" /></button>
        )}
        {desktopHostAvailable && (
          <Suspense fallback={null}>
            <DesktopSurfaceController
              chromeVisible={desktopChromeVisible}
              onChromeVisibleChange={(visible) => {
                setDesktopChromeVisible(visible);
                if (visible) setDesktopInspectorDismissed(false);
              }}
              onStatusChange={handleDesktopStatus}
              onBridgeChange={handleDesktopBridge}
              onRemoteViewport={setDesktopViewport}
              onRemoteSelection={handleRemoteDesktopSelection}
              onRemoteAtlas={handleRemoteDesktopAtlas}
              onRemoteAtlasRevision={(revision) => {
                atlasRevisionRef.current = revision;
              }}
              onRemoteNote={handleRemoteDesktopNote}
              onRemoteContentChanged={handleRemoteDesktopContent}
              onRemoteCanvasDrag={setDesktopCanvasDrag}
            />
          </Suspense>
        )}
        {atlasSyncError && (
          <div className="atlas-sync-alert" role="alert">
            <span>{atlasSyncError}</span>
            <button
              type="button"
              aria-label="Retry atlas file sync"
              title="Retry"
              onClick={retryAtlasSync}
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="workspace-content" style={workspaceContentStyle}>
          <main className="atlas-workspace">
            <Suspense fallback={<div className="atlas-graph-loading" aria-label="Loading map" />}>
              <AtlasGraph
                key={desktopMonitorMode
                  ? `desktop-canvas:${desktopStatus?.surface?.id ?? desktopBootstrapId}`
                  : "workspace-canvas"}
                snapshot={snapshot}
                landmarks={effectiveLandmarks}
                groupLandmarks={effectiveLandmarks}
                searchMatchIds={searchMatchIds}
                viewportStorageKey={desktopMonitorMode ? undefined : placementSnapshotKey}
                externalViewport={desktopMonitorMode ? desktopViewport : undefined}
                onViewportChange={desktopMonitorMode ? handleDesktopViewportChange : undefined}
                deferInitialViewport={desktopMonitorMode && !desktopIsController && !desktopViewport}
                viewportScaleFactor={desktopMonitorMode
                  ? rendererPixelScale(
                      window.devicePixelRatio,
                      desktopStatus?.windowScaleFactor,
                      desktopStatus?.surface?.scaleFactor,
                    )
                  : 1}
                desktopSurfaceId={desktopMonitorMode
                  ? desktopStatus?.surface?.id ?? desktopBootstrapId
                  : undefined}
                desktopCanvasDrag={desktopMonitorMode ? desktopCanvasDrag : undefined}
                onDesktopCanvasDrag={desktopMonitorMode ? handleDesktopCanvasDrag : undefined}
                selectedLandmarkId={selectedLandmarkId}
                selectedContentPath={selectedFilePath}
                previewMarkdownByLandmarkId={previewMarkdownByLandmarkId}
                autoEditNoteId={autoEditNoteId}
                placementOverrides={placementOverrides}
                customizations={mapCustomizations}
                onSelectLandmark={handleSelectLandmark}
                onPlacementChange={handlePlacementChange}
                onPlacementChanges={handlePlacementChanges}
                onLandmarkResize={handleLandmarkResize}
                onKindChange={handleLandmarkKindChange}
                onCustomizationsChange={updateMapCustomizations}
                onBeginNoteEdit={handleBeginCanvasNoteEdit}
                onSaveNote={handleSaveCanvasNote}
                onCreateLandmark={handleCreateLandmark}
                onPlaceNote={handlePlaceNote}
                onPlaceNotes={handlePlaceNotes}
                onRemoveCanvasObjects={handleRemoveCanvasObjects}
              />
            </Suspense>
          </main>

          {showInspector && (
            <PanelResizer
              label="Resize note sidebar"
              panel="inspector"
              value={inspectorPanel.size}
              min={inspectorSize.min}
              max={inspectorSize.max}
              direction={-1}
              onResize={inspectorPanel.resize}
              onResizeEnd={inspectorPanel.commit}
            />
          )}

          <div id="note-sidebar" hidden={!showInspector}>
            <InspectorPanel
              landmark={selectedLandmark}
              title={selectedLandmark && mathNoteType(selectedLandmark.kind) === "note"
                ? "Note"
                : selectedFilePath ? titleForRepositoryPath(selectedFilePath) : selectedLandmark?.title}
              contentPath={selectedFilePath}
              markdown={effectiveMarkdown}
              loading={documentLoading && !effectiveMarkdown}
              errorMessage={documentError ? `${documentError} Showing imported content when available.` : undefined}
              editable={hasLiveDocument}
              onSave={hasLiveDocument ? handleSaveSelectedNote : undefined}
              wikiLinkIndex={wikiLinkIndex}
              onNavigateWikiLink={handleNavigateWikiLink}
              onEditorSafetyChange={handleEditorSafetyChange}
              onCollapse={desktopMonitorMode ? collapseDesktopChrome : inspectorVisibility.hide}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
