import { invoke, isTauri } from "@tauri-apps/api/core";

export interface PhysicalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopMonitor {
  id: string;
  name?: string;
  isPrimary: boolean;
  bounds: PhysicalBounds;
  workArea: PhysicalBounds;
  scaleFactor: number;
}

export interface DesktopMonitorSurface {
  id: string;
  windowLabel: string;
  monitorId: string;
  isPrimary: boolean;
  /** The primary monitor surface coordinates canonical atlas writes. */
  isController: boolean;
  /** Physical taskbar-excluded rectangle occupied by this WebView. */
  bounds: PhysicalBounds;
  /** Full physical monitor rectangle, including any taskbar strip. */
  monitorBounds: PhysicalBounds;
  scaleFactor: number;
}

export interface DesktopSurfaceStatus {
  available: boolean;
  active: boolean;
  role: "workspace" | "monitor";
  virtualBounds: PhysicalBounds;
  monitors: DesktopMonitor[];
  /** Recipient-specific monitor surface; absent in the normal workspace. */
  surface?: DesktopMonitorSurface;
  /** DPI scale of the recipient WebView. */
  windowScaleFactor: number;
  layoutRevision: number;
}

export type DesktopSurfaceErrorCode =
  | "desktop_unavailable"
  | "state_error"
  | "window_error";

export class DesktopSurfaceError extends Error {
  constructor(
    public readonly code: DesktopSurfaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DesktopSurfaceError";
  }
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriDetector = () => boolean;
type DesktopStatusListener = (
  event: string,
  listener: (status: DesktopSurfaceStatus) => void,
) => Promise<() => void>;

export const DESKTOP_SURFACE_EVENT = "desktop-surface://changed";

const unavailableStatus = (): DesktopSurfaceStatus => ({
  available: false,
  active: false,
  role: "workspace",
  virtualBounds: { x: 0, y: 0, width: 0, height: 0 },
  monitors: [],
  windowScaleFactor: 1,
  layoutRevision: 0,
});

function asDesktopSurfaceError(error: unknown): DesktopSurfaceError {
  if (error instanceof DesktopSurfaceError) return error;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.message === "string") {
      return new DesktopSurfaceError(
        typeof candidate.code === "string"
          ? (candidate.code as DesktopSurfaceErrorCode)
          : "window_error",
        candidate.message,
      );
    }
  }
  return new DesktopSurfaceError(
    "window_error",
    typeof error === "string" ? error : "The desktop canvas could not be changed.",
  );
}

async function listenOnCurrentWebviewWindow(
  event: string,
  listener: (status: DesktopSurfaceStatus) => void,
) {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().listen<DesktopSurfaceStatus>(event, ({ payload }) => {
    listener(payload);
  });
}

/**
 * Guards recipient-specific native status against an accidentally broad event.
 * Monitor windows are identified by their immutable URL bootstrap id; the
 * normal workspace has no such id and must never consume monitor payloads.
 */
export function desktopStatusTargetsRecipient(
  status: DesktopSurfaceStatus,
  expectedMonitorId?: string,
) {
  if (!expectedMonitorId) return status.role === "workspace";
  if (status.role !== "monitor") return false;
  if (!status.active) return status.surface === undefined;
  return status.surface?.id === expectedMonitorId &&
    status.surface.windowLabel === `desktop-${expectedMonitorId}`;
}

/** Equal layout revisions can still carry different recipient payloads. */
export function sameDesktopStatusDelivery(
  left: DesktopSurfaceStatus,
  right: DesktopSurfaceStatus,
) {
  return left.layoutRevision === right.layoutRevision &&
    left.active === right.active &&
    left.role === right.role &&
    left.surface?.id === right.surface?.id &&
    left.surface?.windowLabel === right.surface?.windowLabel &&
    left.windowScaleFactor === right.windowScaleFactor;
}

/**
 * Computes the physical Windows virtual-screen rectangle. This deliberately
 * preserves negative origins; converting each monitor to logical pixels first
 * would introduce seams on mixed-DPI arrangements.
 */
export function virtualBoundsFor(
  monitors: readonly Pick<DesktopMonitor, "bounds">[],
): PhysicalBounds | undefined {
  const first = monitors[0]?.bounds;
  if (!first) return undefined;
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const { bounds } of monitors.slice(1)) {
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Shared frontend facade. In a normal browser every operation is a harmless no-op. */
export class DesktopSurfaceClient {
  constructor(
    private readonly invokeCommand: Invoke = invoke,
    private readonly detectTauri: TauriDetector = isTauri,
    private readonly listenForCurrentWindow: DesktopStatusListener = listenOnCurrentWebviewWindow,
  ) {}

  isAvailable(): boolean {
    try {
      return this.detectTauri();
    } catch {
      return false;
    }
  }

  getStatus(): Promise<DesktopSurfaceStatus> {
    return this.call("get_desktop_surface_status");
  }

  enter(): Promise<DesktopSurfaceStatus> {
    return this.call("enter_desktop_surface");
  }

  exit(): Promise<DesktopSurfaceStatus> {
    return this.call("exit_desktop_surface");
  }

  /** Reconciles the spanning window after a monitor, resolution, or DPI change. */
  refresh(): Promise<DesktopSurfaceStatus> {
    return this.call("refresh_desktop_surface");
  }

  /** Tracks native changes, including switches made from the system tray. */
  async onChange(
    listener: (status: DesktopSurfaceStatus) => void,
  ): Promise<() => void> {
    if (!this.isAvailable()) return () => undefined;
    try {
      return await this.listenForCurrentWindow(DESKTOP_SURFACE_EVENT, listener);
    } catch (error) {
      throw asDesktopSurfaceError(error);
    }
  }

  private async call(command: string): Promise<DesktopSurfaceStatus> {
    if (!this.isAvailable()) return unavailableStatus();
    try {
      return await this.invokeCommand<DesktopSurfaceStatus>(command);
    } catch (error) {
      throw asDesktopSurfaceError(error);
    }
  }
}

export const desktopSurface = new DesktopSurfaceClient();
