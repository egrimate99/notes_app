export type DesktopCanvasDragPhase = "start" | "move" | "end" | "cancel";

export interface DesktopCanvasPoint {
  x: number;
  y: number;
}

/**
 * A complete, transferable canvas gesture. Every packet carries the immutable
 * start data so a monitor WebView can join midway through a drag without
 * depending on delivery order from another renderer process.
 */
export interface DesktopCanvasDragEvent {
  gestureId: string;
  ownerSurfaceId: string;
  /** Surface that observed pointer release and owns the single persistence. */
  finalizerSurfaceId?: string;
  nodeId: string;
  nodeKind: "landmark" | "group";
  phase: DesktopCanvasDragPhase;
  startPointer: DesktopCanvasPoint;
  pointer: DesktopCanvasPoint;
}

const phases = new Set<DesktopCanvasDragPhase>([
  "start",
  "move",
  "end",
  "cancel",
]);

function finitePoint(value: unknown): value is DesktopCanvasPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<DesktopCanvasPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Math.abs(Number(point.x)) <= 100_000_000 &&
    Math.abs(Number(point.y)) <= 100_000_000;
}

function boundedId(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

export function isDesktopCanvasDragEvent(
  value: unknown,
): value is DesktopCanvasDragEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DesktopCanvasDragEvent>;
  return boundedId(event.gestureId) &&
    boundedId(event.ownerSurfaceId) &&
    (event.finalizerSurfaceId === undefined || boundedId(event.finalizerSurfaceId)) &&
    boundedId(event.nodeId) &&
    (event.nodeKind === "landmark" || event.nodeKind === "group") &&
    phases.has(event.phase as DesktopCanvasDragPhase) &&
    finitePoint(event.startPointer) &&
    finitePoint(event.pointer);
}

export function desktopCanvasDragDelta(
  event: Pick<DesktopCanvasDragEvent, "startPointer" | "pointer">,
): DesktopCanvasPoint {
  return {
    x: event.pointer.x - event.startPointer.x,
    y: event.pointer.y - event.startPointer.y,
  };
}

export function canvasGestureId(surfaceId: string) {
  try {
    return `${surfaceId}:${crypto.randomUUID()}`;
  } catch {
    return `${surfaceId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
