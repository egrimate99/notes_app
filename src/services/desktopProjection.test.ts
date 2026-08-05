import { describe, expect, it } from "vitest";
import {
  cameraToLocalViewport,
  localViewportToCamera,
  rendererPixelScale,
  surfaceWithRendererScale,
  worldPointInVirtualPixels,
} from "./desktopProjection";
import type { DesktopMonitorSurface } from "./desktopSurface";

function surface(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  scaleFactor: number,
): DesktopMonitorSurface {
  return {
    id,
    windowLabel: `desktop-${id}`,
    monitorId: id,
    isPrimary: id === "left",
    isController: id === "left",
    bounds: { x, y, width, height },
    monitorBounds: { x, y, width, height },
    scaleFactor,
  };
}

describe("desktop camera projection", () => {
  it("round-trips local viewports with negative virtual and work-area origins", () => {
    const virtualBounds = { x: -2560, y: -480 };
    const monitor = surface("left", -2560, -440, 2560, 1400, 1.25);
    const local = { x: -312.5, y: 184.25, zoom: .72 };

    expect(cameraToLocalViewport(
      localViewportToCamera(local, monitor, virtualBounds),
      monitor,
      virtualBounds,
    )).toEqual(local);
  });

  it("keeps a world point physically continuous across a mixed-DPI seam", () => {
    const virtualBounds = { x: -1920, y: 0 };
    const left = surface("left", -1920, 40, 1920, 1040, 1);
    const right = surface("right", 0, 0, 3840, 2080, 2);
    const camera = { x: 1780, y: 260, zoom: 1.4 };
    const worldPoint = { x: 130, y: 80 };
    const physical = worldPointInVirtualPixels(worldPoint, camera);

    const leftViewport = cameraToLocalViewport(camera, left, virtualBounds);
    const rightViewport = cameraToLocalViewport(camera, right, virtualBounds);
    const fromLeft = {
      x: left.bounds.x - virtualBounds.x +
        (worldPoint.x * leftViewport.zoom + leftViewport.x) * left.scaleFactor,
      y: left.bounds.y - virtualBounds.y +
        (worldPoint.y * leftViewport.zoom + leftViewport.y) * left.scaleFactor,
    };
    const fromRight = {
      x: right.bounds.x - virtualBounds.x +
        (worldPoint.x * rightViewport.zoom + rightViewport.x) * right.scaleFactor,
      y: right.bounds.y - virtualBounds.y +
        (worldPoint.y * rightViewport.zoom + rightViewport.y) * right.scaleFactor,
    };

    expect(fromLeft.x).toBeCloseTo(physical.x, 8);
    expect(fromLeft.y).toBeCloseTo(physical.y, 8);
    expect(fromRight.x).toBeCloseTo(physical.x, 8);
    expect(fromRight.y).toBeCloseTo(physical.y, 8);
  });

  it.each([1, 1.25, 1.5, 2])(
    "keeps a canvas-scaled title proportional to its group at renderer scale %s",
    (scaleFactor) => {
      const monitor = surface("screen", 0, 0, 1920, 1080, scaleFactor);
      const camera = { x: 0, y: 0, zoom: .84 };
      const local = cameraToLocalViewport(camera, monitor, { x: 0, y: 0 });
      const titlePhysicalHeight = 30 * local.zoom * scaleFactor;
      const groupPhysicalHeight = 252 * local.zoom * scaleFactor;

      expect(titlePhysicalHeight).toBeCloseTo(30 * camera.zoom, 10);
      expect(groupPhysicalHeight).toBeCloseTo(252 * camera.zoom, 10);
      expect(titlePhysicalHeight / groupPhysicalHeight).toBeCloseTo(30 / 252, 10);
    },
  );

  it("keeps a cross-monitor pointer drag continuous in world space", () => {
    const virtualBounds = { x: -2560, y: -480 };
    const left = surface("left", -2560, 120, 2560, 1320, 1.25);
    const right = surface("right", 0, -480, 3840, 2080, 2);
    const camera = { x: 3100, y: 460, zoom: 1.6 };
    const leftViewport = cameraToLocalViewport(camera, left, virtualBounds);
    const rightViewport = cameraToLocalViewport(camera, right, virtualBounds);
    const worldAtPhysicalPoint = (
      point: { x: number; y: number },
      monitor: DesktopMonitorSurface,
      viewport: { x: number; y: number; zoom: number },
    ) => {
      const localX = (
        point.x - (monitor.bounds.x - virtualBounds.x)
      ) / monitor.scaleFactor;
      const localY = (
        point.y - (monitor.bounds.y - virtualBounds.y)
      ) / monitor.scaleFactor;
      return {
        x: (localX - viewport.x) / viewport.zoom,
        y: (localY - viewport.y) / viewport.zoom,
      };
    };
    const startPhysical = { x: 2480, y: 920 };
    const endPhysical = { x: 3340, y: 260 };
    const startWorld = worldAtPhysicalPoint(startPhysical, left, leftViewport);
    const endWorld = worldAtPhysicalPoint(endPhysical, right, rightViewport);

    expect({
      x: endWorld.x - startWorld.x,
      y: endWorld.y - startWorld.y,
    }).toEqual({ x: 537.5, y: -412.5 });
  });

  it("rejects invalid DPI metadata instead of introducing a broken seam", () => {
    const monitor = surface("left", 0, 0, 100, 100, 0);
    expect(() => cameraToLocalViewport(
      { x: 0, y: 0, zoom: 1 },
      monitor,
      { x: 0, y: 0 },
    )).toThrow(/positive DPI scale/i);
  });

  it("uses the renderer's measured pixel ratio ahead of monitor metadata", () => {
    const monitor = surface("right", 3840, 0, 1920, 1152, 1);
    const measured = surfaceWithRendererScale(monitor, 1.5, 1);

    expect(measured.scaleFactor).toBe(1.5);
    expect(cameraToLocalViewport(
      { x: 4080, y: 150, zoom: 1.5 },
      measured,
      { x: 0, y: 0 },
    )).toEqual({ x: 160, y: 100, zoom: 1 });
  });

  it("falls back safely when devicePixelRatio is unavailable or invalid", () => {
    expect(rendererPixelScale(undefined, 1.25, 1)).toBe(1.25);
    expect(rendererPixelScale(0, Number.NaN, 1)).toBe(1);
  });
});
