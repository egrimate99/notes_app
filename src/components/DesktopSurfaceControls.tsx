import {
  AppWindow,
  MonitorUp,
  PanelTopClose,
  PanelTopOpen,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cameraToLocalViewport,
  localViewportToCamera,
  surfaceWithRendererScale,
  type CanonicalDesktopCamera,
} from "../services/desktopProjection";
import {
  desktopStatusTargetsRecipient,
  desktopSurface,
  sameDesktopStatusDelivery,
  type DesktopSurfaceStatus,
} from "../services/desktopSurface";
import {
  DesktopWorkspaceSync,
  type DesktopAtlasSnapshot,
  type DesktopNoteSnapshot,
  type DesktopSelectionSnapshot,
  type DesktopWorkspaceBridge,
} from "../services/desktopWorkspaceSync";
import type { DesktopCanvasDragEvent } from "../services/desktopCanvasDrag";

type DesktopSurfaceOperation = "enter" | "exit" | "status";

interface DesktopSurfaceFailure {
  operation: DesktopSurfaceOperation;
  message: string;
}

interface DesktopSurfaceControllerProps {
  chromeVisible: boolean;
  onChromeVisibleChange: (visible: boolean) => void;
  onStatusChange: (status: DesktopSurfaceStatus) => void;
  onBridgeChange: (bridge: DesktopWorkspaceBridge | undefined) => void;
  onRemoteViewport: DesktopWorkspaceBridge["publishViewport"];
  onRemoteSelection: (selection: DesktopSelectionSnapshot) => void;
  onRemoteAtlas: (snapshot: DesktopAtlasSnapshot) => void;
  onRemoteAtlasRevision: (revision: string) => void;
  onRemoteNote: (note: DesktopNoteSnapshot) => void;
  onRemoteContentChanged: () => void;
  onRemoteCanvasDrag: (event: DesktopCanvasDragEvent) => void;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The desktop canvas could not be changed.";
}

function bootstrapMonitorId() {
  try {
    return new URLSearchParams(window.location.search).get("desktopSurface") || undefined;
  } catch {
    return undefined;
  }
}

interface NoteSavedEventDetail extends DesktopNoteSnapshot {
  source?: "desktop-sync";
}

/**
 * Native-only controller and multi-WebView bridge. Keeping projection, IPC,
 * polling and cross-window assets in this deferred boundary leaves the browser
 * workspace unchanged and out of the synchronization hot path.
 */
export function DesktopSurfaceController(props: DesktopSurfaceControllerProps) {
  const {
    chromeVisible,
    onChromeVisibleChange,
    onStatusChange,
    onBridgeChange,
    onRemoteViewport,
    onRemoteSelection,
    onRemoteAtlas,
    onRemoteAtlasRevision,
    onRemoteNote,
    onRemoteContentChanged,
    onRemoteCanvasDrag,
  } = props;
  const [hostAvailable] = useState(() => desktopSurface.isAvailable());
  const [expectedMonitorId] = useState(bootstrapMonitorId);
  const [status, setStatus] = useState<DesktopSurfaceStatus>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DesktopSurfaceFailure>();
  const revisionRef = useRef(-1);
  const statusRef = useRef<DesktopSurfaceStatus | undefined>(undefined);
  const callbacksRef = useRef({
    onChromeVisibleChange,
    onStatusChange,
    onBridgeChange,
    onRemoteViewport,
    onRemoteSelection,
    onRemoteAtlas,
    onRemoteAtlasRevision,
    onRemoteNote,
    onRemoteContentChanged,
    onRemoteCanvasDrag,
  });
  callbacksRef.current = {
    onChromeVisibleChange,
    onStatusChange,
    onBridgeChange,
    onRemoteViewport,
    onRemoteSelection,
    onRemoteAtlas,
    onRemoteAtlasRevision,
    onRemoteNote,
    onRemoteContentChanged,
    onRemoteCanvasDrag,
  };

  const acceptStatus = useCallback((next: DesktopSurfaceStatus) => {
    // Reads, tray events and display refreshes can overlap. A late native reply
    // must never undo a newer window mode or monitor layout.
    if (next.layoutRevision < revisionRef.current) return;
    if (statusRef.current && sameDesktopStatusDelivery(statusRef.current, next)) {
      setFailure(undefined);
      return;
    }
    const previous = statusRef.current;
    revisionRef.current = next.layoutRevision;
    statusRef.current = next;
    setStatus(next);
    setFailure(undefined);
    callbacksRef.current.onStatusChange(next);
    if (
      previous?.role !== next.role ||
      previous?.active !== next.active ||
      previous?.surface?.id !== next.surface?.id
    ) {
      callbacksRef.current.onChromeVisibleChange(false);
    }
  }, []);

  const recordFailure = useCallback((
    operation: DesktopSurfaceOperation,
    error: unknown,
  ) => {
    setFailure({ operation, message: errorMessage(error) });
  }, []);

  const readStatus = useCallback(async () => {
    try {
      acceptStatus(await desktopSurface.getStatus());
    } catch (error) {
      recordFailure("status", error);
    }
  }, [acceptStatus, recordFailure]);

  useEffect(() => {
    if (!hostAvailable) return;
    let disposed = false;
    let stopListening: (() => void) | undefined;

    void desktopSurface.getStatus().then((next) => {
      if (!disposed) acceptStatus(next);
    }).catch((error) => {
      if (!disposed) recordFailure("status", error);
    });
    void desktopSurface.onChange((next) => {
      if (
        !disposed &&
        desktopStatusTargetsRecipient(next, expectedMonitorId)
      ) acceptStatus(next);
    }).then((stop) => {
      if (disposed) stop();
      else stopListening = stop;
    }).catch((error) => {
      if (!disposed) recordFailure("status", error);
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [acceptStatus, expectedMonitorId, hostAvailable, recordFailure]);

  useEffect(() => {
    if (
      !status?.active ||
      status.role !== "monitor" ||
      !status.surface?.isController
    ) return;
    const timer = window.setInterval(() => {
      void desktopSurface.refresh()
        .then(acceptStatus)
        .catch((error) => recordFailure("status", error));
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [acceptStatus, recordFailure, status]);

  useEffect(() => {
    const surface = status?.surface;
    if (status?.role !== "monitor" || !surface) {
      callbacksRef.current.onBridgeChange(undefined);
      return;
    }

    const sync = new DesktopWorkspaceSync();
    let viewportFrame: number | undefined;
    let pendingViewport: Parameters<DesktopWorkspaceBridge["publishViewport"]>[0] | undefined;
    let atlasFrame: number | undefined;
    let pendingAtlas: DesktopAtlasSnapshot | undefined;
    let dragFrame: number | undefined;
    let pendingDrag: DesktopCanvasDragEvent | undefined;

    const projectionSurface = () => surfaceWithRendererScale(
      surface,
      window.devicePixelRatio,
      status.windowScaleFactor,
    );

    const projectCamera = (camera: CanonicalDesktopCamera) => {
      callbacksRef.current.onRemoteViewport(
        cameraToLocalViewport(camera, projectionSurface(), status.virtualBounds),
      );
    };
    const stops = [
      sync.onCamera(projectCamera),
      sync.onSelection((selection) => callbacksRef.current.onRemoteSelection(selection)),
      sync.onAtlas((snapshot) => callbacksRef.current.onRemoteAtlas(snapshot)),
      sync.onAtlasRevision((revision) => callbacksRef.current.onRemoteAtlasRevision(revision)),
      sync.onNote((note) => {
        callbacksRef.current.onRemoteNote(note);
        window.dispatchEvent(new CustomEvent<NoteSavedEventDetail>("math-atlas:note-saved", {
          detail: { ...note, source: "desktop-sync" },
        }));
      }),
      sync.onContentChanged(() => callbacksRef.current.onRemoteContentChanged()),
      sync.onCanvasDrag((event) => callbacksRef.current.onRemoteCanvasDrag(event)),
    ];

    const storedCamera = sync.storedCamera();
    if (storedCamera) projectCamera(storedCamera);

    const bridge: DesktopWorkspaceBridge = {
      publishViewport(viewport) {
        pendingViewport = viewport;
        if (viewportFrame !== undefined) return;
        viewportFrame = requestAnimationFrame(() => {
          viewportFrame = undefined;
          if (!pendingViewport) return;
          const camera = localViewportToCamera(
            pendingViewport,
            projectionSurface(),
            status.virtualBounds,
          );
          pendingViewport = undefined;
          sync.publishCamera(camera);
        });
      },
      publishSelection(selection) {
        sync.publishSelection(selection);
      },
      publishAtlas(snapshot) {
        pendingAtlas = snapshot;
        if (atlasFrame !== undefined) return;
        atlasFrame = requestAnimationFrame(() => {
          atlasFrame = undefined;
          if (!pendingAtlas) return;
          sync.publishAtlas(pendingAtlas);
          pendingAtlas = undefined;
        });
      },
      publishAtlasRevision(revision) {
        sync.publishAtlasRevision(revision);
      },
      publishContentChanged() {
        sync.publishContentChanged();
      },
      publishCanvasDrag(event) {
        if (event.phase !== "move") {
          if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
          dragFrame = undefined;
          pendingDrag = undefined;
          sync.publishCanvasDrag(event);
          return;
        }
        pendingDrag = event;
        if (dragFrame !== undefined) return;
        dragFrame = requestAnimationFrame(() => {
          dragFrame = undefined;
          if (!pendingDrag) return;
          sync.publishCanvasDrag(pendingDrag);
          pendingDrag = undefined;
        });
      },
    };
    callbacksRef.current.onBridgeChange(bridge);

    const publishSavedNote = (event: Event) => {
      const detail = (event as CustomEvent<NoteSavedEventDetail>).detail;
      if (!detail || detail.source === "desktop-sync") return;
      if (typeof detail.path !== "string" || typeof detail.markdown !== "string") return;
      sync.publishNote({ path: detail.path, markdown: detail.markdown });
    };
    window.addEventListener("math-atlas:note-saved", publishSavedNote);

    return () => {
      if (viewportFrame !== undefined) cancelAnimationFrame(viewportFrame);
      if (atlasFrame !== undefined) cancelAnimationFrame(atlasFrame);
      if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
      stops.forEach((stop) => stop());
      window.removeEventListener("math-atlas:note-saved", publishSavedNote);
      sync.close();
      callbacksRef.current.onBridgeChange(undefined);
    };
  }, [status]);

  const changeSurface = useCallback(async (operation: "enter" | "exit") => {
    if (busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      acceptStatus(operation === "enter"
        ? await desktopSurface.enter()
        : await desktopSurface.exit());
    } catch (error) {
      recordFailure(operation, error);
    } finally {
      setBusy(false);
    }
  }, [acceptStatus, busy, recordFailure]);

  const retry = useCallback(() => {
    if (failure?.operation === "enter") void changeSurface("enter");
    else if (failure?.operation === "exit") void changeSurface("exit");
    else void readStatus();
  }, [changeSurface, failure?.operation, readStatus]);

  if (!hostAvailable) return null;

  const showLauncher = status?.available && status.role === "workspace" && !status.active;
  const showMonitorControls = status?.active && status.role === "monitor" &&
    status.surface?.isController;

  return (
    <>
      {showLauncher && (
        <button
          type="button"
          className="desktop-surface-launcher"
          aria-label="Enter desktop canvas"
          title="Use the atlas across your desktop"
          disabled={busy}
          onClick={() => void changeSurface("enter")}
        >
          <MonitorUp size={15} aria-hidden="true" />
        </button>
      )}
      {showMonitorControls && (
        <nav
          className="desktop-surface-capsule"
          data-chrome-visible={chromeVisible ? "true" : "false"}
          aria-label="Desktop canvas"
        >
          <button
            type="button"
            aria-label={chromeVisible ? "Hide workspace chrome" : "Show workspace chrome"}
            title={chromeVisible ? "Hide workspace chrome" : "Show files, search, and note"}
            onClick={() => onChromeVisibleChange(!chromeVisible)}
          >
            {chromeVisible
              ? <PanelTopClose size={14} aria-hidden="true" />
              : <PanelTopOpen size={14} aria-hidden="true" />}
          </button>
          <button
            type="button"
            aria-label="Return to workspace window"
            title="Return to workspace window"
            disabled={busy}
            onClick={() => void changeSurface("exit")}
          >
            <AppWindow size={14} aria-hidden="true" />
          </button>
        </nav>
      )}
      {failure && (
        <div className="atlas-sync-alert desktop-surface-alert" role="alert">
          <span>{failure.message}</span>
          <button type="button" aria-label="Retry desktop canvas" title="Retry" onClick={retry}>
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
