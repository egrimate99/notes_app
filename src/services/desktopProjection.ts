import type { Viewport } from "@xyflow/react";
import type {
  DesktopMonitorSurface,
  PhysicalBounds,
} from "./desktopSurface";

/** React Flow world-to-screen transform expressed in virtual-desktop pixels. */
export type CanonicalDesktopCamera = Viewport;

/**
 * CSS-to-physical scale reported by the renderer itself. WebView2 can retain a
 * different rasterization scale from the monitor metadata while windows are
 * being created or moved, so devicePixelRatio is the projection authority.
 */
export function rendererPixelScale(
  devicePixelRatio: unknown,
  ...fallbacks: Array<number | undefined>
) {
  const candidates = [devicePixelRatio, ...fallbacks, 1];
  const scale = candidates.find((candidate) =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
  );
  return Number(scale);
}

export function surfaceWithRendererScale(
  surface: DesktopMonitorSurface,
  devicePixelRatio: unknown,
  ...fallbacks: Array<number | undefined>
): DesktopMonitorSurface {
  const scaleFactor = rendererPixelScale(
    devicePixelRatio,
    ...fallbacks,
    surface.scaleFactor,
  );
  return scaleFactor === surface.scaleFactor
    ? surface
    : { ...surface, scaleFactor };
}

function validScale(scaleFactor: number) {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new RangeError("A desktop surface requires a positive DPI scale factor.");
  }
  return scaleFactor;
}

function surfaceOffset(
  surface: Pick<DesktopMonitorSurface, "bounds">,
  virtualBounds: Pick<PhysicalBounds, "x" | "y">,
) {
  return {
    x: surface.bounds.x - virtualBounds.x,
    y: surface.bounds.y - virtualBounds.y,
  };
}

/** Projects one physical virtual-screen camera into a monitor WebView's CSS pixels. */
export function cameraToLocalViewport(
  camera: CanonicalDesktopCamera,
  surface: Pick<DesktopMonitorSurface, "bounds" | "scaleFactor">,
  virtualBounds: Pick<PhysicalBounds, "x" | "y">,
): Viewport {
  const scale = validScale(surface.scaleFactor);
  const offset = surfaceOffset(surface, virtualBounds);
  return {
    x: (camera.x - offset.x) / scale,
    y: (camera.y - offset.y) / scale,
    zoom: camera.zoom / scale,
  };
}

/** Lifts a monitor-local React Flow camera back into physical virtual-screen pixels. */
export function localViewportToCamera(
  viewport: Viewport,
  surface: Pick<DesktopMonitorSurface, "bounds" | "scaleFactor">,
  virtualBounds: Pick<PhysicalBounds, "x" | "y">,
): CanonicalDesktopCamera {
  const scale = validScale(surface.scaleFactor);
  const offset = surfaceOffset(surface, virtualBounds);
  return {
    x: viewport.x * scale + offset.x,
    y: viewport.y * scale + offset.y,
    zoom: viewport.zoom * scale,
  };
}

/** Physical position of a world point, useful for seam-continuity verification. */
export function worldPointInVirtualPixels(
  point: { x: number; y: number },
  camera: CanonicalDesktopCamera,
) {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}
