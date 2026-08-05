import { describe, expect, it } from "vitest";
import {
  desktopCanvasDragDelta,
  isDesktopCanvasDragEvent,
  type DesktopCanvasDragEvent,
} from "./desktopCanvasDrag";

const event: DesktopCanvasDragEvent = {
  gestureId: "monitor-left:gesture-1",
  ownerSurfaceId: "monitor-left",
  nodeId: "landmark-1",
  nodeKind: "landmark",
  phase: "move",
  startPointer: { x: -420.25, y: 510.5 },
  pointer: { x: 2380.75, y: -119.5 },
};

describe("desktop canvas drag packets", () => {
  it("preserves world-space deltas across negative and staggered monitor origins", () => {
    expect(desktopCanvasDragDelta(event)).toEqual({ x: 2801, y: -630 });
    expect(isDesktopCanvasDragEvent(event)).toBe(true);
  });

  it("rejects malformed or unbounded cross-WebView input", () => {
    expect(isDesktopCanvasDragEvent({ ...event, finalizerSurfaceId: "monitor-right" }))
      .toBe(true);
    expect(isDesktopCanvasDragEvent({ ...event, finalizerSurfaceId: "" })).toBe(false);
    expect(isDesktopCanvasDragEvent({ ...event, phase: "teleport" })).toBe(false);
    expect(isDesktopCanvasDragEvent({ ...event, pointer: { x: Number.NaN, y: 0 } }))
      .toBe(false);
    expect(isDesktopCanvasDragEvent({ ...event, pointer: { x: 1e12, y: 0 } }))
      .toBe(false);
    expect(isDesktopCanvasDragEvent({ ...event, nodeId: "" })).toBe(false);
  });
});
